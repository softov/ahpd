import { idOf, Status } from '../sessions/catalog.js';
import { localPath } from '../resources/fileuri.js';
import { sessionFlag } from './chatactions.js';
import type { Bag } from '../types/common.js';
import type { Summary } from '../types/catalog.js';
import type { PullRequest } from '../types/github.js';
import type { HostContext } from './context.js';

/**
 * The session lifecycle: sessions whose pull requests are merged, archived
 * and then deleted by the host itself, under VS Code's names for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionLifecycle.ts#L50-L107
 *
 * A pass reads every row, and acts on two root config keys a window pushes:
 * `autoArchiveMergedSessionsAfterDays` archives an inactive session whose
 * related pull requests are merged, and
 * `autoDeleteArchivedMergedSessionsAfterDays` deletes a session the host
 * archived that way. Each is off at `0`, and at any value that is not a
 * positive whole number.
 */
export interface SessionLifecycle {
  /** Run a pass now, for a push of either key. */
  scheduleSessionLifecycle(): void;
  /** Run a pass now and start the hourly clock. */
  startSessionLifecycle(): void;
  /** Stop the clock, for a host that is closing. */
  disposeSessionLifecycle(): void;
}

/** The root config key that archives a merged session, in days without activity. */
export const AUTO_ARCHIVE_KEY = 'autoArchiveMergedSessionsAfterDays';
/** The root config key that deletes a session the host archived, in days after the archive. */
export const AUTO_DELETE_KEY = 'autoDeleteArchivedMergedSessionsAfterDays';

/** How often the pass runs. */
const PASS_MS = 60 * 60_000;
/** One day. */
const DAY_MS = 24 * 60 * 60_000;

/** The comparison `facts.ts` makes, so a URL with a trailing slash is the same one. */
const urlKey = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

/** Whether a related list is complete: none open and at least one merged. */
const complete = (related: PullRequest[]): boolean =>
  related.length > 0 && related.every((one) => one.state !== 'open') && related.some((one) => one.state === 'merged');

export function createSessionLifecycle(ctx: HostContext): SessionLifecycle {
  const { options, sessions, kept, restarting, githubFacts, worktreeOf, dirOf, lent, log, running } = ctx;

  // How the pass learns the state of a pull request, from the host's own
  // option: set here because the pass is where it is read.
  ctx.pullRequestLookup = options.pullRequestLookup ?? 'url';

  const now = (): number => (options.now?.() ?? new Date()).getTime();
  const arm = options.timer ?? ((fire, ms): { cancel(): void } => {
    const handle = setTimeout(fire, ms);
    handle.unref?.();
    return { cancel: () => { clearTimeout(handle); } };
  });

  /** The armed clock, while it runs: VS Code's scheduler. */
  let scheduler: { cancel(): void } | undefined;
  /** The pass under way, so a second ask waits for it and runs once more, as VS Code chains its runs. */
  let runPromise: Promise<void> | undefined;
  /** Whether a pass was asked for while one ran, to be chained behind it. */
  let chained = false;
  /** Whether the log has said that the port cannot look a pull request up by its URL. */
  let saidNoUrl = false;

  /** A key's days, or `0` for a value that is not a positive whole number. */
  const daysOf = (key: string): number => {
    const value = ctx.rootConfig[key];
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
  };

  /** Whether a session is archived now. */
  const archived = (uri: string): boolean => (kept.flags(idOf(uri)) & Status.IsArchived) !== 0;

  /** Whether a session runs a turn, or is being started again. */
  const busy = (uri: string): boolean => {
    if (restarting.has(uri)) return true;
    const held = sessions.get(uri);
    if (held === undefined) return false;
    for (const chatUri of held.chats.keys()) if (running(chatUri)) return true;
    return false;
  };

  /** Whether a row has had no activity for `days`. */
  const idleFor = (row: Summary, days: number): boolean => {
    const at = Date.parse(row.modifiedAt);
    return !Number.isNaN(at) && at <= now() - days * DAY_MS;
  };

  /** Whether the host archived a session `days` or more ago. */
  const archivedFor = (uri: string, days: number): string | undefined => {
    const at = kept.autoArchivedAt?.(idOf(uri));
    if (at === undefined) return undefined;
    const when = Date.parse(at);
    return !Number.isNaN(when) && when <= now() - days * DAY_MS ? at : undefined;
  };

  /** The folder a row's session works in. */
  const folderOf = (row: Summary): string | undefined => {
    const first = row.workingDirectories[0];
    return worktreeOf(row.resource)?.path ?? dirOf(row.resource) ?? (first === undefined ? undefined : localPath(first));
  };

  /** The git facts of a folder, as the directory port holds them. */
  const gitOf = (dir: string): Bag | undefined =>
    (options.directories?.meta(dir) as { git?: Bag } | undefined)?.git;

  /**
   * The pull requests of a session's branch, asked by branch.
   *
   * The branch is the stored worktree's, else the folder's. The repository
   * is named by the folder's git facts, else by what GitHub said about the
   * folder, else by the repository the tree was cut from.
   */
  const byBranch = async (row: Summary, dir: string): Promise<PullRequest[] | undefined> => {
    const github = options.github;
    if (github === undefined) return undefined;
    const tree = worktreeOf(row.resource);
    const git = gitOf(dir) ?? (tree === undefined ? undefined : gitOf(tree.repository));
    const facts = githubFacts.get(dir);
    const owner = git?.githubOwner ?? facts?.owner;
    const repo = git?.githubRepo ?? facts?.repo;
    const branch = tree?.branch ?? git?.branchName ?? facts?.pullRequestBranchName;
    if (typeof owner !== 'string' || typeof repo !== 'string' || typeof branch !== 'string') return undefined;
    const resource = String(github.resource.resource ?? '');
    return github.forBranch({ owner, repo }, branch, lent(resource), tree?.repository ?? dir);
  };

  /**
   * The pull requests of a session, asked one URL at a time: the folder's
   * recorded pull requests and the ones the session took over, with the URLs
   * GitHub answered nothing for: a related pull request the lookup cannot
   * resolve makes the session not eligible, as the reference host's
   * lifecycle reads one.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionLifecycle.ts#L229-L241
   */
  const byUrls = async (row: Summary, dir: string): Promise<{ found: PullRequest[]; unresolved: string[] } | undefined> => {
    const github = options.github;
    const ask = github?.byUrl;
    if (github === undefined || ask === undefined) return undefined;
    const recorded = githubFacts.get(dir)?.pullRequestUrls;
    const own = kept.pullRequests(idOf(row.resource))?.associatedPullRequestUrls ?? [];
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const url of [...own, ...(Array.isArray(recorded) ? recorded : [])]) {
      if (typeof url !== 'string' || seen.has(urlKey(url))) continue;
      seen.add(urlKey(url));
      urls.push(url);
    }
    const resource = String(github.resource.resource ?? '');
    const cwd = worktreeOf(row.resource)?.repository ?? dir;
    const found: PullRequest[] = [];
    const unresolved: string[] = [];
    for (const url of urls) {
      const one = await ask.call(github, url, lent(resource), cwd);
      if (one !== undefined) found.push(one);
      else unresolved.push(url);
    }
    return { found, unresolved };
  };

  /**
   * The pull requests related to a session: the ones asked for by
   * `pullRequestLookup`, less the baseline's that the session did not take
   * over. Nothing when GitHub could not be asked.
   */
  const relatedOf = async (row: Summary): Promise<PullRequest[] | undefined> => {
    const dir = folderOf(row);
    if (dir === undefined || options.github === undefined) return undefined;
    let found: PullRequest[] | undefined;
    let unresolved: string[] = [];
    try {
      if (ctx.pullRequestLookup === 'url' && options.github.byUrl !== undefined) {
        const asked = await byUrls(row, dir);
        found = asked?.found;
        unresolved = asked?.unresolved ?? [];
      }
      else {
        if (ctx.pullRequestLookup === 'url' && !saidNoUrl) {
          saidNoUrl = true;
          log('merged sessions: the GitHub port cannot look a pull request up by its URL, so it is asked by branch');
        }
        found = await byBranch(row, dir);
      }
    }
    catch (error) {
      log(`merged sessions: GitHub did not answer for ${row.resource}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    if (found === undefined) return undefined;
    const baseline = kept.pullRequests(idOf(row.resource));
    const taken = new Set((baseline?.associatedPullRequestUrls ?? []).map(urlKey));
    const before = new Set((baseline?.initialPullRequestUrls ?? []).map(urlKey).filter((key) => !taken.has(key)));
    // A related pull request GitHub answered nothing for: the session is not eligible.
    if (unresolved.some((url) => !before.has(urlKey(url)))) return undefined;
    return found.filter((one) => !before.has(urlKey(one.url)));
  };

  /** The row of a session as the catalogue answers it now. */
  const rowNow = async (uri: string): Promise<Summary | undefined> =>
    (await ctx.allRows()).find((one) => one.resource === uri);

  /** Archive one inactive session whose related pull requests are merged. */
  const archiveOne = async (row: Summary, days: number): Promise<boolean> => {
    const related = await relatedOf(row);
    if (related === undefined || !complete(related)) return false;
    // Checked again, since GitHub took a while to answer.
    const fresh = await rowNow(row.resource);
    if (ctx.closed || fresh === undefined || archived(row.resource) || busy(row.resource) || !idleFor(fresh, days)) return false;
    // The time first, so `shelve` knows the archive is the host's own.
    kept.setAutoArchivedAt?.(idOf(row.resource), new Date(now()).toISOString());
    sessionFlag(ctx, row.resource, Status.IsArchived, true, { type: 'session/isArchivedChanged', isArchived: true });
    log(`archived ${row.resource}: its pull requests are merged (${related.filter((one) => one.state === 'merged').map((one) => one.url).join(', ')})`);
    return true;
  };

  /*
   * Delete one session the host archived, once deleting it keeps its work:
   * each of its trees gone, or synced with its remote, as VS Code's host
   * deletes one by itself. A synced tree is taken away with the session, by
   * `shelve` while the record that names it is still here, as the automatic
   * archive takes one away; a running session's goes with its teardown.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionLifecycle.ts#L184-L191
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11163-L11179
   */
  const deleteOne = async (row: Summary, at: string): Promise<boolean> => {
    const related = await relatedOf(row);
    if (related === undefined || !complete(related)) return false;
    if (!await ctx.canAutomaticallyDeleteArchivedSession(row.resource)) {
      log(`kept ${row.resource}: the archived session still has a worktree with unsynced work`);
      return false;
    }
    // Checked again, since GitHub and the disk took a while to answer.
    if (ctx.closed || !archived(row.resource) || busy(row.resource) || kept.autoArchivedAt?.(idOf(row.resource)) !== at) return false;
    await ctx.shelve(row.resource);
    try {
      await ctx.removeSession(row.resource);
    }
    catch (error) {
      log(`could not delete ${row.resource}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    log(`deleted ${row.resource}: archived at ${at}, its pull requests are merged (${related.map((one) => one.url).join(', ')})`);
    return true;
  };

  /** One pass over every row: VS Code's `run`. */
  const run = async (): Promise<void> => {
    const archiveDays = daysOf(AUTO_ARCHIVE_KEY);
    const deleteDays = daysOf(AUTO_DELETE_KEY);
    if ((archiveDays === 0 && deleteDays === 0) || options.github === undefined) return;
    let looked = 0;
    let archivedCount = 0;
    let deletedCount = 0;
    for (const row of await ctx.allRows()) {
      if (ctx.closed) return;
      const uri = row.resource;
      if (busy(uri)) continue;
      if (!archived(uri)) {
        if (archiveDays === 0 || !idleFor(row, archiveDays)) continue;
        looked += 1;
        if (await archiveOne(row, archiveDays)) archivedCount += 1;
        continue;
      }
      if (deleteDays === 0) continue;
      const at = archivedFor(uri, deleteDays);
      if (at === undefined) continue;
      looked += 1;
      if (await deleteOne(row, at)) deletedCount += 1;
    }
    if (looked > 0) log(`merged sessions: looked at ${looked}, archived ${archivedCount}, deleted ${deletedCount}`);
  };

  /** Run a pass, or one more chained after the pass under way: VS Code's `_runScheduled`. */
  const runScheduled = (): Promise<void> => {
    if (runPromise !== undefined) {
      chained = true;
      return runPromise;
    }
    const going = (async () => {
      do {
        chained = false;
        await run().catch((error: unknown) => {
          log(`merged sessions: ${error instanceof Error ? error.message : String(error)}`);
        });
      } while (chained && !ctx.closed);
    })();
    runPromise = going;
    void going.then(() => { if (runPromise === going) runPromise = undefined; });
    return going;
  };

  /** Arm the clock for the next pass: VS Code's `_schedule` of its interval. */
  const schedule = (): void => {
    scheduler = arm(() => {
      scheduler = undefined;
      if (ctx.closed) return;
      void runScheduled();
      schedule();
    }, PASS_MS);
  };

  const scheduleSessionLifecycle = (): void => {
    if (!ctx.closed) void runScheduled();
  };

  const startSessionLifecycle = (): void => {
    if (scheduler !== undefined) return;
    void runScheduled();
    schedule();
  };

  const disposeSessionLifecycle = (): void => {
    scheduler?.cancel();
    scheduler = undefined;
  };

  return { scheduleSessionLifecycle, startSessionLifecycle, disposeSessionLifecycle };
}

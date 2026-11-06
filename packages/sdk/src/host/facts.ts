import { createHash } from 'node:crypto';
import { sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ARTIFACTS_META, artifactsIn, isGitHubLink, recordArtifact } from '../tools/artifacts.js';
import { idOf } from '../sessions/catalog.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { CREATED_BY_META, MULTI_ROOT_META, REMOTE_ORIGIN_META, SPAWN_DEPTH_META, depthOf } from '../sessions/remotesession.js';
import { reason } from '../utils/values.js';
import type { Bag } from '../types/common.js';
import type { PullRequest } from '../types/github.js';
import type { HostContext } from './context.js';

/**
 * VS Code's `PULL_REQUEST_CREATION_CLOCK_SKEW_MS`: how much earlier than a
 * session's start a pull request must say it was opened to be the session's
 * baseline.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L46
 */
const PULL_REQUEST_CLOCK_SKEW_MS = 5 * 60_000;

/** What a session's directory says about it, and what the host asks to move it. */
export interface Facts {
  describes(uri: string): Bag;
  setArtifacts(uri: string, list: Bag[]): void;
  /** Add to a session's pull request baseline what VS Code's host adds, from what its directory's branch lists. */
  captureBaseline(uri: string): void;
  recordPullRequest(uri: string, dir: string, pullRequest: { url: string; title: string; branch: string }): void;
  metaMoved(dir: string): void;
  dirOfFile(uri: string): string | undefined;
  wroteThrough(uri: string): void;
  refreshWatched(dir: string): Promise<void>;
  startWatchingDir(dir: string): void;
  stopUnwatched(dir: string): void;
  refreshPullRequests(dir: string): Promise<boolean>;
  readFacts(dir: string): Promise<boolean>;
  refreshFacts(dir: string): void;
  sessionMetaChanged(uri: string): void;
  /**
   * Set every plugin's `changed` on the entry it closes over.
   *
   * Run at start and again from `replace`, because a plugin a live fold brings
   * has no way to say that its key moved until this runs.
   */
  wireSessionMeta(): void;
  /**
   * Set every plugin's `open`, `update` and `close` on the entry it closes
   * over.
   *
   * Run at start and again from `replace`, because a plugin a live fold brings
   * has no way to open a canvas until this runs.
   */
  wireCanvases(): void;
}

export function createFacts(ctx: HostContext): Facts {
  const {
    options, sessions, owners, connections, worktreeOf, githubFacts, kept, log, lent, dispatch,
    dirOf, leadOf, changesetAt, changesetOf, catalogueOf, contentMoved, operationsMoved, listedMeta,
  } = ctx;

  /**
   * The keys plugins add to a session's `_meta`.
   *
   * Asked on every composition rather than kept, because the value is the
   * plugin's own and a copy here would be a second answer to what it says. A
   * reader that throws costs its key and not the map: `session/metaChanged`
   * carries the whole of it, and a plugin that cannot answer must not take the
   * directory's facts with it.
   */
  const pluginMeta = (uri: string): Bag => {
    const values: Bag = {};
    for (const served of options.sessionMeta ?? []) {
      for (const one of served.keys) {
        let value: unknown;
        try {
          value = one.read(uri);
        }
        catch (error) {
          log(`plugin ${served.by}: the value of ${one.key} for ${uri} was not read: ${reason(error)}`);
          continue;
        }
        if (value !== undefined) values[one.key] = value;
      }
    }
    return values;
  };

  /**
   * The session's `_meta`, whole.
   *
   * `git` is the port's answer plus the one fact only this host knows - the
   * branch a worktree was cut from - and `github` is what was last heard from
   * GitHub. Composed in one place because `session/metaChanged` replaces the
   * map entirely: a producer that dispatched its own part would erase the
   * other's.
   */
  const metaOf = (uri: string): Bag | undefined => {
    const added = pluginMeta(uri);
    const dir = dirOf(uri);
    // A session in no directory still has what its plugins say about it, which
    // is the one part of the map that does not come from where it works.
    if (dir === undefined) return Object.keys(added).length === 0 ? undefined : added;
    const meta = options.directories?.meta(dir);
    const base = worktreeOf(uri)?.base;
    const git = typeof (meta as { git?: unknown } | undefined)?.git === 'object'
      ? (meta as { git: Record<string, unknown> }).git
      : undefined;
    const told = base !== undefined && base !== 'HEAD' && git !== undefined
      ? { ...meta, git: { ...git, baseBranchName: base } }
      : meta;
    const github = githubFacts.get(dir);
    const artifacts = kept.artifacts(idOf(uri));
    const baseline = kept.pullRequests(idOf(uri));
    // The directory's facts and the session's baseline meet here: the
    // baseline is one session's and the facts are every session's in the
    // directory, and `session/metaChanged` carries the whole map. Composed
    // once because two keys below carry the same thing, and a second
    // composition is a second thing that can drift.
    const facts = github === undefined && baseline === undefined
      ? undefined
      : {
        ...github,
        ...(baseline === undefined ? {} : {
          initialPullRequestUrls: baseline.initialPullRequestUrls,
          associatedPullRequestUrls: baseline.associatedPullRequestUrls,
        }),
      };
    if (told === undefined && facts === undefined && artifacts === undefined && Object.keys(added).length === 0) return undefined;
    // The folder the state belongs to, and the key it is published under. One
    // string for both, so a client that reads the key it was given and a
    // client that derives the key from the working directory arrive at the
    // same entry.
    const folder = uriOf(dir);
    /*
     * The git state again for each other chat of the session, under the scope
     * of the folders it works in, as VS Code's host writes the git state of a
     * chat that is not the session's default: `gitData` keyed by the scope's
     * id, the hash of its folders' sorted keys, and `workingDirectoryScopeIds`
     * naming the id of each folder list as the chat gives it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L959-L972
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostWorkingDirectories.ts#L29-L35
     */
    const held = sessions.get(uri);
    const gitState = (told as { git?: unknown } | undefined)?.git;
    const scopes = gitState === undefined || held === undefined ? [] : [...held.chats]
      .filter(([chatUri]) => chatUri !== held.defaultChat)
      .map(([, chat]) => {
        const folders = chat.workingDirectories();
        return [JSON.stringify(folders), createHash('sha1').update(JSON.stringify([...new Set(folders)].sort())).digest('hex')] as const;
      });
    return {
      // A plugin's keys first, so the directory's facts win a collision: the
      // plugin's key is its own name and this host's answer about where the
      // session is.
      ...added,
      ...told,
      ...(scopes.length === 0 ? {} : {
        gitData: Object.fromEntries(scopes.map(([, id]) => [id, gitState])),
        workingDirectoryScopeIds: Object.fromEntries(scopes),
      }),
      /*
       * The same state under the three names it is read by: `githubData`
       * keyed by the folder, with `workingDirectoryKeys` saying which folder,
       * and `github` for a client that has not moved to the per-folder map.
       */
      ...(facts === undefined
        ? {}
        : {
          github: facts,
          githubData: { [folder]: facts },
          workingDirectoryKeys: { [folder]: folder },
        }),
      // The session's own, beside the directory's: what the agent recorded
      // as worth coming back to, under the key the reference client reads.
      ...(artifacts !== undefined && artifacts.length > 0 ? { [ARTIFACTS_META]: artifacts } : {}),
    };
  };

  /** The pull requests GitHub last listed for each directory's branch, with when each was opened. */
  const listed = new Map<string, PullRequest[]>();
  /** The comparison the reference makes, so a URL with a trailing slash is the same one. */
  const urlKey = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();
  /**
   * Add to a session's pull request baseline what VS Code's host adds to one.
   *
   * Only a folder-isolated session has a baseline, or one that holds one
   * already; a worktree session has none. A session on a host with no
   * worktrees to make works in its folder, so it is a folder session too. A
   * pull request its directory's
   * branch lists goes in when GitHub says it was opened before the session
   * began, less five minutes of clock skew, or, with no time given, while the
   * session holds no baseline yet; one the session already relates is left as
   * it is. A folder session whose branch lists none holds an empty one.
   * Called when GitHub answers for the directory and when a session opens
   * onto an answer already held.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L396-L411
   */
  const captureBaseline = (uri: string): void => {
    const id = idOf(uri);
    const held = kept.pullRequests(id);
    if (ctx.decided.get(uri)?.isolation === 'worktree' && held?.initialPullRequestUrls === undefined) return;
    const dir = dirOf(uri);
    const found = dir === undefined ? [] : listed.get(dir) ?? [];
    const related = new Set([...(held?.initialPullRequestUrls ?? []), ...(held?.associatedPullRequestUrls ?? [])].map(urlKey));
    const began = Date.parse(sessions.get(uri)?.createdAt ?? '');
    const added = found.filter((one) => {
      if (related.has(urlKey(one.url))) return false;
      const opened = Date.parse(one.createdAt ?? '');
      return Number.isFinite(opened)
        ? Number.isNaN(began) || opened < began - PULL_REQUEST_CLOCK_SKEW_MS
        : held?.initialPullRequestUrls === undefined;
    }).map((one) => one.url);
    if (held?.initialPullRequestUrls !== undefined && added.length === 0) return;
    kept.setPullRequests(id, {
      ...held,
      initialPullRequestUrls: [...(held?.initialPullRequestUrls ?? []), ...added],
      associatedPullRequestUrls: held?.associatedPullRequestUrls ?? [],
    });
  };
  /**
   * Move a pull request out of the baseline and into the session's own.
   *
   * Called when the pull request becomes the session's, which is the
   * `create-pr` association. The URL leads the associated list, leaves the
   * initial one whatever spelling it arrived with, and `pullRequestUrls` is
   * left alone: that is the directory's whole set and `refreshPullRequests`
   * is its writer.
   */
  const promotePullRequest = (uri: string, url: string): void => {
    const held = kept.pullRequests(idOf(uri));
    const seen = new Set<string>();
    const associatedPullRequestUrls: string[] = [];
    for (const one of [url, ...(held?.associatedPullRequestUrls ?? [])]) {
      const key = urlKey(one);
      if (seen.has(key)) continue;
      seen.add(key);
      associatedPullRequestUrls.push(one);
    }
    const promoted = urlKey(url);
    kept.setPullRequests(idOf(uri), {
      initialPullRequestUrls: (held?.initialPullRequestUrls ?? []).filter((one) => urlKey(one) !== promoted),
      associatedPullRequestUrls,
    });
  };
  /**
   * Replace what a session recorded, and say so.
   *
   * `session/metaChanged` carries the whole map, which `metaOf` composes; the
   * row moves with it, since the window draws the pills from the row.
   */
  const setArtifacts = (uri: string, list: Bag[]): void => {
    kept.setArtifacts(idOf(uri), list);
    // The whole map, running or not: the action replaces it, and a session's
    // state holds its origin and owner beside its artifacts, as VS Code's host
    // merges every producer's keys into the one it publishes.
    const meta = describes(uri)._meta as Bag | undefined;
    dispatch(uri, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
    ctx.summaryMoved(uri);
  };
  /**
   * What a session's `_meta` holds because of its agent.
   *
   * While something runs it, read off the backend's own state rather than kept
   * here, so a key it adds or drops is one this host follows without having to
   * know about it. While nothing runs it, the `_meta` the backend put on the
   * row it listed - kept by `adopt`, which is where a browsed session is
   * remembered. A running agent's map replaces the listed one whole: the agent
   * knows the session as it is now, and the row knew it as the listing did.
   */
  const agentMeta = (uri: string): Bag => {
    const held = sessions.get(uri);
    const lead = held === undefined ? undefined : leadOf(held);
    if (lead === undefined) return listedMeta.get(uri) ?? {};
    const meta = (lead.sessionState() as { _meta?: unknown } | undefined)?._meta;
    return typeof meta === 'object' && meta !== null ? (meta as Bag) : {};
  };

  /**
   * What is true of a session because of where it is.
   *
   * Spread into a `SessionState` and into a `SessionSummary` alike, so only
   * fields both declare belong here - see `changesetsOf` for the one that had
   * to come out.
   */
  const describes = (uri: string): Bag => {
    const dir = dirOf(uri);
    /*
     * Whose a session is, as a typed reference, and nothing where nobody owns
     * it - a host with no users directory has no person to name.
     *
     * Read before the early return below, because a session in no directory is
     * exactly the one that still says whose it is, and its owner is no fact of
     * where it is.
     */
    const owner = kept.owner(idOf(uri));
    /*
     * Where a window sent this session from, and what it was made by.
     *
     * The window's own keys, written where the window reads them: the origin
     * it sent, the depth that came with it and the session that made this one.
     * The origin is a fact about the session and not about its directory, so
     * it is here rather than in `metaOf` - a session sent here may be in no
     * directory at all, and the window that sent it still reads its summary.
     *
     * The depth is the deeper of what this host holds and what the origin
     * says, which is the window's own arithmetic: a session sent on from here
     * is that much further from the one that began the work.
     */
    const origin = kept.remoteOrigin?.(idOf(uri));
    const made = kept.createdBy?.(idOf(uri));
    const multiRoot = kept.multiRoot?.(idOf(uri));
    /*
     * The map has two producers and both have to be in it.
     *
     * The backend adds its own keys beside the protocol's fields - the model a
     * session is on is one - and this host adds the directory's facts. Every
     * place a session is described spreads this helper, and `_meta` is
     * replaced whole rather than merged, so a description that carried only
     * this host's keys would erase the backend's on the state, on the browsed
     * state, on the row and on the notification alike.
     *
     * The host's keys win a collision: a fact read from the directory is this
     * host's answer about where the session is, and the backend has no way to
     * know it.
     */
    const byAgent = agentMeta(uri);
    const sent = {
      ...(origin === undefined
        ? {}
        : { [REMOTE_ORIGIN_META]: { session: origin.session, chat: origin.chat, depth: origin.depth }, [SPAWN_DEPTH_META]: depthOf(byAgent, origin) }),
      ...(made === undefined ? {} : { [CREATED_BY_META]: made }),
      ...(multiRoot === undefined ? {} : { [MULTI_ROOT_META]: multiRoot }),
    };
    if (dir === undefined) {
      const meta = { ...byAgent, ...pluginMeta(uri), ...sent, ...(owner === undefined ? {} : { 'ahpd.owner': owner }) };
      return Object.keys(meta).length === 0 ? {} : { _meta: meta };
    }
    /*
     * The project's name is the directory's own, not its path.
     *
     * A catalogue of sessions across several repositories is read by which
     * repository each row is in, and every row spelling out
     * `/home/somebody/work/…` differs only in the part that scrolls off. Done
     * here rather than with `basename` because it is a string and this file
     * is the protocol.
     */
    const project = { uri: uriOf(dir), displayName: dir.split('/').filter(Boolean).pop() ?? dir };
    // Anything past the path is the host's to be told, not this file's to go
    // and find - `git` is a binary, and a host may be given none.
    const told = metaOf(uri);
    const meta = { ...byAgent, ...told, ...sent, ...(owner === undefined ? {} : { 'ahpd.owner': owner }) };
    return {
      project,
      ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }),
      // Not `changes`: `SessionSummary` declares it and `SessionState` does
      // not, so it goes on the row rather than in both - which is the rule
      // this helper states and had broken.

    };
  };

  /** Every session in a directory, since a fact is the directory's. */
  const inThere = (dir: string): string[] => [...sessions.keys()].filter((uri) => dirOf(uri) === dir);
  /** `_meta` moved: every session in the directory says so, and its row. */
  const metaMoved = (dir: string): void => {
    for (const uri of inThere(dir)) {
      const meta = describes(uri)._meta as Bag | undefined;
      dispatch(uri, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
      ctx.summaryMoved(uri);
      // And the verbs, since a branch that gained a pull request offers
      // different ones from a branch that lacks it.
      operationsMoved(uri);
    }
  };

  /**
   * The sessions in a directory that a move of its changesets is told to.
   *
   * Every running one, and each catalogued one that is not running whose
   * changeset a connection watches.
   */
  const toldIn = (dir: string): string[] => {
    const told = new Set(inThere(dir));
    for (const connection of connections) {
      for (const channel of connection.watching) {
        const at = changesetAt(channel);
        if (at === undefined || at.dir !== dir) continue;
        if (!sessions.has(at.owner) && owners.has(at.owner)) told.add(at.owner);
      }
    }
    return [...told];
  };

  /**
   * Whether any connection is watching a changeset of a session in `dir`.
   *
   * The uncommitted changeset is only worth re-reading for a client that is
   * showing it: a directory nobody is looking at has nothing to update, and
   * `git status` is not free.
   */
  const watchedIn = (dir: string): boolean => {
    const told = toldIn(dir);
    if (told.length === 0) return false;
    for (const connection of connections) {
      for (const channel of connection.watching) {
        if (told.some((uri) => changesetOf(channel, uri))) return true;
      }
    }
    return false;
  };

  /** The session directory a path or a `file:` URI is inside, longest first. */
  const dirOfFile = (uri: string): string | undefined => {
    const path = localPath(uri);
    const dirs = new Set<string>();
    for (const uri_ of sessions.keys()) {
      const dir = dirOf(uri_);
      if (dir !== undefined) dirs.add(dir);
    }
    return [...dirs]
      // The system's separator, which is what `localPath` answers in.
      .filter((dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`))
      .sort((a, b) => b.length - a.length)[0];
  };

  /** A write that landed through the host moves the changeset of its directory. */
  const wroteThrough = (uri: string): void => {
    const dir = dirOfFile(uri);
    if (dir !== undefined) void refreshWatched(dir);
  };

  /** The directories with a re-read in flight, and one waiting behind it. */
  const refreshing = new Set<string>();
  const waiting = new Set<string>();

  /**
   * A re-read of one directory, watched-only and coalesced.
   *
   * Every trigger below ends here. A move runs `git status` and `git diff`,
   * which is not free, so it happens only while a client watches a changeset of
   * a session in this directory, and a burst is at most two re-reads: one
   * running and one waiting behind it.
   */
  const refreshWatched = async (dir: string): Promise<void> => {
    if (refreshing.has(dir)) {
      waiting.add(dir);
      return;
    }
    refreshing.add(dir);
    try {
      for (;;) {
        waiting.delete(dir);
        if (!watchedIn(dir)) return;
        let moved = false;
        try {
          moved = await options.changes?.refresh?.(dir) ?? false;
        }
        catch {
          moved = false;
        }
        /*
         * What moved, said to each session there. A directory removed while
         * this ran fails the reads that describe it, and every caller starts
         * this without waiting, so a failure ends the re-read here instead of
         * leaving a rejection nobody handles.
         */
        if (moved) {
          try {
            for (const uri of toldIn(dir)) {
              // Only a list that differs from the one the session's state
              // holds, as `readFacts` says one.
              const changesets = catalogueOf(uri, dir);
              if (!ctx.relaysChangesets(uri) && !isDeepStrictEqual(ctx.stateOf(uri)?.changesets ?? [], changesets))
                dispatch(uri, { type: 'session/changesetsChanged', changesets });
              ctx.summaryMoved(uri);
              await contentMoved(uri);
            }
          }
          catch {
            return;
          }
        }
        if (!waiting.has(dir)) return;
      }
    }
    finally {
      refreshing.delete(dir);
    }
  };

  /** A source watch per directory, opened when the first changeset there is read. */
  const dirWatchers = new Map<string, () => void>();
  const stopWatchingDir = (dir: string): void => {
    dirWatchers.get(dir)?.();
    dirWatchers.delete(dir);
  };
  const startWatchingDir = (dir: string): void => {
    if (dirWatchers.has(dir)) return;
    const stop = options.changes?.watch?.(dir, () => {
      // The last session left: nothing here is worth a watcher, so this closes
      // the handle rather than leaving it firing for nobody.
      if (!watchedIn(dir)) {
        stopUnwatched(dir);
        return;
      }
      void refreshWatched(dir);
    });
    if (stop === undefined) return;
    dirWatchers.set(dir, stop);
    /*
     * A change made while the source was arming its watch reached no watcher,
     * so the directory is read again once it says it is armed - unless this
     * watch was stopped by then.
     */
    void stop.ready?.then(() => {
      if (dirWatchers.get(dir) === stop) void refreshWatched(dir);
    }, () => {});
  };
  /** The watch on a directory, closed once no subscribed changeset is there. */
  const stopUnwatched = (dir: string): void => {
    if (!watchedIn(dir)) stopWatchingDir(dir);
  };
  /**
   * Ask GitHub about the branch a directory is on, answering whether what it
   * said differs from what was held.
   *
   * Only where the git facts name a GitHub remote and a branch. Asked with a
   * token a client lent when one has, and otherwise however the port can;
   * an answer that fails keeps what was held rather than erasing it, since
   * the network being down is not the pull request being gone. The state is
   * of the newest request, which is the one the row draws.
   */
  const refreshPullRequests = async (dir: string): Promise<boolean> => {
    if (options.github === undefined) return false;
    const git = (options.directories?.meta(dir) as { git?: Record<string, unknown> } | undefined)?.git;
    const owner = git?.githubOwner;
    const repo = git?.githubRepo;
    const branch = git?.branchName;
    if (typeof owner !== 'string' || typeof repo !== 'string' || typeof branch !== 'string') {
      return githubFacts.delete(dir);
    }
    const resource = String(options.github.resource.resource ?? '');
    let found;
    try {
      found = await options.github.forBranch({ owner, repo }, branch, lent(resource), dir);
    }
    catch (error) {
      log(`${dir}: GitHub did not answer for ${branch}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    const newest = found[0];
    const now: Bag = {
      owner,
      repo,
      ...(newest === undefined ? {} : {
        pullRequestUrls: found.map((one) => one.url),
        pullRequestBranchName: branch,
        pullRequestState: newest.state,
        pullRequestStateUrl: newest.url,
      }),
    };
    listed.set(dir, found);
    const before = githubFacts.get(dir);
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(now)) return false;
    githubFacts.set(dir, now);
    for (const uri of inThere(dir)) captureBaseline(uri);
    return true;
  };

  /**
   * Record the pull request an operation opened or found again, and say so.
   *
   * The same promotion the add tool runs, since a reference to the same URL is
   * upgraded rather than duplicated. The association is written before
   * `refreshFacts` asks GitHub, so the operation's own answer is already there
   * and GitHub's later answer is the one that survives.
   */
  const recordPullRequest = (uri: string, dir: string, pullRequest: { url: string; title: string; branch: string }): void => {
    const recorded = recordArtifact(artifactsIn(kept.artifacts(idOf(uri))), {
      type: 'pullRequest',
      label: pullRequest.title,
      isArtifact: true,
      link: pullRequest.url,
      isGitHub: isGitHubLink(pullRequest.url),
    }, () => crypto.randomUUID());
    setArtifacts(uri, recorded.held as unknown as Bag[]);
    // In the same write as the artifact, so one `_meta` move says both and a
    // client never sees the artifact without the promotion that came with it.
    promotePullRequest(uri, pullRequest.url);

    const held = githubFacts.get(dir) ?? {};
    const urls = Array.isArray(held.pullRequestUrls)
      ? held.pullRequestUrls.filter((one): one is string => typeof one === 'string')
      : [];
    const now: Bag = {
      ...held,
      pullRequestUrls: [pullRequest.url, ...urls.filter((one) => one !== pullRequest.url)],
      pullRequestBranchName: pullRequest.branch,
    };
    // The state is kept only while it names the URL being associated.
    delete now.pullRequestState;
    delete now.pullRequestStateUrl;
    if (held.pullRequestStateUrl === pullRequest.url) {
      now.pullRequestState = held.pullRequestState;
      now.pullRequestStateUrl = held.pullRequestStateUrl;
    }
    githubFacts.set(dir, now);
    metaMoved(dir);
  };

  /**
   * Ask git again, and tell everyone if the answer moved.
   *
   * A branch changes underneath a session - somebody checks one out in a
   * terminal - so it is re-read when a turn ends rather than only when a
   * session starts. `session/metaChanged` replaces `_meta` whole, which is
   * what `metaOf` writes.
   *
   * The facts and then the pull requests, which need the facts' remote, beside
   * the changes. Resolves once all of it is read, with whether the changes
   * moved. A read that fails is a read that moved nothing, so this never
   * rejects.
   */
  const readFacts = async (dir: string): Promise<boolean> => {
    const facts = (async () => {
      if (await options.directories?.refresh?.(dir) === true) metaMoved(dir);
      if (await refreshPullRequests(dir)) metaMoved(dir);
    })().catch(() => {});

    /*
     * And what it changed.
     *
     * The catalogue entry to the sessions here - the protocol has
     * `session/changesetsChanged` carry the *list* a session offers - and then
     * the files to each watched changeset of one, which is the same answer to a
     * different question: the list says which changesets there are, and a
     * watching client holds the files of one of them.
     */
    const files = (options.changes?.refresh?.(dir) ?? Promise.resolve(false)).then(async (moved) => {
      if (!moved) return false;
      for (const uri of inThere(dir)) {
        /*
         * Asked per session, because two of the scopes are the session's own;
         * a session whose backend serves its changesets has them said there.
         * Said only where it differs from the list the session's state holds,
         * as VS Code's state manager skips a catalogue equal to the one it has.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2587-L2609
         */
        const changesets = catalogueOf(uri, dir);
        if (!ctx.relaysChangesets(uri) && !isDeepStrictEqual(ctx.stateOf(uri)?.changesets ?? [], changesets))
          dispatch(uri, { type: 'session/changesetsChanged', changesets });
        ctx.summaryMoved(uri);
      }
      /*
       * The files themselves, as `refreshWatched` sends them. A directory
       * removed while this ran fails the reads that describe it, and the facts
       * are still the facts, so a failure here is not a failed read - the
       * answer below is whether the files moved.
       */
      try {
        for (const uri of toldIn(dir)) await contentMoved(uri);
      }
      catch {
        // Swallowed on purpose, for the reason above.
      }
      return true;
    }).catch(() => false);
    const [, moved] = await Promise.all([facts, files]);
    return moved;
  };
  /** `readFacts`, for a caller with nothing to wait for. */
  const refreshFacts = (dir: string): void => {
    void readFacts(dir);
  };
  /**
   * A plugin's key moved for one session.
   *
   * `session/metaChanged` carries the whole map, so the one place that composes
   * it answers for the plugin too; the row moves with it, as it does when the
   * directory's facts move.
   */
  const sessionMetaChanged = (uri: string): void => {
    const meta = describes(uri)._meta as Bag | undefined;
    dispatch(uri, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
    ctx.summaryMoved(uri);
  };
  /*
   * A plugin announces a change through the host it was applied to, which is
   * built after it and not before: `apply` returns a contribution and the
   * daemon folds it.
   *
   * Run again by `replace`, because a plugin a live fold brings holds an entry
   * nothing has set this on yet.
   */
  const wireSessionMeta = (): void => {
    for (const served of options.sessionMeta ?? []) served.changed = sessionMetaChanged;
  };
  wireSessionMeta();

  /**
   * A plugin's canvases reach the store through the host it was applied to.
   *
   * The store is read from `ctx` here and not closed over, because the host
   * sets this on each entry at start and again from `replace`, and one entry a
   * live fold brings has to reach the same store as the rest.
   */
  const wireCanvases = (): void => {
    for (const served of options.pluginCanvases ?? []) {
      served.open = (chat, state) => ctx.canvases.open(chat, state, served.by);
      served.update = (resource, state) => ctx.canvases.update(resource, state, served.by);
      served.close = (resource) => ctx.canvases.close(resource, served.by);
      // The unload road, which is the host's and not the plugin's: it is not
      // refused while the key is off, so an unloaded plugin takes its canvases
      // with it either way.
      served.closeAll = () => ctx.canvases.closeAll(served.by);
    }
  };
  wireCanvases();

  return {
    describes, setArtifacts, captureBaseline, recordPullRequest, metaMoved, dirOfFile, wroteThrough,
    refreshWatched, startWatchingDir, stopUnwatched, refreshPullRequests, readFacts, refreshFacts,
    sessionMetaChanged, wireSessionMeta, wireCanvases,
  };
}
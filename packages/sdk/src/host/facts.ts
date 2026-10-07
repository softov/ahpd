import { ARTIFACTS_META, artifactsIn, isGitHubLink, recordArtifact } from '../artifacttools.js';
import { idOf } from '../catalog.js';
import { localPath, uriOf } from '../fileuri.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';

/** What a session's directory says about it, and what the host asks to move it. */
export interface Facts {
  describes(uri: string): Bag;
  setArtifacts(uri: string, list: Bag[]): void;
  captureBaseline(uri: string, urls: string[]): void;
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
}

export function createFacts(ctx: HostContext): Facts {
  const {
    options, sessions, owners, connections, worktrees, githubFacts, kept, log, lent, dispatch,
    dirOf, leadOf, changesetAt, changesetOf, catalogueOf, contentMoved, operationsMoved, heldAs,
  } = ctx;

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
    const dir = dirOf(uri);
    if (dir === undefined) return undefined;
    const meta = options.directories?.meta(dir);
    const base = worktrees.get(uri)?.base;
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
    if (told === undefined && facts === undefined && artifacts === undefined) return undefined;
    // The folder the state belongs to, and the key it is published under. One
    // string for both, so a client that reads the key it was given and a
    // client that derives the key from the working directory arrive at the
    // same entry.
    const folder = uriOf(dir);
    return {
      ...told,
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

  /**
   * Capture a session's pull request baseline, once.
   *
   * Called the first time GitHub answers for the directory and again when a
   * session opens onto facts already held. The first answer wins: an empty
   * array is a captured baseline, and a later answer says what the branch
   * has now rather than what it had when the session began.
   */
  const captureBaseline = (uri: string, urls: string[]): void => {
    if (kept.pullRequests(idOf(uri)) !== undefined) return;
    kept.setPullRequests(idOf(uri), { initialPullRequestUrls: [...urls], associatedPullRequestUrls: [] });
  };
  /** The comparison the reference makes, so a URL with a trailing slash is the same one. */
  const urlKey = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();
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
    const meta = metaOf(uri);
    dispatch(uri, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
    ctx.summaryMoved(uri);
  };
  /**
   * What the agent running a session put in its `_meta`.
   *
   * Read off the backend's own state rather than kept here, so a key it adds
   * or drops is one this host follows without having to know about it. Empty
   * for a session nothing is running, which is not a gap: a browsed row has no
   * agent to have written anything.
   */
  const agentMeta = (uri: string): Bag => {
    const held = sessions.get(uri);
    const lead = held === undefined ? undefined : leadOf(held);
    const meta = (lead?.sessionState() as { _meta?: unknown } | undefined)?._meta;
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
     * exactly the one that still says whose it is, and `metaOf` answers only
     * for a session that is somewhere.
     */
    const owner = kept.owner(idOf(uri));
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
    if (dir === undefined) {
      const meta = { ...byAgent, ...(owner === undefined ? {} : { owner }) };
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
    const meta = { ...byAgent, ...told, ...(owner === undefined ? {} : { owner }) };
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
      const meta = metaOf(uri);
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
   * changeset a connection watches, under the name that connection watches it
   * by.
   */
  const toldIn = (dir: string): string[] => {
    const told = new Set(inThere(dir));
    for (const connection of connections) {
      for (const channel of connection.watching) {
        const at = changesetAt(channel);
        if (at === undefined || at.dir !== dir) continue;
        const named = heldAs(at.owner);
        if (!sessions.has(named) && owners.has(named)) told.add(at.owner);
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
      .filter((dir) => path === dir || path.startsWith(`${dir}/`))
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
              dispatch(uri, { type: 'session/changesetsChanged', changesets: catalogueOf(uri, dir) });
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
    const before = githubFacts.get(dir);
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(now)) return false;
    githubFacts.set(dir, now);
    // Every session in the directory that has no baseline yet began before
    // this answer, so this is the branch it started on.
    const urls = Array.isArray(now.pullRequestUrls)
      ? now.pullRequestUrls.filter((one): one is string => typeof one === 'string')
      : [];
    for (const uri of inThere(dir)) captureBaseline(uri, urls);
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
     * The catalogue entry rather than the changeset itself: the protocol has
     * `session/changesetsChanged` carry the *list* a session offers, and a
     * client that is watching one re-reads it from its own channel. Sending
     * the files here would be the same answer from two places.
     */
    const files = (options.changes?.refresh?.(dir) ?? Promise.resolve(false)).then((moved) => {
      if (!moved) return false;
      for (const uri of inThere(dir)) {
        // Asked per session, because two of the scopes are the session's own.
        dispatch(uri, { type: 'session/changesetsChanged', changesets: catalogueOf(uri, dir) });
        ctx.summaryMoved(uri);
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

  return {
    describes, setArtifacts, captureBaseline, recordPullRequest, metaMoved, dirOfFile, wroteThrough,
    refreshWatched, startWatchingDir, stopUnwatched, refreshPullRequests, readFacts, refreshFacts,
  };
}
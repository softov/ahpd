/** What git says a directory has changed, as a host's `ChangesetSource`. */

import { execFile } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ChangeWords, ChangesSummary, ChangesetFile, ChangesetOperation, ChangesetOperationResult, ChangesetSource, ChangesetState,
} from './types/changes.js';
import type { PullRequests } from './types/github.js';
import { commitPrompt, cutDiff, pullRequestPrompt, splitWords } from './changewords.js';
import { gitArgv } from './repo/hardened.js';
import { uriOf } from './fileuri.js';

/**
 * How many lines a file has, for one git will not count.
 *
 * Capped, because this is a *summary* and a row saying 40,000 is worth no more
 * than one saying a lot - and reading a hundred-megabyte file to find that out
 * is the expensive way to learn nothing.
 */
const lines = async (path: string): Promise<number> => {
  try {
    const text = await readFile(path, 'utf8');
    if (text === '') return 0;
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  }
  catch { return 0; }
};

/**
 * How many lines differ between two versions, without diffing them.
 *
 * A count, not a diff: the rows carry both sides and a client renders the
 * real thing from those. Computing a proper LCS here to fill in two numbers
 * would be the same work twice, once where nobody can see it.
 */
const counted = (before: string, after: string): { added: number; removed: number } => {
  // A final newline ends the last line rather than starting another.
  const linesIn = (text: string): string[] => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
  const was = linesIn(before);
  const now = linesIn(after);
  const shared = new Set(was);
  const added = now.filter((row) => !shared.has(row)).length;
  const kept_ = new Set(now);
  const removed = was.filter((row) => !kept_.has(row)).length;
  return { added, removed };
};

/**
 * The environment every `git` here runs with: the inherited one, with
 * `GIT_OPTIONAL_LOCKS=0`, git's switch for a background process. A `git
 * status` then refreshes no index, so it never holds `.git/index.lock` while a
 * person's own `git add` needs it. A lock git cannot do without is still taken.
 */
const quiet = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0' });

/** One `git` run, as text, or nothing when it would not run. */
const git = (dir: string, args: string[]): Promise<string | undefined> =>
  new Promise((answer) => {
    execFile('git', gitArgv(dir, args), { timeout: 5000, maxBuffer: 32 * 1024 * 1024, env: quiet() },
      (error, out) => answer(error ? undefined : out.toString()));
  });

/**
 * One `git` run, with the failure kept.
 *
 * `git` above answers `undefined` for every kind of not-working, which is the
 * right shape for a question - a directory that is not a repository has no
 * diff, and why is not interesting. An *operation* is the other case: somebody
 * pressed a button, it did not work, and the only useful thing to say is what
 * git said.
 */
const run = (dir: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> =>
  new Promise((answer) => {
    execFile('git', gitArgv(dir, args), { timeout: 30000, maxBuffer: 32 * 1024 * 1024, env: quiet() },
      (error, out, errOut) => answer({
        ok: !error,
        out: out.toString(),
        err: errOut.toString().trim() || (error ? error.message : ''),
      }));
  });

/**
 * Whether the index holds a change, which decides how `commit` runs.
 *
 * `--cached` compares the index against HEAD and `--quiet` answers through its
 * exit code. A repository with no commit yet has no HEAD to compare against, so
 * any entry in the index counts there.
 */
const indexHolds = async (dir: string): Promise<boolean> => {
  if (await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']) === undefined) {
    const listed = await git(dir, ['ls-files', '--cached']);
    return listed !== undefined && listed.trim() !== '';
  }
  const differs = await run(dir, ['diff', '--cached', '--quiet']);
  return !differs.ok;
};

/**
 * What a changeset's rows say, for deciding whether a re-read found a move.
 *
 * The counts alone miss `git add`: staging a file that was already changed moves
 * nothing in the summary and changes what a commit would take, which is the
 * answer a client holding the changeset is showing.
 */
const treeSignature = (value: { files: ChangesetFile[]; summary: ChangesSummary } | undefined): string =>
  JSON.stringify({
    summary: value?.summary ?? null,
    staging: (value?.files ?? []).map((one) => [one.id, one._meta?.['ahpd.staged'] === true, one._meta?.['ahpd.unstaged'] === true]),
  });

/**
 * A path with its symlinks resolved, keeping a name that does not exist yet.
 *
 * The real path of the nearest ancestor that does, with the rest appended: a
 * target that is not on disk still has to be judged by where it would land.
 */
const settled = async (path: string): Promise<string> => {
  const rest: string[] = [];
  let at = resolve(path);
  for (;;) {
    const real = await realpath(at).catch(() => undefined);
    if (real !== undefined) return rest.length === 0 ? real : join(real, ...rest);
    const up = dirname(at);
    if (up === at) return resolve(path);
    rest.unshift(basename(at));
    at = up;
  }
};

/**
 * The path a `file://` URI names, relative to the changeset's directory.
 *
 * The URI is decoded and resolved, and it is inside only when both the path as
 * written and the path with its symlinks followed are, so a target that leaves
 * the directory - by `..`, by a percent-escaped one or by a link - is not. The
 * answer is the path as written: git stages, restores and cleans a link as the
 * entry it is, not the file it points at. `.` is the directory itself, and
 * nothing for a URI that names no file.
 */
const pathIn = async (dir: string, uri: string): Promise<string | undefined> => {
  if (!uri.startsWith('file://')) return undefined;
  let asked: string;
  try { asked = resolve(fileURLToPath(uri)); }
  catch { return undefined; }
  const within = (rel: string): boolean => rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  const written = relative(resolve(dir), asked);
  if (!within(written) || !within(relative(await settled(dir), await settled(asked)))) return undefined;
  return written === '' ? '.' : written;
};

/**
 * The scheme for the side of an edit that is not on disk.
 *
 * `before` is what a file *used to be*, so no `file://` URI addresses it and
 * the filesystem port cannot serve it. This host mints its own URI and
 * resolves it itself, which is what `ChangesetSource.read` is for.
 */
const BEFORE = 'ahp-git:';

/** A path with each of its segments percent-encoded and its slashes kept. */
const escaped = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/**
 * A modified file's `before`, as `ahp-git://head/<absolute path>`.
 *
 * `head` is there so the authority is never empty: a client that parses and
 * re-prints a URI drops an empty authority's `//`.
 */
const beforeUri = (dir: string, path: string): string => `${BEFORE}//head${escaped(`${dir}/${path}`)}`;

/**
 * A URI as its authority and its decoded path segments, or nothing when it does not parse.
 *
 * A query or a fragment is rejoined to the path first: a client that parses
 * `a #1.md` reads `#1.md` as a fragment, and it is still part of the file's
 * name. A segment that does not decode is kept as it was written.
 */
const partsOf = (uri: string): { authority: string; segments: string[] } | undefined => {
  let url: URL;
  try { url = new URL(uri); }
  catch { return undefined; }
  const segments = `${url.pathname}${url.search}${url.hash}`.split('/').map((segment) => {
    try { return decodeURIComponent(segment); }
    catch { return segment; }
  });
  return { authority: url.host, segments };
};

/**
 * The scheme for a side that was *captured* rather than read.
 *
 * A turn's changeset is what the files looked like on either side of that
 * turn, and neither side is on disk once a later turn has run. Both are held
 * here and served from here.
 */
const CAPTURED = 'ahp-edit:';

/**
 * Uncommitted changes, from `git status` and `git diff`.
 *
 * ```ts
 * createHost({ path, agents, changes: gitChanges() });
 * ```
 *
 * Only the `uncommitted` scope. `session` and `turn/<id>` are the other two
 * the protocol defines, and neither can be answered from git alone: git knows
 * what a working tree looks like, not which turn made it look that way.
 */
/** One file, as a turn found it and as the turn left it. */
interface Captured {
  before?: string;
  after?: string;
}

/**
 * The verbs this source offers, declared once.
 *
 * Ids and labels follow the reference host's where it has one - a client that
 * special-cases `commit` should find it spelled the way it expects - and every
 * one of them writes, which is what the `writes` flag tells a client.
 */
const COMMIT: ChangesetOperation = {
  id: 'commit',
  label: 'Commit',
  description: 'Commit what is staged, or every change when nothing is',
  scopes: ['changeset'],
  icon: 'git-commit',
  group: 'commit',
  writes: true,
};

/**
 * The question `commit` asks, built from the last look at the directory.
 *
 * Taking the index and taking the whole tree are different acts, so the
 * sentence says which one this would be, names the subject line, and counts
 * what it would take. A session nobody has named is named by the fallback the
 * commit would use, so the sentence does not promise a title that will not be
 * there.
 */
const commitConfirmation = (files: readonly ChangesetFile[], subject: string | undefined): string => {
  const named = (subject ?? '').trim();
  const name = named === '' ? 'Changes from an agent session' : named;
  const staged = files.filter((one) => one._meta?.['ahpd.staged'] === true).length;
  if (staged > 0) {
    return `Commit ${staged} staged ${staged === 1 ? 'file' : 'files'} as '${name}'?`;
  }
  const untracked = files.filter((one) => one._meta?.['ahpd.staged'] !== true && one.edit.before === undefined).length;
  const counted = `${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  return `Commit ${counted}${untracked > 0 ? `, ${untracked} untracked` : ''}, as '${name}'?`;
};

const DISCARD: ChangesetOperation = {
  id: 'discard',
  label: 'Discard Changes',
  description: 'Put this file back the way HEAD has it',
  scopes: ['resource'],
  confirmation: 'Discard the changes to this file? This cannot be undone.',
  icon: 'discard',
  writes: true,
};

/** Staging a path, so the index holds it for the next commit. */
const STAGE: ChangesetOperation = {
  id: 'stage',
  label: 'Stage Changes',
  description: 'Add this file or folder to what the next commit takes',
  scopes: ['resource'],
  icon: 'add',
  group: 'stage',
};

/** Taking a path back out of the index, leaving the working tree as it is. */
const UNSTAGE: ChangesetOperation = {
  id: 'unstage',
  label: 'Unstage Changes',
  description: 'Take this file or folder out of what the next commit takes, keeping its changes',
  scopes: ['resource'],
  icon: 'remove',
  group: 'stage',
};

/**
 * Undoing the agent rather than undoing the working tree.
 *
 * Separate from `discard` because the two put a file back to different places:
 * `discard` goes to HEAD, which is where a person's own uncommitted work goes
 * too, and this goes to the state the turn found the file in - which is only
 * knowable because both sides were captured as the tool ran.
 */
const REVERT: ChangesetOperation = {
  id: 'revert',
  label: 'Revert This File',
  description: 'Put this file back the way the agent found it',
  scopes: ['resource'],
  confirmation: 'Put this file back the way the agent found it? Anything written since is lost.',
  icon: 'discard',
  writes: true,
};

/*
 * The reference host's pull request pair, under its ids and its labels.
 *
 * `prepare-pull-request` writes nothing: it answers a title, a body and the
 * branches, as a `data:application/json` follow-up the reference client reads
 * into its form (`agentPullRequestOperationMeta.ts`). `create-pr` is the
 * form's submit: what was typed arrives under `_meta['vscode.pullRequest']`,
 * and without it the operation does the same with what `prepare` would have
 * said. Both go on a changeset, not a file.
 */
const PREPARE_PR: ChangesetOperation = {
  id: 'prepare-pull-request',
  label: 'Prepare PR',
  description: 'Generate a pull request title and description and read repository merge options without changing the repository.',
  scopes: ['changeset'],
  icon: 'git-pull-request-create',
  group: 'pull-request',
};

const CREATE_PR: ChangesetOperation = {
  id: 'create-pr',
  label: 'Create PR',
  description: 'Commit what is uncommitted, push the branch, and open a pull request for it',
  scopes: ['changeset'],
  icon: 'git-pull-request-create',
  group: 'pull-request',
  writes: true,
};

/**
 * Check a branch out, before the session has done anything.
 *
 * The reference host offers this on an unused draft's uncommitted changeset,
 * which is where somebody picks the branch a session will start on. The
 * branch arrives as `_meta.treeish`, and `_meta.preCheckoutAction` says what
 * to do with a dirty tree first: `stash` or `commit`. Without either, a dirty
 * tree is a refusal carrying `reason: dirtyWorkingTree`, which is what the
 * reference client reads to offer the two.
 */
const CHECKOUT: ChangesetOperation = {
  id: 'checkout',
  label: 'Checkout',
  scopes: ['changeset'],
  group: 'checkout',
  writes: true,
};

/** The reference client's key for the pull request form's fields. */
const PR_META = 'vscode.pullRequest';

/** A branch name from a sentence, the way a person would shorten it. */
const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

/**
 * A failure the reference client reads more from than the message.
 *
 * `-32602` with `reason: dirtyWorkingTree` is what its checkout form branches
 * on to offer stashing or committing first; the host passes a thrown error's
 * `code` and `data` through as the request's.
 */
class OperationError extends Error {
  readonly code: number;
  readonly data: Record<string, unknown> | undefined;

  constructor(message: string, code: number, data?: Record<string, unknown>) {
    super(message);
    this.name = 'OperationError';
    this.code = code;
    this.data = data;
  }
}

export function gitChanges(): ChangesetSource {
  /**
   * What each turn changed, per session.
   *
   * `session -> turn -> path -> both sides`. Held rather than derived because
   * git cannot answer it: a working tree says what it looks like now, so a
   * turn asked about after two more have run would be handed their work too.
   */
  const seen = new Map<string, Map<string, Map<string, Captured>>>();

  /** The text held for a captured side, by `sideKey` of its session, turn, phase and path. */
  const kept = new Map<string, string>();
  const sideKey = (session: string, turn: string, phase: string, path: string): string =>
    [session, turn, phase, path].join('\u0000');

  /**
   * The text a confirmation is previewing, by the URI it is served under.
   *
   * Held between the question and the answer. A tool nobody has approved has
   * written nothing, so the file as it *would* be is on no disk, and the
   * client drawing the diff reads it from here.
   */
  const proposed = new Map<string, string>();
  /** The URI one call's preview was minted under, by the session and the call. */
  const proposedBy = new Map<string, string>();
  /**
   * A session and a call as one key.
   *
   * `settle` is given the two and not the path, so the URI cannot be built
   * again from them: it is remembered under this instead.
   */
  const proposedKey = (session: string, toolCallId: string): string => `${session}\u0000${toolCallId}`;

  /**
   * Which files somebody has ticked off, per changeset.
   *
   * A reader's bookkeeping rather than anything about the files: keyed by the
   * scope being read, because reviewing a turn is not reviewing the session
   * that contains it.
   */
  const reviewed = new Map<string, Set<string>>();
  const reviewKey = (session: string, scope: string): string => `${session}\u0000${scope}`;

  /**
   * A captured side, as `ahp-edit://turn/<session>/<turn>/<phase>/<path>`.
   *
   * The session is one base64url segment, which holds nothing a client
   * lowercases, decodes or splits; the turn, the phase and each segment of the
   * absolute path are percent-encoded.
   */
  const capturedUri = (session: string, turn: string, path: string, phase: string): string =>
    `${CAPTURED}//turn/${Buffer.from(session, 'utf8').toString('base64url')}`
    + `/${encodeURIComponent(turn)}/${encodeURIComponent(phase)}${escaped(path)}`;

  /**
   * A proposed side, as `ahp-edit://pending/<session>/<call>/<path>`.
   *
   * A captured side's shape under an authority of its own, and for the same
   * reason: the text is one this source is holding, and no `file:` URI
   * resolves to it. The session is one base64url segment, which holds nothing
   * a client lowercases, decodes or splits; the call id and each segment of
   * the absolute path are percent-encoded.
   */
  const pendingUri = (session: string, toolCallId: string, path: string): string =>
    `${CAPTURED}//pending/${Buffer.from(session, 'utf8').toString('base64url')}`
    + `/${encodeURIComponent(toolCallId)}${escaped(path)}`;

  /**
   * The `kept` key an `ahp-edit:` URI names, or nothing when no side is held under it.
   *
   * Under the `turn` authority the session is the first segment, in base64url.
   * Under any other authority the authority is the session, percent-encoded.
   * The turn is everything up to the phase: a scope such as `compare/<a>/<b>`
   * is one encoded segment as minted, and several once a client has decoded
   * its `%2F`, so each place a phase could start is tried.
   */
  const sideOf = (uri: string): string | undefined => {
    const parts = partsOf(uri);
    if (parts === undefined) return undefined;
    let session: string;
    let rest: string[];
    if (parts.authority === 'turn') {
      session = Buffer.from(parts.segments[1] ?? '', 'base64url').toString('utf8');
      rest = parts.segments.slice(2);
    }
    else {
      try { session = decodeURIComponent(parts.authority); }
      catch { return undefined; }
      rest = parts.segments.slice(1);
    }
    for (let at = 1; at < rest.length; at++) {
      const phase = rest[at] as string;
      if (phase !== 'before' && phase !== 'after') continue;
      const key = sideKey(session, rest.slice(0, at).join('/'), phase, `/${rest.slice(at + 1).join('/')}`);
      if (kept.has(key)) return key;
    }
    return undefined;
  };

  /**
   * Fold a run of turns into one edit per file.
   *
   * The first `before` and the last `after`, which is what a range of turns
   * changed taken together: a file edited three times was found in one state
   * and left in another, and the two states in between are the middle of a
   * diff nobody asked for.
   */
  const fold = (turns: Iterable<Map<string, Captured>>): Map<string, Captured> => {
    const flat = new Map<string, Captured>();
    for (const files of turns) {
      for (const [path, sides] of files) {
        const already = flat.get(path);
        // The first `before` and the last `after`: a session's changeset is
        // the whole conversation as one edit, not the last turn of it.
        flat.set(path, {
          ...(already?.before !== undefined ? { before: already.before } : sides.before !== undefined ? { before: sides.before } : {}),
          ...(sides.after !== undefined ? { after: sides.after } : already?.after !== undefined ? { after: already.after } : {}),
        });
      }
    }
    return flat;
  };

  /** Every file a session has touched, in the order it touched them. */
  const across = (session: string): Map<string, Captured> =>
    fold([...(seen.get(session) ?? new Map()).values()]);

  /**
   * The turns from one to another, inclusive.
   *
   * Insertion order is turn order - a turn is first seen when its first tool
   * runs - so a range is a slice. Either end being unknown is a question about
   * something that did not happen, and answers nothing rather than everything.
   */
  const between = (session: string, from: string, to: string): Map<string, Captured> | undefined => {
    const turns = seen.get(session);
    if (!turns) return undefined;
    const order = [...turns.keys()];
    const start = order.indexOf(from);
    const end = order.indexOf(to);
    if (start < 0 || end < 0) return undefined;
    const [lo, hi] = start <= end ? [start, end] : [end, start];
    return fold(order.slice(lo, hi + 1).map((id) => turns.get(id) as Map<string, Captured>));
  };

  /**
   * Captured sides as the protocol's rows, with both sides fetchable.
   *
   * Minting a URI and remembering what is behind it are the same act, so they
   * are done in the same place: a row that names content nothing can resolve
   * is a row that opens onto an error.
   */
  const rowsOf = (session: string, turn: string, files: Map<string, Captured>): ChangesetFile[] => {
    const ticked = reviewed.get(reviewKey(session, turn));
    return [...files].map(([path, sides]) => {
      /*
       * One builder, because this URI is three things at once: the row's `id`,
       * the key a tick is remembered under, and what a client hands back. A
       * path holding a space or a `#` is a different file under each spelling,
       * so the three have to agree.
       */
      const uri = uriOf(path);
      const before = capturedUri(session, turn, path, 'before');
      const after = capturedUri(session, turn, path, 'after');
      if (sides.before !== undefined) kept.set(sideKey(session, turn, 'before', path), sides.before);
      if (sides.after !== undefined) kept.set(sideKey(session, turn, 'after', path), sides.after);
      return {
        id: uri,
        edit: {
          // An empty `before` is a file the turn created, and the protocol
          // says a creation by leaving the side out rather than by a word.
          ...(sides.before ? { before: { uri, content: { uri: before } } } : {}),
          ...(sides.after !== undefined ? { after: { uri, content: { uri: after } } } : {}),
          diff: counted(sides.before ?? '', sides.after ?? ''),
        },
        // Absent is not-yet-reviewed, which is what the protocol says a
        // missing value means, so only a tick is worth sending.
        ...(ticked?.has(uri) ? { reviewed: true } : {}),
      };
    });
  };

  /**
   * The files one captured scope holds, by absolute path.
   *
   * The same branch `state` takes, wanted twice: an operation on a captured
   * scope needs the side the turn *found* the file in, and there is nowhere
   * else that survives - git only ever knows what the tree looks like now.
   */
  const capturedFor = (session: string, scope: string): Map<string, Captured> | undefined => {
    if (scope === 'session') return across(session);
    if (scope.startsWith('compare/')) {
      const [from, to] = scope.slice('compare/'.length).split('/');
      if (!from || !to) return undefined;
      return between(session, from, to);
    }
    if (scope.startsWith('turn/')) return seen.get(session)?.get(scope.slice('turn/'.length));
    return undefined;
  };

  /** The last answer per directory, so a catalogue of rows is not a hundred `git` runs. */
  const held = new Map<string, { files: ChangesetFile[]; summary: ChangesSummary }>();

  /**
   * What changed, as one pass over `git status` and one over `git diff`.
   *
   * `--porcelain=v1 -z` because a filename may contain anything a shell would
   * otherwise eat, newlines included; the NUL form is the only one that
   * survives a path somebody made on purpose.
   */
  const look = async (dir: string): Promise<{ files: ChangesetFile[]; summary: ChangesSummary } | undefined> => {
    const status = await git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (status === undefined) return undefined;
    /*
     * Where the directory sits in its repository, as `sub/` or empty at the
     * root. Porcelain and numstat paths are the repository root's, so a path
     * is under the directory when it starts with this, and names the file
     * at the rest of it inside the directory.
     */
    const prefix = (await git(dir, ['rev-parse', '--show-prefix']))?.trim() ?? '';

    /** Line counts per path, for the files git can already diff. */
    const counts = new Map<string, { added: number; removed: number }>();
    const numstat = await git(dir, ['diff', '--numstat', '-z', 'HEAD']) ?? '';
    /*
     * `added<TAB>removed<TAB>path` per record, NUL between records.
     *
     * The tabs are *inside* a record and only the separator is NUL, which is
     * the whole point of `-z`: a path may contain a tab, and it may contain a
     * newline, and neither ends the record. A rename writes an empty path and
     * then two records of its own, old name and new.
     */
    const counted = numstat.split('\0');
    for (let i = 0; i < counted.length; i++) {
      const record = counted[i] as string;
      if (record === '') continue;
      const [rawAdded, rawRemoved, path] = record.split('\t');
      // `-` on both sides is a binary file, which has no lines to count.
      const added = Number(rawAdded);
      const removed = Number(rawRemoved);
      const named = path === '' || path === undefined
        // A rename: the two records after this one are the old and new names,
        // and it is the new one the working tree has.
        ? (i += 2, counted[i] as string | undefined)
        : path;
      if (!named) continue;
      counts.set(named, {
        added: Number.isFinite(added) ? added : 0,
        removed: Number.isFinite(removed) ? removed : 0,
      });
    }

    const files: ChangesetFile[] = [];
    const summary: ChangesSummary = { files: 0, additions: 0, deletions: 0 };
    const records = status.split('\0').filter((record) => record !== '');
    for (let at = 0; at < records.length; at++) {
      // `XY <path>`: two status letters, a space, then the path. `X` is the
      // index and `Y` the working tree, which is the whole of what staging is.
      const record = records[at] as string;
      const code = record.slice(0, 2);
      const fromRoot = record.slice(3);
      if (fromRoot === '') continue;
      // A rename or a copy, in the index column or the working-tree one, writes
      // a second NUL record after its own, holding the path the file came from,
      // and it is consumed here or it is read as a row of its own with a status
      // made of that path's first two letters.
      if (/[RC]/.test(code)) at += 1;
      // A change elsewhere in the repository is not this directory's.
      if (!fromRoot.startsWith(prefix)) continue;
      const path = fromRoot.slice(prefix.length);
      const gone = code.includes('D');
      const fresh = code.includes('A') || code.includes('?');
      // `?` is git's untracked mark, and an untracked file is in neither the
      // index nor HEAD: it is a working-tree change and never a staged one.
      const staged = (code[0] ?? ' ') !== ' ' && (code[0] ?? ' ') !== '?';
      const unstaged = (code[1] ?? ' ') !== ' ';
      const uri = uriOf(`${dir}/${path}`);
      // An untracked file is in no diff against HEAD, so git reports nothing
      // for it. Every line of it is an addition, which is what it is.
      const count = counts.get(fromRoot) ?? (fresh
        ? { added: await lines(`${dir}/${path}`), removed: 0 }
        : { added: 0, removed: 0 });

      files.push({
        id: uri,
        edit: {
          // Absent `before` is a creation and absent `after` a deletion. The
          // protocol says both by leaving a side out rather than by a word.
          ...(fresh ? {} : {
            before: { uri, content: { uri: beforeUri(dir, path) } },
          }),
          ...(gone ? {} : {
            after: { uri, content: { uri } },
          }),
          diff: { added: count.added, removed: count.removed },
        },
        // A file can be both (`MM`): staged, then changed again. Saying only one
        // of the two would hide half of what a commit form has to decide.
        _meta: { 'ahpd.staged': staged, 'ahpd.unstaged': unstaged },
      });
      summary.files = (summary.files ?? 0) + 1;
      summary.additions = (summary.additions ?? 0) + count.added;
      summary.deletions = (summary.deletions ?? 0) + count.removed;
    }
    return { files, summary };
  };

  /**
   * The branches a pull request would go between, as the tree stands.
   *
   * The base is the host's when it cut a worktree, and otherwise the remote's
   * default branch, which is what `origin/HEAD` points at; a repository with
   * neither is asked for `main` and then `master`, which is where most of
   * them are. The upstream is read so a branch pushed under another name is
   * requested under that name.
   */
  const branches = async (dir: string, base: string | undefined): Promise<{ branch: string; base: string; upstream?: string }> => {
    const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
    if (branch === undefined || branch === '' || branch === 'HEAD') throw new Error('The working tree is not on a branch.');
    let found = base;
    if (found === undefined) {
      const head = (await git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))?.trim();
      if (head !== undefined && head !== '') found = head.replace(/^origin\//, '');
    }
    if (found === undefined) {
      for (const candidate of ['main', 'master']) {
        if (await git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]) !== undefined) { found = candidate; break; }
      }
    }
    if (found === undefined) throw new Error('Could not tell which branch a pull request would go to.');
    const upstream = (await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']))?.trim();
    return { branch, base: found, ...(upstream !== undefined && upstream !== '' ? { upstream } : {}) };
  };

  /** What the reference client checks a prepared form against before submitting it. */
  const contextOf = (dir: string, repo: { owner: string; repo: string }, at: { branch: string; base: string; upstream?: string }) => ({
    workingDirectory: uriOf(dir),
    repository: `${repo.owner}/${repo.repo}`,
    branchName: at.branch,
    baseBranchName: at.base,
    ...(at.upstream !== undefined ? { upstreamBranchName: at.upstream } : {}),
  });

  /**
   * Whether this place is writing a commit or a pull request's words.
   *
   * The two differ in more than their prompt: a commit with nothing said is
   * refused in forced mode, and a pull request is a form somebody is about to
   * fill in.
   */
  type WordsKind = 'commit' | 'pull-request';

  /** What a place that writes words has in hand when it asks. */
  interface WordsGiven {
    /** The directory the work is in, for the commits and the diff. */
    dir: string;
    /*
     * Every one but `dir` is optional *and* may be passed as an explicit
     * `undefined`, because the host hands over whatever it has: a session with
     * no title, an operation with no conversation. Writing the `undefined` into
     * the type is what `exactOptionalPropertyTypes` asks for, and the
     * alternative is a call site that builds each argument up with a spread.
     */
    /** What the person typed, when they typed anything. */
    text?: string | undefined;
    /** The session's own title, which the host reads as the subject. */
    subject?: string | undefined;
    /** The branch the words are about. */
    branch?: string | undefined;
    /** The branch the work goes to, for a pull request. */
    base?: string | undefined;
    /** What has been said in the session. */
    conversation?: string | undefined;
    /** The line a commit keeps when there is no subject at all. */
    fallback?: string | undefined;
  }

  /** What one place's words came to, and whether they were the ones asked for. */
  interface Words {
    title: string;
    description: string;
    /** Why the session title was used instead of what the setting named. */
    fellBack?: string;
  }

  /**
   * The paths and the diff a prompt carries.
   *
   * Uncommitted work includes files git has never seen, which `git diff` says
   * nothing about, so a commit's list is widened by the untracked ones - a
   * model writing a message for a new file is the case that would otherwise
   * be handed an empty list.
   */
  const changedBy = async (dir: string, args: string[], untracked: boolean): Promise<{ files: string[]; diff: string }> => {
    const names = (await git(dir, ['diff', '--name-only', ...args]))?.trim() ?? '';
    const listed = names === '' ? [] : names.split('\n');
    const others = untracked ? (await git(dir, ['ls-files', '--others', '--exclude-standard']))?.trim() ?? '' : '';
    const diff = await git(dir, ['diff', ...args]) ?? '';
    return {
      files: others === '' ? listed : [...listed, ...others.split('\n')],
      diff: cutDiff(diff),
    };
  };

  /**
   * A title and a body, without a model to write them.
   *
   * The session's own title is the sentence somebody already wrote about this
   * work, and the commits on the branch are what was done; between them a
   * reviewer knows what the request is. A branch with nothing committed yet
   * has only the first. A commit keeps the subject line alone, because the
   * body of a commit is not what a row can hold.
   */
  const wordsFromSession = async (kind: WordsKind, given: WordsGiven): Promise<Words> => {
    const line = (given.subject ?? '').split('\n')[0]?.trim();
    if (kind === 'commit') {
      return {
        title: line !== undefined && line !== '' ? line : (given.fallback ?? 'Changes from an agent session'),
        description: '',
      };
    }
    const log = (await git(given.dir, ['log', '--format=%s', `${given.base}..${given.branch}`]))?.trim() ?? '';
    const commits = log === '' ? [] : log.split('\n');
    const title = line !== undefined && line !== '' && line !== 'New session' ? line : (commits[0] ?? given.branch ?? '');
    const description = commits.length > 0
      ? commits.map((one) => `- ${one}`).join('\n')
      : `Changes from an agent session on \`${given.branch}\`.`;
    return { title, description };
  };

  /**
   * The words for one place, from wherever the host says they come from.
   *
   * The one function all three places that write words go through - the commit
   * operation, the commit `create-pr` makes of a dirty tree before it opens
   * the request, and the pull request's own title and description - so a
   * setting cannot be honoured in one of them and forgotten in another.
   *
   * The person's own text wins in every mode: the setting says what happens
   * when they gave none, not whether what they typed is used. In the two modes
   * that ask, the source builds the prompt here and the host answers it; an
   * answer that never came, or came back empty, is the session title with a
   * sentence saying so, which is the reference host's own fallback.
   */
  const wordsFor = async (kind: WordsKind, setting: ChangeWords | undefined, given: WordsGiven): Promise<Words> => {
    const typed = (given.text ?? '').trim();
    if (typed !== '') return { title: typed, description: '' };
    const mode = setting?.setting.mode ?? 'session-title';
    if (mode === 'forced') {
      /*
       * A commit with nothing typed is the refusal this mode is for.
       *
       * A pull request is the other way round: the form it is prepared from is
       * how the person gives the text, so an empty form is the question rather
       * than an answer, and `create-pr` refuses a title that is still empty
       * when the request is actually opened.
       */
      if (kind === 'commit') throw new Error('A commit message is required.');
      return { title: '', description: '' };
    }
    if (mode === 'model' || mode === 'agent') {
      const said = mode === 'model' ? 'the model did not answer' : 'the agent did not answer';
      const ask = setting?.ask;
      if (ask !== undefined) {
        let answer: string | undefined;
        try { answer = await ask(await askOf(kind, given)); }
        catch { answer = undefined; }
        const words = answer === undefined ? undefined : splitWords(answer);
        if (words !== undefined) return words;
        return { ...await wordsFromSession(kind, given), fellBack: `${said}, so the session title was used` };
      }
      const why = setting?.why ?? (mode === 'model' ? 'no model is named' : 'no chat can be asked');
      return { ...await wordsFromSession(kind, given), fellBack: `${why}, so the session title was used` };
    }
    return wordsFromSession(kind, given);
  };

  /**
   * One commit message out of a title and a body.
   *
   * A body is carried when there is one, which is what a model that answered a
   * subject and a paragraph asked for. The session title has no body, so a
   * commit under it is the subject line it always was.
   */
  const asMessage = (words: Words): string =>
    words.description === '' ? words.title : `${words.title}\n\n${words.description}`;

  /** The prompt one place sends, over what changed and what was said. */
  const askOf = async (kind: WordsKind, given: WordsGiven): Promise<string> => {
    const at = kind === 'commit'
      ? await changedBy(given.dir, ['HEAD'], true)
      : await changedBy(given.dir, [`${given.base}...${given.branch}`], false);
    const what = {
      ...(given.branch !== undefined ? { branch: given.branch } : {}),
      ...(given.base !== undefined ? { base: given.base } : {}),
      files: at.files,
      diff: at.diff,
      ...(given.conversation !== undefined ? { conversation: given.conversation } : {}),
    };
    return kind === 'commit' ? commitPrompt(what) : pullRequestPrompt(what);
  };

  /**
   * `prepare-pull-request` and `create-pr`, as the reference host runs them.
   *
   * Prepare answers the form's contents and touches nothing. Create commits
   * what is uncommitted - on a branch of its own first, when the tree is on
   * the base branch - pushes, and opens the request, or answers the one the
   * branch already has. `expectedContext` is the client checking that the
   * tree still stands where the form was prepared against, and a tree that
   * moved is a refusal in the reference host's words.
   */
  const pullRequest = async (
    dir: string,
    operationId: string,
    subject: string | undefined,
    meta: Record<string, unknown>,
    base: string | undefined,
    github: { ask: PullRequests; token?: string; owner: string; repo: string },
    changeWords: ChangeWords | undefined,
    conversation: string | undefined,
  ): Promise<ChangesetOperationResult> => {
    const asked = (typeof meta[PR_META] === 'object' && meta[PR_META] !== null ? meta[PR_META] : undefined) as Record<string, unknown> | undefined;
    const repo = { owner: github.owner, repo: github.repo };
    const at = await branches(dir, base);
    const expected = asked?.expectedContext;
    if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(contextOf(dir, repo, at))) {
      throw new Error('The repository or branches have changed since this pull request was prepared. Reopen Create PR to review the current details.');
    }
    if (operationId === 'prepare-pull-request') {
      if (asked?.validateOnly === true) return {};
      const details = {
        ...await wordsFor('pull-request', changeWords, { dir, subject, branch: at.branch, base: at.base, conversation }),
        branchName: at.branch,
        baseBranchName: at.base,
        repository: `${repo.owner}/${repo.repo}`,
        autoMergeAllowed: false,
        mergeMethods: [],
        agentMergeAvailable: false,
        context: contextOf(dir, repo, at),
      };
      return { followUp: { content: { uri: `data:application/json,${encodeURIComponent(JSON.stringify(details))}`, contentType: 'application/json' } } };
    }
    if (asked !== undefined) {
      if (typeof asked.title !== 'string' || asked.title.trim() === '') throw new Error('A pull request title is required.');
      if (asked.agentMerge === true) throw new Error('Agent Merge is not available on this host.');
      if (asked.autoMergeMethod !== undefined) throw new Error('The repository does not allow the requested auto-merge method.');
    }
    const dirty = (await git(dir, ['status', '--porcelain']))?.trim() !== '';
    let branch = at.branch;
    if (dirty && branch === at.base) {
      // Not on the base branch: a request from `main` to `main` is nothing, so
      // the work gets a branch of its own, named after what it is.
      const line = (subject ?? '').split('\n')[0]?.trim() ?? '';
      const stem = slug(line !== '' && line !== 'New session' ? line : 'changes') || 'changes';
      let name = `agent/${stem}`;
      for (let n = 2; await git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== undefined; n++) name = `agent/${stem}-${n}`;
      const made = await run(dir, ['checkout', '-b', name]);
      if (!made.ok) throw new Error(`Failed to create a branch before creating a pull request: ${made.err}`);
      branch = name;
    }
    if (dirty) {
      const staged = await run(dir, ['add', '-A']);
      if (!staged.ok) throw new Error(`Failed to commit changes before creating a pull request: ${staged.err}`);
      // The same setting as the Commit button: this is a commit, and one
      // written by a different rule would be the setting honoured everywhere
      // but here.
      const message = asMessage(await wordsFor('commit', changeWords, {
        dir, subject, conversation, fallback: `Changes on ${branch}`,
      }));
      const done = await run(dir, ['commit', '-m', message]);
      if (!done.ok) throw new Error(`Failed to commit changes before creating a pull request: ${done.err || done.out.trim()}`);
    }
    const ahead = (await git(dir, ['rev-list', '--count', `${at.base}..${branch}`]))?.trim();
    if (ahead === '0') throw new Error('There are no branch changes to create a pull request for.');
    /*
     * Pushed where the branch already goes, and to `origin` under its own
     * name when it goes nowhere yet. `-u` only then: an upstream already
     * chosen is not this operation's to change.
     */
    const upstream = at.branch === branch ? at.upstream : undefined;
    const [remote, head] = upstream !== undefined && upstream.includes('/')
      ? [upstream.slice(0, upstream.indexOf('/')), upstream.slice(upstream.indexOf('/') + 1)]
      : ['origin', branch];
    const pushed = await run(dir, ['push', ...(upstream === undefined ? ['-u'] : []), remote, `${branch}:${head}`]);
    if (!pushed.ok) throw new Error(`Failed to push branch '${branch}': ${pushed.err}`);
    /*
     * The words the request goes in with: the form's when somebody filled it
     * in, and the host's setting when nobody did.
     *
     * The setting is not asked when the form already answered. A model asked
     * to name a pull request somebody has already named is a second answer to
     * a question nobody asked, and a turn paid for each time.
     */
    const filled = typeof asked?.title === 'string' ? asked.title.trim() : '';
    const said = filled !== ''
      ? { title: filled, description: typeof asked?.description === 'string' ? asked.description : '' }
      : await wordsFor('pull-request', changeWords, { dir, subject, branch, base: at.base, conversation });
    /*
     * A forced host writes no words and the form carried none either, so there
     * is nothing to open a request with. Said here rather than earlier,
     * because a request the branch already has is answered whatever the title
     * would have been.
     */
    if (said.title === '') throw new Error('A pull request title is required.');
    const why = said.fellBack === undefined ? '' : ` - ${said.fellBack}`;
    const existing = (await github.ask.forBranch(repo, head, github.token, dir)).find((one) => one.state === 'open');
    if (existing !== undefined) {
      return {
        message: `Pushed ${branch}; its pull request is ${existing.url}${why}`,
        followUp: { content: { uri: existing.url, contentType: 'text/html' }, external: true },
        pullRequest: {
          url: existing.url,
          // The port's title when it has one, and what the request was opened or found under otherwise.
          title: existing.title ?? said.title,
          branch: head,
        },
      };
    }
    const opened = await github.ask.create(repo, {
      title: said.title,
      body: said.description,
      head,
      base: at.base,
      draft: asked?.draft === true,
    }, github.token, dir);
    return {
      message: `Opened ${opened.url}${why}`,
      followUp: { content: { uri: opened.url, contentType: 'text/html' }, external: true },
      pullRequest: {
        url: opened.url,
        title: opened.title ?? said.title,
        branch: head,
      },
    };
  };

  /** `checkout`, as the reference host runs it. */
  const checkout = async (dir: string, meta: Record<string, unknown>): Promise<ChangesetOperationResult> => {
    const treeish = typeof meta.treeish === 'string' && meta.treeish !== '' ? meta.treeish : undefined;
    if (treeish === undefined) throw new Error('Select a branch to check out.');
    if (treeish.startsWith('-') || await git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${treeish}`]) === undefined) {
      throw new Error(`Branch '${treeish}' is not an existing local branch.`);
    }
    const before = meta.preCheckoutAction === 'stash' || meta.preCheckoutAction === 'commit' ? meta.preCheckoutAction : undefined;
    if (before === 'stash') {
      const stashed = await run(dir, ['stash', 'push', '--include-untracked', '-m', `WIP: Changes before checking out ${treeish}`]);
      if (!stashed.ok) throw new Error(`Failed to stash changes before checking out '${treeish}': ${stashed.err}`);
    }
    else if (before === 'commit') {
      const staged = await run(dir, ['add', '-A']);
      const done = staged.ok ? await run(dir, ['commit', '-m', `WIP: Save changes before checking out ${treeish}`]) : staged;
      if (!done.ok) throw new Error(`Failed to commit changes before checking out '${treeish}': ${done.err || done.out.trim()}`);
    }
    const out = await run(dir, ['checkout', treeish]);
    if (!out.ok) {
      if (before === undefined && /would be overwritten by checkout/.test(out.err)) {
        throw new OperationError(
          `Your local changes would be overwritten by checkout. Commit or stash the current changes before checking out \`${treeish}\`.`,
          -32602,
          { reason: 'dirtyWorkingTree' },
        );
      }
      throw new Error(`Failed to check out '${treeish}': ${out.err}`);
    }
    return { message: { markdown: `Checked out branch \`${treeish}\`.` } };
  };

  return {
    scopes: (dir, session) => {
      const scopes = held.has(dir)
        ? [{
          id: 'uncommitted',
          label: 'Uncommitted Changes',
          description: 'The working tree, against HEAD',
          changeKind: 'uncommitted',
          // Not reviewable: the working tree is whatever it is now, and a
          // tick against a file that something else may rewrite underneath it
          // is bookkeeping about a thing that has moved.
        }]
        : [];
      const turns = seen.get(session);
      if (!turns || turns.size === 0) return scopes;
      // The working tree first. A client that shows one changeset shows the
      // first, VS Code opens it, and `commit` is offered on the working tree
      // alone - so the session's own changes must not come before it. "This
      // Session" stays in the picker, and what a *conversation* changed is
      // still the one that belongs beside a conversation.
      return [
        ...scopes,
        {
          id: 'session',
          label: 'This Session',
          description: 'Everything this conversation changed',
          changeKind: 'session',
          reviewable: true,
        },
        // Templates, which is how the protocol offers a scope that has to be
        // filled in: a client expands them from turns it can already see.
        {
          id: 'turn/{turnId}',
          label: 'This Turn',
          description: 'What one turn changed',
          changeKind: 'turn',
          reviewable: true,
        },
        {
          id: 'compare/{originalTurnId}/{modifiedTurnId}',
          label: 'Between Two Turns',
          description: 'What changed from one turn to another',
          changeKind: 'compare-turns',
          reviewable: true,
        },
      ];
    },

    state: async (dir, session, scope) => {
      if (scope === 'uncommitted') {
        const found = held.get(dir) ?? await look(dir);
        if (!found) return undefined;
        return { status: 'ready', files: found.files };
      }
      if (scope === 'session') {
        const files = across(session);
        if (files.size === 0) return { status: 'ready', files: [] };
        return { status: 'ready', files: rowsOf(session, 'session', files) };
      }
      if (scope.startsWith('compare/')) {
        const [from, to] = scope.slice('compare/'.length).split('/');
        if (!from || !to) return undefined;
        const files = between(session, from, to);
        if (!files) return undefined;
        return { status: 'ready', files: rowsOf(session, `compare/${from}/${to}`, files) };
      }
      if (scope.startsWith('turn/')) {
        const turn = scope.slice('turn/'.length);
        const files = seen.get(session)?.get(turn);
        // A turn nobody has heard of is not an empty changeset - it is a
        // question about something that did not happen.
        if (!files) return undefined;
        return { status: 'ready', files: rowsOf(session, turn, files) };
      }
      return undefined;
    },

    /*
     * Both sides of a file, captured as the tool runs.
     *
     * `before` is read as the tool is announced and `after` when its result
     * arrives. A file that did not exist reads as empty, which is what a
     * creation is. A side the caller hands over is taken rather than read,
     * because by the time an agent says it changed a file the only copy of
     * what it held is the diff it sent.
     */
    observe: (dir, session, turnId, path, phase, given) =>
      (async () => {
        const text = given ?? await readFile(path, 'utf8').catch(() => undefined);
        const turns = seen.get(session) ?? new Map<string, Map<string, Captured>>();
        seen.set(session, turns);
        const files = turns.get(turnId) ?? new Map<string, Captured>();
        turns.set(turnId, files);
        const sides = files.get(path) ?? {};
        // The first `before` wins: a turn that edits one file twice found it
        // in one state, and the second read is already its own work.
        if (phase === 'before' && sides.before === undefined) sides.before = text ?? '';
        if (phase === 'after') sides.after = text ?? '';
        files.set(path, sides);

        kept.set(sideKey(session, turnId, phase, path), text ?? '');

        /*
         * A file that has changed again is not the file that was reviewed.
         *
         * The protocol makes this the server's job - it is the authority on
         * what changed - and says to reset explicitly rather than leave a tick
         * standing against content nobody has read. Only on `after`, because
         * `before` is the state a tick was about.
         */
        if (phase === 'after') {
          for (const scope of [turnId, 'session']) {
            // The same builder the row was minted with, or the tick keeps
            // standing against a URI the tick was never made under.
            reviewed.get(reviewKey(session, scope))?.delete(uriOf(path));
          }
        }
      })().catch(() => {}),

    /*
     * A file a person is being asked to approve, held until they answer.
     *
     * The other half of `observe`, and the opposite one: a captured side is
     * what a turn did, and this is what a tool *would* do, which is why it
     * exists only while the question is open. The file is read because it is
     * what the tool was offered, and `apply` turns it into the text the client
     * will be shown.
     */
    propose: async (_dir, session, toolCallId, path, apply) => {
      const current = await readFile(path, 'utf8').catch(() => undefined);
      const text = apply(current);
      if (text === undefined) return undefined;
      const key = proposedKey(session, toolCallId);
      // A call that asks twice is waiting on one answer, the last one, so the
      // URI it minted before goes rather than being held for ever.
      const already = proposedBy.get(key);
      if (already !== undefined) proposed.delete(already);
      const uri = pendingUri(session, toolCallId, path);
      proposed.set(uri, text);
      proposedBy.set(key, uri);
      /*
       * Both sides name the file itself, and only the `after` content is this
       * source's to serve: what the tool would leave is on no disk yet. The
       * `before` side is left out when there is no file, which is how the
       * protocol says a creation. No `diff`: the tool sends no unified diff
       * for this source to count.
       */
      const file = uriOf(path);
      return {
        ...(current === undefined ? {} : { before: { uri: file, content: { uri: file } } }),
        after: { uri: file, content: { uri } },
      };
    },

    /*
     * The answer is in, or the session is gone: the text goes with it.
     *
     * Nothing else is done on the way out. A tool that was approved has
     * written the file by now, and the file is where its text is read from.
     */
    settle: (session, toolCallId) => {
      const key = proposedKey(session, toolCallId);
      const uri = proposedBy.get(key);
      if (uri === undefined) return;
      proposedBy.delete(key);
      proposed.delete(uri);
    },

    summary: (dir) => held.get(dir)?.summary,

    /*
     * The `before` side, out of git rather than off the disk.
     *
     * `git show HEAD:<path>` is what the file was at the last commit, which is
     * the only place that version still exists.
     */
    read: async (uri) => {
      /*
       * A preview, which is the one thing here that is not a change of the
       * past: the file the tool was offered has not been written yet. Read
       * first, because it is looked up whole rather than parsed - a pending
       * URI says nothing a phase walk could find.
       */
      const previewing = proposed.get(uri);
      if (previewing !== undefined) return { data: previewing, encoding: 'utf-8' };
      // Captured sides are held, not fetched: neither is on disk any more.
      if (uri.startsWith(CAPTURED)) {
        const key = sideOf(uri);
        const text = key === undefined ? undefined : kept.get(key);
        return text === undefined ? undefined : { data: text, encoding: 'utf-8' };
      }
      if (!uri.startsWith(BEFORE)) return undefined;
      // `head`, or an empty authority, which a client prints as `ahp-git:/<path>`
      // or `ahp-git:///<path>`.
      const parts = partsOf(uri);
      if (parts === undefined || (parts.authority !== 'head' && parts.authority !== '')) return undefined;
      const rest = parts.segments.join('/');
      // The directory is the longest known one this URI starts with: a path
      // has slashes and so does a directory, and splitting on the first one
      // would name neither.
      const dir = [...held.keys()]
        .filter((known) => rest.startsWith(`${known}/`))
        .sort((a, b) => b.length - a.length)[0];
      if (dir === undefined) return undefined;
      const path = rest.slice(dir.length + 1);
      // `./` names the path from the directory rather than from the root, which
      // differs for a directory below the repository's root.
      const data = await git(dir, ['show', `HEAD:./${path}`]);
      // A file that is not in HEAD has no before, and empty is the truthful
      // answer for one: it did not exist.
      return { data: data ?? '', encoding: 'utf-8' };
    },

    /*
     * Ticked off, or cleared.
     *
     * The one thing a client may write here, and it writes nothing to disk:
     * it is a reader's note about a diff they are working through. Answers
     * whether it moved, so a client that ticks a file already ticked does not
     * make every other client redraw.
     */
    review: (_dir, session, scope, files, isReviewed) => {
      const key = reviewKey(session, scope);
      const ticked = reviewed.get(key) ?? new Set<string>();
      reviewed.set(key, ticked);
      let moved = false;
      for (const file of files) {
        if (isReviewed && !ticked.has(file)) { ticked.add(file); moved = true; }
        if (!isReviewed && ticked.delete(file)) moved = true;
      }
      return moved;
    },

    /**
     * What can be done to one scope, and only what can be done *now*.
     *
     * A working tree with nothing in it offers no commit, and a scope holding
     * no captured files offers no revert - an operation advertised against
     * nothing is a button that fails when pressed, and the protocol's whole
     * access model is that a client may only invoke what it was offered.
     */
    operations: (dir, session, scope, context) => {
      // Not a repository. `held` is only ever set for a directory `git status`
      // answered for, which is the same question as "is there git here".
      if (!held.has(dir)) return [];
      const dirty = held.get(dir)?.summary?.files !== undefined;
      /*
       * A pull request, where there is a GitHub to ask and nothing to ask it
       * about yet: the reference host offers the pair while the branch has no
       * request and something to put in one, and drops it once it has one.
       * On the working tree and on the session's whole, not on a turn.
       */
      const pr = context?.github !== undefined && context.pullRequest !== true && dirty
        && (scope === 'uncommitted' || scope === 'session')
        ? [CREATE_PR, PREPARE_PR]
        : [];
      if (scope === 'uncommitted') {
        return [
          ...(dirty
            ? [{ ...COMMIT, confirmation: commitConfirmation(held.get(dir)?.files ?? [], context?.subject) }, DISCARD, STAGE, UNSTAGE]
            : []),
          ...pr,
          ...(context?.unused === true ? [CHECKOUT] : []),
        ];
      }
      const files = capturedFor(session, scope);
      return [...(files && files.size > 0 ? [REVERT] : []), ...pr];
    },

    /*
     * Run one.
     *
     * Everything about *whether* this is allowed happened before the call: the
     * host checked the id against what `operations` offered for this scope and
     * the target against the operation's scopes. What is left is the doing,
     * and saying what git said when it did not work.
     */
    invoke: async ({ dir, session, scope, operationId, target, subject, meta, base, github, changeWords, conversation }) => {
      if (operationId === 'checkout') return checkout(dir, meta ?? {});
      if (operationId === 'prepare-pull-request' || operationId === 'create-pr') {
        if (github === undefined) throw new Error('This directory has no GitHub remote to open a pull request on.');
        return pullRequest(dir, operationId, subject, meta ?? {}, base, github, changeWords, conversation);
      }
      if (operationId === 'commit') {
        /*
         * The message, under this host's own key.
         *
         * The protocol has no field for it, so it travels in `_meta` - the bag
         * the reference client already puts a pull request's arguments in.
         * `message` is the person's own words, which win in every mode; with
         * none, the setting says where the words come from.
         */
        const sent = meta?.['ahpd.commit'];
        const asked = typeof sent === 'object' && sent !== null
          ? sent as Record<string, unknown>
          : undefined;
        const typed = typeof asked?.message === 'string' ? asked.message.trim() : '';
        const words = await wordsFor('commit', changeWords, { dir, text: typed, subject, conversation });
        const message = asMessage(words);
        /*
         * What is staged is the selection, and `add -A` is the fallback.
         *
         * A person stages in git, and a commit that also swept in the working
         * tree would commit something other than what they chose. `-A` is kept
         * for the empty index, because there the changeset the person is
         * looking at is the only thing that says what a commit should take,
         * untracked files included.
         */
        if (!await indexHolds(dir)) {
          const added = await run(dir, ['add', '-A']);
          if (!added.ok) throw new Error(`Could not stage: ${added.err}`);
        }
        const done = await run(dir, ['commit', '-m', message]);
        if (!done.ok) throw new Error(`Could not commit: ${done.err || done.out.trim()}`);
        const at = (await git(dir, ['rev-parse', '--short', 'HEAD']))?.trim();
        // The subject line, because the rest of the message is a body a row
        // cannot hold - the same first line `git log --oneline` would show.
        const subject_ = message.split('\n')[0] ?? message;
        const why = words.fellBack === undefined ? '' : ` - ${words.fellBack}`;
        return { message: at ? `Committed ${at}: ${subject_}${why}` : `Committed: ${subject_}${why}` };
      }

      const path = target?.resource === undefined ? undefined : await pathIn(dir, target.resource);
      // Refused rather than clamped: a target outside this directory is a
      // client asking to write somewhere this changeset is not about.
      if (path === undefined) throw new Error('That file is not in this directory.');
      const folder = path === '.';
      const named = folder ? 'the folder' : path;
      const at = folder ? dir : join(dir, path);
      // The two undos below act on one file, and a folder is a different act
      // than either of them means.
      if (folder && (operationId === 'discard' || operationId === 'revert')) {
        throw new Error('That operation takes one file, not a folder.');
      }

      if (operationId === 'discard') {
        /*
         * Tracked and untracked are different undos.
         *
         * A file git knows goes back to HEAD; a file it does not was never
         * anywhere else, so putting it back means removing it. `restore` will
         * not do the second - it fails on a pathspec it has no record of - so
         * the failure is the signal to try the other one.
         */
        const back = await run(dir, ['restore', '--staged', '--worktree', '--source=HEAD', '--', path]);
        if (!back.ok) {
          const cleaned = await run(dir, ['clean', '-f', '--', path]);
          if (!cleaned.ok) throw new Error(`Could not discard: ${back.err || cleaned.err}`);
        }
        return { message: `Discarded ${named}` };
      }

      if (operationId === 'revert') {
        const sides = capturedFor(session, scope)?.get(at);
        if (!sides) throw new Error('This changeset does not hold that file.');
        /*
         * No `before` is a file the turn created, and putting a creation back
         * means it should not be there.
         *
         * Empty counts as none, which is the same reading `rowsOf` gives when
         * it decides whether to draw a `before` side at all - one rule, so a
         * row that shows as a creation reverts as one.
         */
        if (sides.before === undefined || sides.before === '') {
          await rm(at, { force: true });
          return { message: `Removed ${named}, which this changeset created` };
        }
        await writeFile(at, sides.before, 'utf8');
        return { message: `Reverted ${named}` };
      }

      if (operationId === 'stage') {
        const added = await run(dir, ['add', '-A', '--', path]);
        if (!added.ok) throw new Error(`Could not stage: ${added.err || added.out.trim()}`);
        return { message: `Staged ${named}` };
      }

      if (operationId === 'unstage') {
        /*
         * A repository with no commit yet has no `HEAD` for `restore --staged`
         * to read, and taking an entry out of the index there is `rm --cached`.
         */
        const noCommit = await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']) === undefined;
        const done = noCommit
          ? await run(dir, ['rm', '--cached', '-r', '-q', '--', path])
          : await run(dir, ['restore', '--staged', '--', path]);
        if (!done.ok) throw new Error(`Could not unstage: ${done.err || done.out.trim()}`);
        return { message: `Unstaged ${named}` };
      }

      throw new Error(`No operation called ${operationId}`);
    },

    refresh: async (dir) => {
      const found = await look(dir);
      const before = treeSignature(held.get(dir));
      if (!found) {
        if (!held.has(dir)) return false;
        held.delete(dir);
        return true;
      }
      held.set(dir, found);
      return treeSignature(found) !== before;
    },

    /*
     * What git writes outside the host: the index, HEAD and the branch's ref.
     *
     * A person stages, commits, checks out or resets in a program this host is
     * not, and none of it comes through the host. The git directory is watched
     * rather than the files themselves because git replaces the index by
     * rename: a watch on the file would be watching an inode nothing writes
     * again. A linked worktree keeps its index and HEAD in its own git
     * directory and its refs in the common one, so each is watched where it
     * lives. Non-recursive handles, one per directory.
     */
    watch: (dir, onChange) => {
      let closed = false;
      let stop: (() => void) | undefined;
      const ready = (async () => {
        const found = await git(dir, ['rev-parse', '--absolute-git-dir']);
        if (found === undefined || found === '' || closed) return;
        const gitDir = found.trim();
        const common = (await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
          ?.trim() || gitDir;

        let timer: ReturnType<typeof setTimeout> | undefined;
        const fire = () => {
          if (timer !== undefined) clearTimeout(timer);
          // One `git add` writes the index more than once, and a commit writes
          // both files, so the events are coalesced before anything runs git.
          timer = setTimeout(() => {
            timer = undefined;
            if (!closed) onChange();
          }, 150);
        };

        const handles: FSWatcher[] = [];
        /**
         * One directory watched, through the shared debounce.
         *
         * `wanted` says which names there are worth a re-read; `onName` is told
         * every name before that, which is where a moved `HEAD` is caught.
         */
        const opened = (
          at: string,
          wanted: (name: string | null) => boolean,
          onName?: (name: string) => void,
        ): FSWatcher | undefined => {
          if (closed) return undefined;
          let watcher: FSWatcher;
          try {
            watcher = watch(at, (_event, name) => {
              if (name !== null) onName?.(name);
              if (wanted(name)) fire();
            });
          }
          catch {
            // A directory this process may not watch: the other triggers still
            // work, and a watcher is an extra rather than the answer.
            return undefined;
          }
          handles.push(watcher);
          /*
           * A failed watcher takes its own handle and anything it queued with
           * it. The other directories stay watched, and an `error` with no
           * listener on an `FSWatcher` ends the process instead.
           */
          watcher.on('error', () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            watcher.close();
            const held = handles.indexOf(watcher);
            if (held >= 0) handles.splice(held, 1);
            if (watcher === refWatcher) {
              refWatcher = undefined;
              refDir = undefined;
            }
          });
          return watcher;
        };

        /** The checked-out branch, as `refs/heads/...`, or nothing when detached. */
        const branchOf = async (): Promise<string | undefined> => {
          const said = await git(dir, ['symbolic-ref', '-q', 'HEAD']);
          const branch = said?.trim();
          return branch === undefined || branch === '' ? undefined : branch;
        };

        /*
         * The branch's own ref, watched where the ref lives.
         *
         * A ref moves without the index or `HEAD` being written - a soft reset,
         * or a commit from another program - and the loose ref file is then the
         * only thing that says the uncommitted changeset moved.
         */
        let refDir: string | undefined;
        let refWatcher: FSWatcher | undefined;
        const watchRef = async (): Promise<void> => {
          const branch = await branchOf();
          const at = branch === undefined ? undefined : dirname(join(common, branch));
          if (at === refDir) return;
          refDir = at;
          if (refWatcher !== undefined) {
            refWatcher.close();
            const held = handles.indexOf(refWatcher);
            if (held >= 0) handles.splice(held, 1);
          }
          refWatcher = undefined;
          if (branch === undefined || at === undefined) return;
          const name = basename(branch);
          refWatcher = opened(at, (event) => event === null || event === name);
        };

        // The index and HEAD; `packed-refs` joins them only where it lives in
        // this same directory, since a worktree keeps it in the common one.
        opened(gitDir, (name) => name === null || name === 'index' || name === 'HEAD'
          || (common === gitDir && name === 'packed-refs'),
        (name) => { if (name === 'HEAD') void watchRef(); });
        if (common !== gitDir) {
          opened(common, (name) => name === null || name === 'packed-refs');
        }
        await watchRef();

        const shut = (): void => {
          closed = true;
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          for (const held of handles) held.close();
        };
        stop = shut;
        if (closed) stop();
      })().catch(() => {});
      return Object.assign(() => {
        closed = true;
        stop?.();
      }, { ready });
    },
  };
}

/** What git says a directory has changed, as a host's `ChangesetSource`. */

import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import type {
  ChangesSummary, ChangesetFile, ChangesetOperation, ChangesetOperationResult, ChangesetSource, ChangesetState,
} from './types/changes.js';
import type { PullRequests } from './types/github.js';

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
  const was = before === '' ? [] : before.split('\n');
  const now = after === '' ? [] : after.split('\n');
  const shared = new Set(was);
  const added = now.filter((row) => !shared.has(row)).length;
  const kept_ = new Set(now);
  const removed = was.filter((row) => !kept_.has(row)).length;
  return { added, removed };
};

/** One `git` run, as text, or nothing when it would not run. */
const git = (dir: string, args: string[]): Promise<string | undefined> =>
  new Promise((answer) => {
    execFile('git', ['-C', dir, ...args], { timeout: 5000, maxBuffer: 32 * 1024 * 1024 },
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
    execFile('git', ['-C', dir, ...args], { timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
      (error, out, errOut) => answer({
        ok: !error,
        out: out.toString(),
        err: errOut.toString().trim() || (error ? error.message : ''),
      }));
  });

/** The path a `file://` URI names, or nothing for a URI that names none. */
const pathIn = (dir: string, uri: string): string | undefined => {
  if (!uri.startsWith('file://')) return undefined;
  const path = uri.slice('file://'.length);
  // Inside the directory this changeset is about, and not merely starting with
  // its name: `/src/brb` must not reach `/src/brb_framework`.
  return path === dir || path.startsWith(`${dir}/`) ? path : undefined;
};

/**
 * The scheme for the side of an edit that is not on disk.
 *
 * `before` is what a file *used to be*, so no `file://` URI addresses it and
 * the filesystem port cannot serve it. This host mints its own URI and
 * resolves it itself, which is what `ChangesetSource.read` is for.
 */
const BEFORE = 'ahp-git:';
const beforeUri = (dir: string, path: string): string => `${BEFORE}//${dir}/${path}`;

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
  description: 'Commit the working tree, including files git has not been told about',
  scopes: ['changeset'],
  icon: 'git-commit',
  group: 'commit',
  writes: true,
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

  /** The text held for a captured side, by the URI minted for it. */
  const kept = new Map<string, string>();

  /**
   * Which files somebody has ticked off, per changeset.
   *
   * A reader's bookkeeping rather than anything about the files: keyed by the
   * scope being read, because reviewing a turn is not reviewing the session
   * that contains it.
   */
  const reviewed = new Map<string, Set<string>>();
  const reviewKey = (session: string, scope: string): string => `${session}\u0000${scope}`;

  const capturedUri = (session: string, turn: string, path: string, phase: string): string =>
    `${CAPTURED}//${encodeURIComponent(session)}/${encodeURIComponent(turn)}/${phase}${path}`;

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
      const uri = `file://${path}`;
      const before = capturedUri(session, turn, path, 'before');
      const after = capturedUri(session, turn, path, 'after');
      if (sides.before !== undefined) kept.set(before, sides.before);
      if (sides.after !== undefined) kept.set(after, sides.after);
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
    for (const record of records) {
      // `XY <path>`: two status letters, a space, then the path.
      const code = record.slice(0, 2);
      const path = record.slice(3);
      if (path === '') continue;
      const gone = code.includes('D');
      const fresh = code.includes('A') || code.includes('?');
      const uri = `file://${dir}/${path}`;
      // An untracked file is in no diff against HEAD, so git reports nothing
      // for it. Every line of it is an addition, which is what it is.
      const count = counts.get(path) ?? (fresh
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
    workingDirectory: `file://${dir}`,
    repository: `${repo.owner}/${repo.repo}`,
    branchName: at.branch,
    baseBranchName: at.base,
    ...(at.upstream !== undefined ? { upstreamBranchName: at.upstream } : {}),
  });

  /**
   * A title and a body, without a model to write them.
   *
   * The session's own title is the sentence somebody already wrote about this
   * work, and the commits on the branch are what was done; between them a
   * reviewer knows what the request is. A branch with nothing committed yet
   * has only the first.
   */
  const words = async (dir: string, subject: string | undefined, at: { branch: string; base: string }): Promise<{ title: string; description: string }> => {
    const line = (subject ?? '').split('\n')[0]?.trim();
    const log = (await git(dir, ['log', '--format=%s', `${at.base}..${at.branch}`]))?.trim() ?? '';
    const commits = log === '' ? [] : log.split('\n');
    const title = line !== undefined && line !== '' && line !== 'New session' ? line : (commits[0] ?? at.branch);
    const description = commits.length > 0 ? commits.map((one) => `- ${one}`).join('\n') : `Changes from an agent session on \`${at.branch}\`.`;
    return { title, description };
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
        ...await words(dir, subject, at),
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
      const line = (subject ?? '').split('\n')[0]?.trim();
      const done = await run(dir, ['commit', '-m', line !== undefined && line !== '' ? line : `Changes on ${branch}`]);
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
    const said = await words(dir, subject, { branch, base: at.base });
    const existing = (await github.ask.forBranch(repo, head, github.token, dir)).find((one) => one.state === 'open');
    if (existing !== undefined) {
      return {
        message: `Pushed ${branch}; its pull request is ${existing.url}`,
        followUp: { content: { uri: existing.url, contentType: 'text/html' }, external: true },
        pullRequest: {
          url: existing.url,
          // The port's title when it has one, the form's next, the subject's last.
          title: existing.title ?? (typeof asked?.title === 'string' ? asked.title : undefined) ?? said.title,
          branch: head,
        },
      };
    }
    const opened = await github.ask.create(repo, {
      title: typeof asked?.title === 'string' ? asked.title : said.title,
      body: typeof asked?.description === 'string' ? asked.description : said.description,
      head,
      base: at.base,
      draft: asked?.draft === true,
    }, github.token, dir);
    return {
      message: `Opened ${opened.url}`,
      followUp: { content: { uri: opened.url, contentType: 'text/html' }, external: true },
      pullRequest: {
        url: opened.url,
        title: opened.title ?? (typeof asked?.title === 'string' ? asked.title : undefined) ?? said.title,
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
      // The session's own first. A client showing one changeset shows the
      // first that needs no variable filling in, and what a *conversation*
      // changed is the one that belongs beside a conversation - the working
      // tree includes whatever else happened to the directory meanwhile.
      return [
        {
          id: 'session',
          label: 'This Session',
          description: 'Everything this conversation changed',
          changeKind: 'session',
          reviewable: true,
        },
        ...scopes,
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
     * creation is.
     */
    observe: (dir, session, turnId, path, phase) => {
      void (async () => {
        const text = await readFile(path, 'utf8').catch(() => undefined);
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

        kept.set(capturedUri(session, turnId, path, phase), text ?? '');

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
            reviewed.get(reviewKey(session, scope))?.delete(`file://${path}`);
          }
        }
      })().catch(() => {});
    },

    summary: (dir) => held.get(dir)?.summary,

    /*
     * The `before` side, out of git rather than off the disk.
     *
     * `git show HEAD:<path>` is what the file was at the last commit, which is
     * the only place that version still exists.
     */
    read: async (uri) => {
      // Captured sides are held, not fetched: neither is on disk any more.
      if (uri.startsWith(CAPTURED)) {
        const text = kept.get(uri);
        return text === undefined ? undefined : { data: text, encoding: 'utf-8' };
      }
      if (!uri.startsWith(BEFORE)) return undefined;
      const rest = uri.slice(`${BEFORE}//`.length);
      // The directory is the longest known one this URI starts with: a path
      // has slashes and so does a directory, and splitting on the first one
      // would name neither.
      const dir = [...held.keys()]
        .filter((known) => rest.startsWith(`${known}/`))
        .sort((a, b) => b.length - a.length)[0];
      if (dir === undefined) return undefined;
      const path = rest.slice(dir.length + 1);
      const data = await git(dir, ['show', `HEAD:${path}`]);
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
          ...(dirty ? [COMMIT, DISCARD] : []),
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
    invoke: async ({ dir, session, scope, operationId, target, subject, meta, base, github }) => {
      if (operationId === 'checkout') return checkout(dir, meta ?? {});
      if (operationId === 'prepare-pull-request' || operationId === 'create-pr') {
        if (github === undefined) throw new Error('This directory has no GitHub remote to open a pull request on.');
        return pullRequest(dir, operationId, subject, meta ?? {}, base, github);
      }
      if (operationId === 'commit') {
        // `-A`, including files git has not been told about: the changeset this
        // was invoked on counted untracked files as changes, and committing
        // less than was listed would commit something other than what was
        // shown.
        const staged = await run(dir, ['add', '-A']);
        if (!staged.ok) throw new Error(`Could not stage: ${staged.err}`);
        // The session's own title, which is the sentence somebody already wrote
        // about this work. A generated one would need the agent, and running a
        // turn to commit a turn is a lot of machinery for a subject line.
        const line = (subject ?? '').split('\n')[0]?.trim();
        const message = line !== undefined && line !== '' ? line : 'Changes from an agent session';
        const done = await run(dir, ['commit', '-m', message]);
        if (!done.ok) throw new Error(`Could not commit: ${done.err || done.out.trim()}`);
        const at = (await git(dir, ['rev-parse', '--short', 'HEAD']))?.trim();
        return { message: at ? `Committed ${at}: ${message}` : `Committed: ${message}` };
      }

      const path = target?.resource === undefined ? undefined : pathIn(dir, target.resource);
      // Refused rather than clamped: a target outside this directory is a
      // client asking to write somewhere this changeset is not about.
      if (path === undefined) throw new Error('That file is not in this directory.');
      const named = path.slice(dir.length + 1);

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
        const sides = capturedFor(session, scope)?.get(path);
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
          await rm(path, { force: true });
          return { message: `Removed ${named}, which this changeset created` };
        }
        await writeFile(path, sides.before, 'utf8');
        return { message: `Reverted ${named}` };
      }

      throw new Error(`No operation called ${operationId}`);
    },

    refresh: async (dir) => {
      const found = await look(dir);
      const before = JSON.stringify(held.get(dir)?.summary ?? null);
      if (!found) {
        if (!held.has(dir)) return false;
        held.delete(dir);
        return true;
      }
      held.set(dir, found);
      return JSON.stringify(found.summary) !== before;
    },
  };
}

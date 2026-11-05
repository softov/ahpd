/**
 * A machine's own git, read and written from this host through the commands
 * that reach it.
 *
 * A machine that commits in a git directory of its own is reached in one of
 * two ways: `docker exec` for a container, `ssh` for a virtual machine. What
 * is done with its git is the same either way - its commits come back as a
 * bundle on a pipe, what it never committed is kept before it goes, and the
 * host's branch is handed over before a turn - so it is written once here,
 * against the two things a runtime gives: one git command in the machine, and
 * the same with its output poured into a file.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitArgv, hostPathOf } from '@ahpd/sdk';
import type { BroughtBack } from '@ahpd/sdk';
import { bundleOfTree, cloneUrl, originOf, SEED_BUNDLE, SEED_REF } from './clone.js';
import { seedOf } from './gitdir.js';
import type { GitSeed } from './gitdir.js';

/** What one command in a machine printed, and what it exited with. */
export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** One machine with a git directory of its own, and the two roads into it. */
export interface MachineGit {
  /** The machine's id, which a ref of ahpd's and a log line name it by. */
  id: string;
  /**
   * The tree, as the machine names it: the same path the host's tree has,
   * which `hostPathOf` turns back into the host's own spelling.
   */
  tree: string;
  /** Whether the machine works in a copy of the tree rather than the host's own. */
  copy: boolean;
  /** Whether the machine is on another box and holds none of the host's objects. */
  remote: boolean;
  /** One git command in the machine, run as `git -C <tree>` and the arguments. */
  git(args: string[]): Promise<Ran>;
  /** The same, with what it writes to stdout landing in `path` byte for byte. */
  pour(args: string[], path: string): Promise<{ code: number; stderr: string }>;
  log?: (line: string) => void;
}

/**
 * A git command a machine was asked, with a failure of git's own thrown.
 *
 * `rev-parse --verify --quiet` and `symbolic-ref -q` ask a question whose
 * answer may be no: they exit non-zero with nothing on stderr, which is the
 * question working. Anything git writes on stderr is git not running at all -
 * a git directory that is not there, a repository it will not read - and a
 * machine whose git cannot be asked is one holding work this host cannot see,
 * which is not the same answer as a machine that did no work.
 */
export const told = (held: Ran, said: string): Ran => {
  if (held.code !== 0 && held.stderr.trim() !== '') {
    throw new Error(`${said} exited ${String(held.code)}: ${held.stderr.trim()}`);
  }
  return held;
};

/**
 * Where a machine's uncommitted work is named while it is carried out of the
 * machine: a ref in the machine's own git directory, which goes with it, and
 * never the ref of the host's the work lands under.
 */
const STASHED = 'refs/ahpd/uncommitted';

/** A machine on another box, as the seed of its git directory reaches it. */
export interface FarSeed {
  /** The machine's name, for a refusal. */
  name: string;
  /** One command in the machine as its user, answering stdout or throwing. */
  must(command: string[]): Promise<string>;
  /** One command in the machine as its user, answering what it said whatever its exit. */
  ran(command: string[]): Promise<Ran>;
  /** A file of this host's, written into the machine at `path`. */
  put(file: string, path: string): Promise<void>;
  /** A file in the machine, removed; nothing when it is not there. */
  drop(path: string): Promise<void>;
}

/**
 * The tree's `HEAD`, put in a machine on another box as a bundle and fetched
 * into its seed ref, with the tree's `origin` named in its config.
 *
 * `root` is the tree as the machine names it and `at` its git directory there.
 * Answers the commit the seed ref holds, or nothing for a tree with no
 * commit, which has no history to send. The bundle is removed from both
 * hosts whether the fetch worked or not.
 */
export const bundledInto = async (far: FarSeed, root: string, at: string): Promise<string | undefined> => {
  const host = hostPathOf(root);
  const origin = originOf(host);
  if (origin !== undefined) await far.must(['git', `--git-dir=${at}`, 'config', 'remote.origin.url', origin]);
  if (seedOf(host).commit === undefined) return undefined;
  const bundle = bundleOfTree(host);
  try {
    await far.put(bundle.file, SEED_BUNDLE);
    await far.must(['git', `--git-dir=${at}`, 'fetch', '-q', '--no-tags', SEED_BUNDLE, `+HEAD:${SEED_REF}`]);
    return (await far.must(['git', `--git-dir=${at}`, 'rev-parse', SEED_REF])).trim() || undefined;
  }
  finally {
    bundle.drop();
    await far.drop(SEED_BUNDLE);
  }
};

/**
 * A seeded git directory set at the tree's commit, as the host's git reads it.
 *
 * `own` is the `--git-dir` and `--work-tree` pair, and `must` runs one command
 * in the machine as its user. `hard` is a copy of the tree, whose working tree
 * is the machine's own and holds nothing yet: the checkout is the seed.
 */
export const checkedOut = async (
  must: (command: string[]) => Promise<string>,
  own: string[],
  seed: GitSeed,
  commit: string | undefined,
  hard: boolean,
): Promise<void> => {
  // The identity a commit needs, and nothing else of the host's config.
  if (seed.name !== undefined) await must(['git', ...own, 'config', 'user.name', seed.name]);
  if (seed.email !== undefined) await must(['git', ...own, 'config', 'user.email', seed.email]);
  // How the host's git reads the tree's files, so the same files are clean
  // in here too: a Windows folder is `0777` in the machine and CRLF on disk.
  // Before the index is made, which reads the files the way these say.
  if (seed.filemode !== undefined) await must(['git', ...own, 'config', 'core.filemode', seed.filemode]);
  if (seed.autocrlf !== undefined) await must(['git', ...own, 'config', 'core.autocrlf', seed.autocrlf]);
  // The branch the tree is on, at the commit it is at; a tree on no branch
  // gives a machine on none, whose work is fetched to the hidden ref only.
  if (seed.branch !== undefined) await must(['git', ...own, 'symbolic-ref', 'HEAD', `refs/heads/${seed.branch}`]);
  if (commit === undefined) return;
  await must(seed.branch === undefined
    ? ['git', ...own, 'update-ref', '--no-deref', 'HEAD', commit]
    : ['git', ...own, 'update-ref', `refs/heads/${seed.branch}`, commit]);
  /*
   * The index that commit names, so git in the machine is clean before the
   * agent has touched anything - and under a copy the tree as well. Nothing of
   * the host's is written either way, because a shared tree is the host's own
   * and only the index moves.
   */
  await must(['git', ...own, 'reset', ...(hard ? ['--hard'] : []), '-q']);
};

/**
 * Fetch the session's branch from the tree's `origin` into the seed ref, in
 * the machine, and answer the commit it is at.
 *
 * The `clone` route: the box reaches the remote itself, so nothing of this
 * host's history is sent. The machine holds no credential, so only a public
 * repository can be fetched, at the address `cloneUrl` gives its `origin`,
 * which is set as the machine's own `origin`. A branch `origin` does not have
 * is refused, since the machine could only be seeded from a commit the
 * session is not on.
 */
export const fetchedInto = async (far: FarSeed, root: string, at: string, branch: string | undefined): Promise<string | undefined> => {
  const named = originOf(hostPathOf(root));
  if (named === undefined) {
    throw new Error(`${far.name} fetches its code from origin, and ${root} has no origin remote; code: "bundle" sends it from this host`);
  }
  // A GitHub SSH origin is fetched by GitHub's HTTPS origin, as VS Code's
  // agent host clones one, and any other origin as written.
  const origin = cloneUrl(named);
  if (branch === undefined) {
    throw new Error(`${far.name} fetches the session's branch from origin, and ${root} is on no branch; code: "bundle" sends the commit from this host`);
  }
  const git = (args: string[]): string[] => ['git', `--git-dir=${at}`, ...args];
  await far.must(git(['config', 'remote.origin.url', origin]));
  // `--exit-code` is 2 when origin answered and has no such branch.
  const listed = await far.ran(git(['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`]));
  if (listed.code === 2) {
    throw new Error(`${far.name} fetches branch ${branch} from origin, and origin has no ${branch}; push it, or use code: "bundle", which brings it without a push`);
  }
  if (listed.code !== 0) {
    throw new Error(`git ls-remote origin in ${far.name} exited ${String(listed.code)}: ${listed.stderr.trim() || listed.stdout.trim() || 'no output'}`);
  }
  await far.must(git(['fetch', '-q', '--no-tags', 'origin', `+refs/heads/${branch}:${SEED_REF}`]));
  return (await far.must(git(['rev-parse', SEED_REF]))).trim() || undefined;
};

/**
 * One git command on this host, in a tree, with the argv every git here runs.
 *
 * Everything the host's git does about a machine's work is done in the tree -
 * where the machine's folder is and where a person's own checkout is - and
 * never inside the machine's volume, not even to read: everything that comes
 * from a machine arrives on a pipe, and a path in there is a repository the
 * machine wrote. A command that fails answers its own exit code rather than
 * throwing, because a fast-forward that does not apply is a question with an
 * answer.
 */
// `tree` is the machine's name for it, read from its mounts; git runs on the
// host, in the host path it names - the same text except on Windows.
export const hostGit = (tree: string, args: string[]): { code: number; stdout: string; stderr: string } => {
  const held = spawnSync('git', gitArgv(hostPathOf(tree), args), { encoding: 'utf8', windowsHide: true });
  return { code: held.status ?? 1, stdout: held.stdout ?? '', stderr: held.stderr ?? '' };
};

/*
 * What a machine committed, brought back by fetch - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 *
 * The machine's commits leave it as a bundle written to stdout, poured
 * straight into a file ahpd made private, and the host's git is handed that
 * file and nothing else: a fetch from a path inside the machine's volume
 * would have the host's git run `upload-pack` against a repository the
 * machine wrote.
 *
 * Every branch of the machine's comes back, not only the one it is on: an
 * agent that made a branch of its own and went back to the one it was seeded
 * with leaves that commit on no branch a single-branch fetch would look at,
 * in a volume the removal takes with the machine - and a branch made in a
 * machine is work as much as a commit is.
 *
 * A branch of the host's moves only where the machine's commit leads on from
 * where that branch is, and - for the branch the host's tree has checked out
 * - with nothing staged; a branch the host does not have is made at the
 * machine's commit. Anywhere else the work waits in a ref of ahpd's own -
 * `refs/ahpd/machines/<machine>/<branch>` - which is also what the next
 * fetch measures from, so a bundle carries only what is new since the last
 * one, and so work that waited is not fetched twice.
 *
 * A function of its own rather than only a verb, because `remove` runs it
 * too: the volume holding the machine's git directory goes with the machine,
 * and that is the last moment its commits exist anywhere.
 */

/** Where a ref of the host's is, and nothing at all where it has none. */
const hostRef = (tree: string, ref: string): string =>
  hostGit(tree, ['rev-parse', '--verify', '--quiet', ref]).stdout.trim();

/**
 * Where a bundle of a machine's work is measured from: `from`, or on another
 * box's Docker, where the machine has no commit the host made after its seed,
 * the seed ref when the machine lacks `from`. Nothing where it has neither,
 * and the bundle then carries the whole history.
 */
const measuredFrom = async (machine: MachineGit, from: string): Promise<string> => {
  if (!machine.remote || from === '') return from;
  const asked = (...args: string[]): Promise<Ran> => machine.git(args);
  if ((await asked('cat-file', '-e', `${from}^{commit}`)).code === 0) return from;
  const seed = await asked('rev-parse', '--verify', '--quiet', SEED_REF);
  return seed.code === 0 ? seed.stdout.trim() : '';
};

/**
 * One branch of a machine's, brought back.
 *
 * `branch` is its name, or `''` for a machine on no branch, whose work is
 * bundled from its `HEAD` and moves no branch of the host's. `onHost` is the
 * branch the host's own tree has checked out, which is the only branch of the
 * host's whose move has an index to disturb.
 */
const bringBackBranch = async (machine: MachineGit, branch: string, onHost: string): Promise<BroughtBack> => {
  const { id, tree } = machine;
  const ref = branch === '' ? 'HEAD' : `refs/heads/${branch}`;
  const hidden = `refs/ahpd/machines/${id}/${branch === '' ? 'HEAD' : branch}`;
  /** One git command in the machine, in the folder it was given. */
  const inMachine = async (...args: string[]): Promise<Ran> => told(await machine.git(args), `git ${args.join(' ')} in ${id}`);
  /*
   * Where this branch's work starts from: the commit the host last fetched of
   * it, which is the hidden ref while any of it waits, or - before the first
   * fetch - the branch the machine was seeded from, which is the host's own
   * branch of that name. A branch the host has never had is one the machine
   * made, and its work starts from where the seed put the machine: the host's
   * `HEAD`.
   */
  const from = hostRef(tree, hidden)
    || (branch === '' ? '' : hostRef(tree, ref))
    || hostRef(tree, 'HEAD');
  // A tree with no commit at all has nothing a machine's work could lead on
  // from, and nothing to bring it back to.
  if (from === '') return { moved: false };
  const tip = (await inMachine('rev-parse', '--verify', '--quiet', ref)).stdout.trim();
  // A branch that is where the host last left it has nothing new on it, which
  // is the whole of what the last fetch settled. A branch the machine does
  // not have is in this list only where it was just asked for.
  if (tip === '' || tip === from) return { moved: false };
  // The bundle lands here: a directory only this process may read, holding a
  // file only this process may read, gone whether the fetch worked or not.
  const scratch = mkdtempSync(join(tmpdir(), 'ahpd-bringback-'));
  const bundle = join(scratch, 'work.bundle');
  try {
    const since = await measuredFrom(machine, from);
    const made = await machine.pour(['bundle', 'create', '-', ref, ...(since === '' ? [] : ['--not', since])], bundle);
    if (made.code !== 0) {
      /*
       * A machine that has committed nothing has nothing beyond the commit
       * the host already has, and git refuses to write a bundle of nothing.
       * That is not a machine that failed, it is a machine that did no work.
       */
      if (made.stderr.includes('Refusing to create empty bundle')) return { moved: false };
      throw new Error(`git bundle in ${id} exited ${String(made.code)}: ${made.stderr.trim() || 'no output'}`);
    }
    /*
     * The fetch, with every object in the pack checked: what a machine wrote
     * is not to be trusted into the host's repository unread, and git's own
     * fsck is what says whether what came back is history anybody can read.
     */
    const taken = hostGit(tree, [
      '-c', 'transfer.fsckObjects=true',
      'fetch', '--no-tags', '--no-write-fetch-head', bundle, `+${ref}:${hidden}`,
    ]);
    if (taken.code !== 0) {
      throw new Error(`git fetch in ${tree} exited ${String(taken.code)}: ${taken.stderr.trim() || taken.stdout.trim() || 'no output'}`);
    }
    const arrived = hostRef(tree, hidden);
    // A machine on no branch has no branch of the host's to move: its work
    // waits where it landed, and the next turn or a person picks it up.
    if (branch === '') {
      machine.log?.(`the work of ${id} waits in ${hidden}: the machine is on no branch`);
      return { moved: false, waiting: hidden };
    }
    const old = hostRef(tree, ref);
    /*
     * Under `copy` the host's tree is a checkout of its own, so the branch it
     * is on moves by being merged rather than by an index being reset: a
     * fast-forward writes the machine's files where a person's own checkout
     * is, which is the whole of what the fetch has to hand over there. The
     * merge refuses wherever the machine's commit is not one the branch leads
     * on from, or where the tree holds changes it would write over, and the
     * work waits under the hidden ref exactly as it does below - decision
     * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
     *
     * A branch of the host's the tree is not on is not a checkout of anything
     * there: it moves as a ref, as it does under `shared`.
     */
    if (machine.copy && branch === onHost) {
      if (old === arrived) {
        // The branch already holds the machine's commit: nothing is moved,
        // and the ref that was to say otherwise has nothing to keep.
        hostGit(tree, ['update-ref', '-d', hidden]);
        return { moved: false };
      }
      const merged = hostGit(tree, ['merge', '--ff-only', arrived]);
      if (merged.code !== 0) {
        machine.log?.(`the work of ${id} waits in ${hidden}: ${branch} does not lead on from it, or the tree holds changes the merge would write over`);
        return { moved: false, waiting: hidden };
      }
      // The work is on the branch now, so the ref that held it keeps nothing.
      hostGit(tree, ['update-ref', '-d', hidden]);
      return { moved: true };
    }
    /*
     * A branch the host does not have is made at the machine's commit: there
     * is no history of the host's for it to lead on from, and a branch an
     * agent made in a machine is the whole of what it is. A branch the host
     * does have moves only where the machine's commit leads on from where it
     * is: a fast-forward that threw away a person's commit is ahpd taking
     * what is not its own.
     */
    if (old !== '' && hostGit(tree, ['merge-base', '--is-ancestor', old, arrived]).code !== 0) {
      machine.log?.(`the work of ${id} waits in ${hidden}: ${branch} moved on the host`);
      return { moved: false, waiting: hidden };
    }
    /*
     * Staged changes stop the move only for the branch the host's tree has
     * checked out: moving any other ref of the host's touches no index, and
     * the index is reset below for that branch alone.
     */
    if (branch === onHost && hostGit(tree, ['diff', '--cached', '--quiet']).code !== 0) {
      machine.log?.(`the work of ${id} waits in ${hidden}: the index holds staged changes`);
      return { moved: false, waiting: hidden };
    }
    if (old === arrived) {
      // The branch already holds the machine's commit: nothing is moved, and
      // the ref that was to say otherwise has nothing to keep.
      hostGit(tree, ['update-ref', '-d', hidden]);
      return { moved: false };
    }
    const moved = old === ''
      ? hostGit(tree, ['update-ref', ref, arrived])
      : hostGit(tree, ['update-ref', ref, arrived, old]);
    if (moved.code !== 0) {
      throw new Error(`git update-ref of ${ref} in ${tree} exited ${String(moved.code)}: ${moved.stderr.trim() || 'no output'}`);
    }
    if (branch === onHost) {
      /*
       * The index the branch now names, so the files the agent wrote read as
       * committed rather than as a change nobody made. The working tree is not
       * touched: it is the machine's folder and a person's, and what is in it
       * is what the machine left there.
       */
      const index = hostGit(tree, ['reset', '-q']);
      if (index.code !== 0) {
        throw new Error(`git reset in ${tree} exited ${String(index.code)}: ${index.stderr.trim() || 'no output'}`);
      }
    }
    // The work is on the branch now, so the ref that held it keeps nothing.
    hostGit(tree, ['update-ref', '-d', hidden]);
    return { moved: true };
  }
  finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

export const bringBack = async (machine: MachineGit): Promise<BroughtBack> => {
  const { id, tree } = machine;
  /** One git command in the machine, in the folder it was given. */
  const asked = async (...args: string[]): Promise<Ran> => told(await machine.git(args), `git ${args.join(' ')} in ${id}`);
  /*
   * Every branch the machine holds, asked of the machine itself rather than
   * read off its `HEAD`: the one it is on is among them, and one it is not on
   * may hold the only copy of an agent's work. A machine on no branch - a
   * tree checked out detached - brings its `HEAD` back as well, and its work
   * reaches no branch of the host's whatever else is true.
   */
  const listed = await asked('for-each-ref', '--format=%(refname:short)', 'refs/heads/');
  const held = listed.code === 0
    ? listed.stdout.split('\n').map((one) => one.trim()).filter((one) => one !== '')
    : [];
  const where = await asked('symbolic-ref', '-q', '--short', 'HEAD');
  const branch = where.code === 0 ? where.stdout.trim() : '';
  // The branch the machine is on is in the list already; a list that came
  // back empty still has it, so a machine whose branches could not be asked
  // for is brought back the way it was before.
  const targets = [...new Set([...held, branch])];
  // The branch the host's own tree has checked out, which is the one branch
  // of the host's whose move has an index to disturb.
  const onHost = hostGit(tree, ['symbolic-ref', '-q', '--short', 'HEAD']).stdout.trim();
  let moved = false;
  const waiting: string[] = [];
  for (const target of targets) {
    const one = await bringBackBranch(machine, target, onHost);
    if (one.moved) moved = true;
    if (one.waiting !== undefined) waiting.push(one.waiting);
  }
  return waiting.length === 0 ? { moved } : { moved, waiting: waiting.join(', ') };
};

/*
 * What a machine never committed, kept in the host's repository before the
 * machine goes - `remove` under `copy`.
 *
 * The machine's working tree is inside the volume that is removed with it, so
 * a file an agent changed and never committed is in the one place that is
 * about to stop existing. `git stash create` writes the commit such work
 * would be stashed as and stores it nowhere, and the host fetches it to
 * `refs/ahpd/machines/<machine>/uncommitted` - a ref of ahpd's own, which a
 * person can read the work out of and which no branch of theirs moves for -
 * decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 *
 * The bundle carries only what the host has not already fetched, measured
 * from where the last fetch left it, exactly as `bringBack` measures its own.
 */
export const keepUncommitted = async (machine: MachineGit): Promise<void> => {
  const { id, tree } = machine;
  const inMachine = async (...args: string[]): Promise<Ran> => told(await machine.git(args), `git ${args.join(' ')} in ${id}`);
  // Nothing to keep in a tree holding nothing nobody committed, and nothing
  // to do in one git will not take a stash of either.
  if ((await inMachine('status', '--porcelain')).stdout.trim() === '') return;
  const made = await inMachine('stash', 'create');
  const commit = made.stdout.trim();
  if (made.code !== 0 || commit === '') {
    machine.log?.(`what ${id} never committed is not kept: git stash in it exited ${String(made.code)}${commit === '' && made.code === 0 ? ', holding nothing it takes' : ''}`);
    return;
  }
  const branch = (await inMachine('symbolic-ref', '-q', '--short', 'HEAD')).stdout.trim();
  const hidden = `refs/ahpd/machines/${id}/${branch === '' ? 'HEAD' : branch}`;
  const from = await measuredFrom(machine, hostGit(tree, ['rev-parse', '--verify', '--quiet', hidden]).stdout.trim()
    || hostGit(tree, ['rev-parse', '--verify', '--quiet', 'HEAD']).stdout.trim());
  const kept = `refs/ahpd/machines/${id}/uncommitted`;
  // The stash commit has to be named by a ref for a bundle to carry it, and
  // the ref is in the machine's own git directory, which goes with it.
  await inMachine('update-ref', STASHED, commit);
  const scratch = mkdtempSync(join(tmpdir(), 'ahpd-bringback-'));
  const bundle = join(scratch, 'uncommitted.bundle');
  try {
    const pouredOut = await machine.pour(['bundle', 'create', '-', STASHED, ...(from === '' ? [] : ['--not', from])], bundle);
    if (pouredOut.code !== 0) {
      throw new Error(`git bundle of what ${id} never committed exited ${String(pouredOut.code)}: ${pouredOut.stderr.trim() || 'no output'}`);
    }
    const taken = hostGit(tree, [
      '-c', 'transfer.fsckObjects=true',
      'fetch', '--no-tags', '--no-write-fetch-head', bundle, `+${STASHED}:${kept}`,
    ]);
    if (taken.code !== 0) {
      throw new Error(`git fetch of what ${id} never committed exited ${String(taken.code)}: ${taken.stderr.trim() || taken.stdout.trim() || 'no output'}`);
    }
    machine.log?.(`what ${id} never committed is kept in ${kept}`);
  }
  finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

/**
 * Whether the commit a machine's branch is about to be pointed at leads on
 * from where that branch is now, so that re-pointing it drops nothing.
 *
 * `true` where the machine has no branch of that name, and where it is
 * already at the commit named: there is nothing there to lose either way.
 * Asked in the machine, because the branch asked about is the machine's own.
 */
export const movesOver = async (
  inMachine: (...args: string[]) => Promise<Ran>,
  branch: string,
  tip: string,
): Promise<boolean> => {
  const held = await inMachine('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  const at = held.code === 0 ? held.stdout.trim() : '';
  if (at === '' || at === tip) return true;
  return (await inMachine('merge-base', '--is-ancestor', at, tip)).code === 0;
};

/*
 * The host's branch, handed to a machine that works in a copy of the tree.
 *
 * The machine's own checkout is in its own volume, so the host's commit is
 * not something it can be pointed at: it has to be written into the machine's
 * working tree, and that is a merge. It is `--ff-only`, so a machine holding
 * work the host's branch does not lead on from keeps it, and it is done only
 * where the machine's tree is clean - an agent's work in progress is not
 * ahpd's to merge over. Either way the machine is left exactly as it is and
 * the log says why.
 *
 * The commit itself is not copied anywhere: it is an object of the host's,
 * which the machine's git reads through the alternates the seed gave it - so
 * the only writes are the machine's own ref, index and working tree.
 */
export const followOfCopy = async (machine: MachineGit): Promise<void> => {
  const { id, tree } = machine;
  /*
   * Where the host is, read in the tree: the branch a person's own checkout
   * put it on - none at all where it is detached - and the commit it is at.
   * A tree with no commit has nothing to hand over and nothing to be at.
   */
  const branch = hostGit(tree, ['symbolic-ref', '-q', '--short', 'HEAD']).stdout.trim();
  const tip = hostGit(tree, ['rev-parse', '--verify', '--quiet', 'HEAD']).stdout.trim();
  if (tip === '') return;
  /** One git command in the machine, in the tree it works in. */
  const inMachine = (...args: string[]): Promise<Ran> => machine.git(args);
  // Where the machine is: the same two answers, asked of it.
  const held = await inMachine('symbolic-ref', '-q', '--short', 'HEAD');
  const onBranch = held.code === 0 ? held.stdout.trim() : '';
  const mine = (await inMachine('rev-parse', '--verify', '--quiet', 'HEAD')).stdout.trim();
  // A machine with no commit of its own - a seed that did not happen - has
  // nothing a hand-over could be moving.
  if (mine === '') return;
  // Already there, both halves of it: nothing is written, so nothing of the
  // machine's - a file an agent left in its tree above all - is touched for
  // nothing.
  if (mine === tip && onBranch === branch) return;
  if (mine !== tip) {
    /*
     * A commit the host's repository does not have is the machine's own work
     * and the only copy of it, so the machine stays on it: the fetch is
     * `bringBack`, and where it leaves work waiting the host has it and its
     * branch still does not lead on from it, which is the check below.
     */
    if (hostGit(tree, ['cat-file', '-e', `${mine}^{commit}`]).code !== 0) {
      machine.log?.(`the machine ${id} is not moved: it is at ${mine}, which the host has not fetched`);
      return;
    }
    if (hostGit(tree, ['merge-base', '--is-ancestor', mine, tip]).code !== 0) {
      machine.log?.(`the machine ${id} is not moved: ${branch === '' ? 'the host is detached' : branch} does not lead on from ${mine}`);
      return;
    }
    /*
     * The merge writes the machine's own working tree, so it is only run
     * where that tree holds nothing nobody committed: a file an agent is
     * working on is not ahpd's to write over, and a machine left where it is
     * costs a turn rather than the work.
     */
    if ((await inMachine('status', '--porcelain')).stdout.trim() !== '') {
      machine.log?.(`the machine ${id} is not moved: its tree holds changes nobody committed`);
      return;
    }
  }
  /*
   * A host on no branch hands over a commit with no branch to name it: the
   * machine goes to the same commit on no branch, and a branch of its own is
   * left where it was rather than moved or removed.
   */
  if (branch === '') {
    await inMachine('update-ref', '--no-deref', 'HEAD', tip);
    if (mine !== tip) await inMachine('reset', '--hard', '-q');
    return;
  }
  /*
   * The branch the host is on, made in the machine where it does not have it:
   * a machine put on a branch of its own that the host is not on would fetch
   * its next commit to a branch nobody is on. The machine does not move to
   * make it - the branch is made where the machine already is.
   *
   * A branch of the machine's that already carries that name is re-pointed
   * only where the commit it is pointed at leads on from it: a branch of the
   * machine's holding a commit its `HEAD` is not on top of is the only copy
   * of an agent's work, and `-B` would drop it - the same check the machine's
   * own `HEAD` gets above.
   */
  if (onBranch !== branch && !(await movesOver(inMachine, branch, mine))) {
    machine.log?.(`the machine ${id} is not moved: its branch ${branch} holds work it is not on top of`);
    return;
  }
  if (onBranch !== branch) await inMachine('checkout', '-q', '-B', branch, mine);
  if (mine !== tip) {
    const merged = await inMachine('merge', '--ff-only', tip);
    if (merged.code !== 0) {
      machine.log?.(`the machine ${id} is not moved: ${branch} could not be merged into its tree`);
      return;
    }
  }
};

/**
 * A repository's git directory in a machine, and the machine's own.
 *
 * A session whose folder is a repository, or a worktree of one, needs a git
 * directory in the machine for git to work there. Nothing of the host's is
 * mounted writable in it - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`: the
 * machine commits into a volume of its own, at the tree's own `.git` where
 * that is a directory and at `/opt/ahpd/git` where it is a file a volume
 * cannot be mounted over, and reads the host's objects from a read-only mount
 * of `objects/` through the alternates this host writes into that volume. The
 * machine's commands run as the host user, so every file git writes there
 * stays the host user's.
 *
 * A host git directory holding a symbolic link is refused before anything is
 * made: git writes no link in its root, under `logs/`, `refs/` or `objects/`,
 * or in a worktree's own entry, and the host's own git follows one wherever it
 * points.
 */

import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { gitArgv } from '@ahpd/sdk';

/**
 * The label naming the `<uid>:<gid>` every command in a machine runs as, set
 * on a machine made with a git directory.
 */
export const MACHINE_USER = 'ahpd.user';

/**
 * The label naming how a machine's git directory is guarded: `fetch` where the
 * machine commits in one of its own, `open` where the host's is mounted
 * writable in it.
 *
 * Read back after a restart, which is what tells a machine made under the
 * allowlist this plan removes from one of the two guards, and what
 * `a-machine-made-under-bind-is-never-entered` is decided on.
 */
export const MACHINE_GIT = 'ahpd.git';

/** Where a machine's own git directory is mounted where the tree's `.git` is a file. */
export const MACHINE_GIT_TARGET = '/opt/ahpd/git';

/**
 * Where a machine reads the host's objects, named by its `objects/info/alternates`.
 *
 * A path of ahpd's own rather than `<gitDir>/objects`, because a main checkout's
 * machine has its own git directory at `<root>/.git` - a volume - and a mount
 * inside a mount wins: a bind of the host's `objects/` at that path would be the
 * machine's object store, and a git that cannot write an object cannot commit.
 */
export const MACHINE_OBJECTS = '/opt/ahpd/host-objects';

/**
 * The file ahpd writes for a linked worktree, bound read-only over its `.git`.
 *
 * One file serves every machine, because what it says - where the volume is
 * mounted - is the same for all of them. It is kept in the directory the
 * daemon keeps its own records in.
 */
export const GITFILE = 'computers.gitfile';

/**
 * The name a machine's own git volume carries, before the machine's own.
 *
 * Written down once because it is read back from two directions: this host names
 * the volume when it makes a machine, and a machine's mounts are read later to
 * find the tree it was given, where the volume's own name is the whole of what
 * says which mount that is.
 */
export const GIT_VOLUME = 'ahpd-git';

/** The volume holding one machine's own git directory. */
export const gitVolumeOf = (machine: string): string => `${GIT_VOLUME}-${machine}`;

/** The host user's `<uid>:<gid>`, or nothing on a platform without them. */
export const hostUser = (): string | undefined => {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid === undefined || gid === undefined ? undefined : `${String(uid)}:${String(gid)}`;
};

/** A `<uid>:<gid>` as the numeric ids it names, or nothing. */
export const idsOfUser = (user: string | undefined): { uid: number; gid: number } | undefined => {
  const said = user === undefined ? null : /^(\d+):(\d+)$/.exec(user);
  return said === null ? undefined : { uid: Number(said[1]), gid: Number(said[2]) };
};

/** The user a machine's label names for its commands, or nothing. */
export const userLabelOf = (labels: Record<string, unknown>): string | undefined => {
  const said = labels[MACHINE_USER];
  return typeof said === 'string' && /^\d+:\d+$/.test(said) ? said : undefined;
};

/** One bind of a host path into a machine. */
export interface GitBind {
  /** The host path the bind reads. */
  path: string;
  /** Where it lands in the machine: the path itself when absent. */
  target?: string;
  readOnly: boolean;
}

/** What a machine with a git directory mounts, and where its own git directory goes. */
export interface GitMounts {
  /** Every bind after the folder's, in the order they are given to the runtime. */
  binds: GitBind[];
  /**
   * Where the volume holding the machine's own git directory is mounted, when
   * it gets one: the tree's own `.git` where that is a directory to mount a
   * volume at, and `/opt/ahpd/git` where it is a file a volume cannot be
   * mounted over.
   */
  volume?: string;
  /** The file ahpd wrote for a linked worktree, bound read-only over its `.git`. */
  gitfile?: string;
  /**
   * Where the machine reads the host's objects, where it is given a repository
   * of its own: the path its `objects/info/alternates` names, and so the one
   * thing of the host's the machine's git reads.
   */
  objects?: string;
  /**
   * Whether the volume holds the tree as well as the git directory, which is
   * `sessionTree: "copy"`: the volume is mounted at the tree's own path, its
   * git directory is `.git` inside it, and the working tree is the volume
   * itself. Absent under `shared`, where the volume is the git directory and
   * the working tree is the host's own - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
   */
  copy?: boolean;
}

/** What `lstat` says of a path, or nothing when it is not there. */
const statOf = (path: string) => {
  try { return lstatSync(path); }
  catch { return undefined; }
};

/** The real path of a path, or the path itself where it is not there. */
const realOf = (path: string): string => {
  try { return realpathSync(path); }
  catch { return path; }
};

/** The names in a directory, or nothing where it is not there to read. */
const namesIn = (dir: string): string[] => {
  try { return readdirSync(dir); }
  catch { return []; }
};

/**
 * The tree's spelling of a path: the one a machine reaches it by.
 *
 * Git answers real paths, and a session's folder may be a symbolic link to the
 * same directory. The machine mounts the tree at the spelling the folder was
 * given, so a mount written the real way would land beside it - a directory of
 * its own in the machine, with the tree's own left as it is.
 */
const spellingOf = (root: string): (path: string) => string => {
  const real = realOf(root);
  return (path: string): string => {
    if (real === root) return path;
    if (path === real) return root;
    return path.startsWith(`${real}/`) ? join(root, path.slice(real.length + 1)) : path;
  };
};

/** Refuse a gitfile that is a link, whose bind would land on what it names. */
const notLinked = (path: string): void => {
  if (statOf(path)?.isSymbolicLink() === true) {
    throw new Error(`${path} is a symbolic link, and a bind of it would land on what it points at rather than on the file this host wrote; remove it and start the session again`);
  }
};

/**
 * The session's own worktree entry, read from the `.git` file at the root of
 * its tree, or nothing where the root holds a `.git` directory or no file at all.
 *
 * Only an entry directly under `<gitDir>/worktrees` is the session's: a `.git`
 * file naming anywhere else is refused, since the machine would be given a
 * worktree of somebody else's repository.
 */
const entryOf = (gitDir: string, root: string): string | undefined => {
  const dotGit = join(root, '.git');
  const found = statOf(dotGit);
  if (found === undefined || found.isDirectory()) return undefined;
  if (!found.isFile()) throw new Error(`${dotGit} is neither a file nor a directory, so the worktree it belongs to cannot be read`);
  const said = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))?.[1];
  if (said === undefined) throw new Error(`${dotGit} names no gitdir, so the worktree it belongs to cannot be read`);
  const entry = isAbsolute(said) ? said : resolve(root, said);
  if (dirname(entry) !== join(gitDir, 'worktrees') || basename(entry) === '' || basename(entry).startsWith('.')) {
    throw new Error(`${dotGit} names ${entry}, which is not a worktree of ${gitDir}`);
  }
  return entry;
};

/** What a file says, trimmed, or nothing where it cannot be read. */
const saidBy = (path: string): string | undefined => {
  try { return readFileSync(path, 'utf8').trim(); }
  catch { return undefined; }
};

/**
 * Refuse a git directory that is not the tree's own, before anything is made.
 *
 * The host checks this before it makes a machine, and this is the same check
 * where the git directory is about to be read: a `.git` naming another
 * repository makes git answer that repository as the common directory, and the
 * machine would then be given somebody else's history. A worktree entry is
 * checked the way git reads it: the `.git` file names it, and its own `gitdir`
 * names that file back. The comparisons are on real paths: the tree may be
 * reached through a link, and the `.git` on either side of the comparison is
 * the same directory then.
 */
const ownOf = (gitDir: string, root: string, entry: string | undefined): void => {
  const dotGit = join(root, '.git');
  const there = statOf(dotGit);
  if (there?.isDirectory() === true) {
    if (realOf(dotGit) === realOf(gitDir)) return;
    const commondir = join(dotGit, 'commondir');
    const said = saidBy(commondir);
    throw new Error(said === undefined || said === '' || resolve(dotGit, said) === resolve(dotGit)
      ? `${gitDir} is not the git directory of ${root}, which holds ${dotGit}`
      : `${gitDir} is not the git directory of ${root}: ${commondir} names ${said}`);
  }
  if (entry === undefined) return;
  const back = join(entry, 'gitdir');
  const said = saidBy(back);
  if (said === undefined || said === '' || realOf(resolve(entry, said)) !== realOf(dotGit)) {
    throw new Error(`${back} names ${said === undefined || said === '' ? 'nothing' : said}, which is not ${dotGit}, the file this worktree was made from`);
  }
  const common = join(entry, 'commondir');
  const names = saidBy(common);
  if (names !== undefined && names !== '' && realOf(resolve(entry, names)) !== realOf(gitDir)) {
    throw new Error(`${common} names ${names}, which is not ${gitDir}`);
  }
};

/**
 * Refuse a git directory holding a symbolic link, naming each link and what it
 * points at.
 *
 * Git writes no link in the root of a git directory, under `logs/`, `refs/` or
 * `objects/`, or in a worktree's own entry, so one there is either planted or a
 * person's - and the host's own git follows it wherever it points, which is
 * what this plan closes rather than leaves to a writable bind. Nothing is
 * removed: a person should see what is there before it goes.
 */
const linksIn = (gitDir: string, entry: string | undefined): void => {
  const under = [gitDir, join(gitDir, 'logs'), join(gitDir, 'refs'), join(gitDir, 'objects'), ...(entry === undefined ? [] : [entry])];
  const found: string[] = [];
  for (const dir of under) {
    for (const name of namesIn(dir)) {
      const path = join(dir, name);
      if (statOf(path)?.isSymbolicLink() !== true) continue;
      found.push(`${dir} holds ${path}, a symbolic link to ${readlinkSync(path)}, which git never makes; remove it and start the session again`);
    }
  }
  if (found.length > 0) throw new Error(found.join('; '));
};

/** Make a file on the host, with `said` in it, so a bind of it has a source. */
const madeFile = (path: string, said: string): void => {
  if (statOf(path) !== undefined) return;
  // `wx`, so a file that appeared since is left as it is.
  try { writeFileSync(path, said, { flag: 'wx', mode: 0o644 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
};

/**
 * The gitfile a linked worktree's machine needs, written into `state` and answered.
 *
 * A machine's git directory is a volume, and a volume cannot be mounted over
 * the file a linked worktree's `.git` is. So this host writes a file of its own
 * naming where the volume is mounted, in the directory it keeps its own records
 * in - never inside the tree, which the machine may write - and the runtime
 * binds that over `<root>/.git`. The content is the same for every machine, so
 * one file is kept and reused.
 */
const gitfileIn = (state: string): string => {
  const file = join(state, GITFILE);
  notLinked(file);
  mkdirSync(state, { recursive: true });
  madeFile(file, `gitdir: ${MACHINE_GIT_TARGET}\n`);
  if (statOf(file)?.isFile() !== true) throw new Error(`${file} is not a file, so there is nothing to bind over the tree's .git`);
  return file;
};

/**
 * What a machine with a git directory mounts, and where its own git directory goes.
 *
 * The host's `objects/` is the one thing of its git directory the machine
 * reads, read-only at `MACHINE_OBJECTS`: the machine's own directory names that
 * path through `objects/info/alternates`, so the whole history is there to read
 * and none of it can be written. It is not mounted at `<gitDir>/objects`,
 * because on a main checkout the machine's own git directory is a volume at
 * `<root>/.git` and a bind inside it would be the machine's object store.
 *
 * The machine's own git directory is a volume, and where it is mounted depends
 * on the tree: a main checkout's `.git` is a directory, so the volume lands
 * over it; a linked worktree's `.git` is a file, and a volume cannot be mounted
 * over one, so the volume lands at `MACHINE_GIT_TARGET` with the file this host
 * wrote for it bound over the tree's `.git` read-only.
 *
 * Every path is the tree's spelling of the one git answered, so the mounts land
 * where the machine reaches the tree. Nothing is made in the host's git
 * directory, and a git directory holding a link or naming alternates of its own
 * is refused first, so a refusal leaves nothing made.
 */
export const gitMounts = (gitDir: string, root: string, state: string, copy = false): GitMounts => {
  const found = entryOf(gitDir, root);
  ownOf(gitDir, root, found);
  const at = spellingOf(root);
  const here = at(gitDir);
  const entry = found === undefined ? undefined : at(found);
  const config = join(here, 'config');
  if (statOf(config)?.isFile() !== true) throw new Error(`${config} is not there, so ${here} is not a git directory`);
  linksIn(here, entry);
  const objects = join(here, 'objects');
  const alternates = join(objects, 'info', 'alternates');
  const listed = saidBy(alternates);
  if (listed !== undefined && listed !== '') {
    throw new Error(`${alternates} names ${listed.split('\n')[0] ?? listed}, and the objects there are not mounted in the machine, whose git would fail on the first one it could not read; remove it and start the session again`);
  }
  const dotGit = join(root, '.git');
  const mounted: GitBind = { path: objects, target: MACHINE_OBJECTS, readOnly: true };
  /*
   * Under `copy` the machine works in the volume itself: it is mounted at the
   * tree's own path, the machine's git directory is `.git` inside it, and the
   * host's tree is not bound at all - so there is no linked worktree's file to
   * replace and nothing to mount the volume over. Both trees are read the same
   * way first, since the objects the machine reads are the host's either way.
   */
  if (copy) return { binds: [mounted], volume: root, objects: MACHINE_OBJECTS, copy: true };
  if (entry === undefined) {
    if (statOf(dotGit)?.isDirectory() !== true) throw new Error(`${dotGit} is not a directory, so ${here} is not the git directory of ${root}`);
    return { binds: [mounted], volume: dotGit, objects: MACHINE_OBJECTS };
  }
  const file = gitfileIn(state);
  return {
    binds: [
      mounted,
      { path: file, target: dotGit, readOnly: true },
    ],
    volume: MACHINE_GIT_TARGET,
    gitfile: file,
    objects: MACHINE_OBJECTS,
  };
};

/**
 * The tree a machine was given, read back from its own mounts, or nothing.
 *
 * A machine's git is reached at the tree's own path - the folder the session
 * works in - and its git mounts are what says where that is: the machine's own
 * git directory at the tree's `.git`, as the named volume where that is a
 * directory and as the gitfile this host wrote where it is a file. The tree is
 * the directory above that mount's target.
 *
 * Read from the mounts rather than from a label, because the path is the
 * machine's own: a session whose folder was reached through a link is a machine
 * whose git is at the link's spelling of it, and a session that moved is a
 * machine mounted where it really is. Nothing for a machine with no git
 * directory of its own, which is one whose profile gave it none and one whose
 * guard mounts the host's own - neither of which has work of its own to bring
 * back.
 */
export const treeOf = (mounts: readonly unknown[]): string | undefined => listedTree(mounts)?.tree;

/**
 * Whether a machine works in a copy of the tree, read from its own mounts the
 * way `treeOf` reads the tree: the volume is mounted at the tree's own path
 * rather than at its `.git`, which is what `sessionTree: "copy"` makes.
 */
export const copyOf = (mounts: readonly unknown[]): boolean => listedTree(mounts)?.copy === true;

/** The tree a machine was given, and whether its own volume holds it too. */
const listedTree = (mounts: readonly unknown[]): { tree: string; copy: boolean } | undefined => {
  for (const mount of mounts) {
    if (typeof mount !== 'object' || mount === null) continue;
    const { Source: source, Destination: target, Name: name } = mount as Record<string, unknown>;
    if (typeof target !== 'string' || target === '') continue;
    const above = dirname(target);
    if (above === '') continue;
    /*
     * What a mount is, by the name it was asked for. Docker spells a named
     * volume twice: `Name` is the name this host gave it and `Source` is the
     * path the driver keeps it at, which is no name at all - while the scripted
     * Docker a case runs against records the name in `Source`. Either spelling
     * is the name here, since a name is what says the volume is ahpd's.
     */
    const held = typeof name === 'string' && name !== '' ? name : source;
    if (typeof held !== 'string' || held === '') continue;
    /*
     * The mounts that name the tree. A linked worktree's git directory is at a
     * path of ahpd's own, since a volume cannot be mounted over the file its
     * `.git` is, and the gitfile bound over that file is what names the tree
     * there; a main checkout's `.git` is a directory and holds the volume
     * itself; and under `copy` the volume holds the tree, so it is mounted at
     * the tree's own path and there is no gitfile at all.
     */
    if (basename(held) === GITFILE) return { tree: above, copy: false };
    if (!held.startsWith(`${GIT_VOLUME}-`)) continue;
    if (basename(target) === '.git') return { tree: above, copy: false };
    /*
     * Anything else the volume is mounted at is the tree itself - but not the
     * path of ahpd's own a linked worktree's directory goes to, which names
     * nothing and whose tree the gitfile above names.
     */
    if (target !== MACHINE_GIT_TARGET) return { tree: target, copy: true };
  }
  return undefined;
};

/** What the host's tree says about the repository a machine is made from. */
export interface GitSeed {
  /** The branch checked out in the tree, or nothing where its HEAD is detached. */
  branch?: string;
  /**
   * The commit the tree is at, or nothing where the branch it is on has none:
   * a repository nobody has committed in yet is a branch and no history.
   */
  commit?: string;
  /** The name a commit is made under, as the tree's own config answers it. */
  name?: string;
  /** The address a commit is made under, as the tree's own config answers it. */
  email?: string;
}

/**
 * What a machine's repository is seeded from: the tree read as git reads it.
 *
 * Read with the hardened argv, in the tree and not in the git directory, so a
 * linked worktree answers its own branch and its own commit. Nothing here
 * writes anything, and nothing of the host's config is carried but the two
 * values a commit cannot be made without: a remote, a hooks path or an include
 * would be a path of this host's inside a machine.
 */
export const seedOf = (root: string): GitSeed => {
  const said = (args: string[]): string | undefined => {
    const held = spawnSync('git', gitArgv(root, args), { encoding: 'utf8' });
    const text = held.status === 0 && typeof held.stdout === 'string' ? held.stdout.trim() : '';
    return text === '' ? undefined : text;
  };
  const head = said(['symbolic-ref', '-q', 'HEAD']);
  const branch = head !== undefined && head.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : undefined;
  const commit = said(['rev-parse', 'HEAD']);
  const name = said(['config', '--get', 'user.name']);
  const email = said(['config', '--get', 'user.email']);
  return {
    ...(branch === undefined ? {} : { branch }),
    ...(commit === undefined ? {} : { commit }),
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
  };
};

/**
 * How a profile guards a git directory visible in its machines.
 *
 * `fetch`, the default, gives the machine a git directory of its own and
 * mounts nothing of the host's but the objects, read-only; the work comes back
 * by fetch. `open` leaves the host's git directory writable in the machine,
 * mounting one outside the tree read-write on its own: the operator's own
 * choice for a machine they trust with it - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 */
export type GitGuard = 'fetch' | 'open';

/**
 * Whether a git directory sits inside the tree mounted at `root`, answered on
 * real paths.
 *
 * A folder that is a symbolic link to a repository holds the git directory git
 * answers for it, and comparing the two spellings says it does not.
 */
export const gitInside = (gitDir: string, root: string): boolean => {
  const real = realOf(root);
  const inside = realOf(gitDir);
  return inside === real || inside.startsWith(`${real}/`);
};

/**
 * What a machine mounts for a git directory under its guard, or nothing.
 *
 * Under `fetch`, the machine's own git directory and the host's objects
 * read-only, whether the tree holds the git directory or not: the volume's own
 * mount is what makes the machine's directory a mount point. `state` is the
 * directory this host keeps its own records in, where a linked worktree's
 * gitfile is written. Under `open`, only the host git directory's own mount,
 * read-write, and nothing where the tree holds it.
 */
export const guardedMounts = (
  gitDir: string,
  root: string,
  state: string,
  guard: GitGuard = 'fetch',
  tree: SessionTree = 'shared',
): GitMounts | undefined => {
  if (tree === 'copy') return gitMounts(gitDir, root, state, true);
  if (guard === 'fetch') return gitMounts(gitDir, root, state);
  const inside = gitInside(gitDir, root);
  return inside ? undefined : { binds: [{ path: gitDir, readOnly: false }] };
};

/**
 * Whether a machine works in the host's tree or in a copy of it, as a profile's
 * `sessionTree` says.
 *
 * `shared`, the default, binds the host's tree into the machine at its own
 * path, read-write, so the host sees the agent's edits as it makes them. `copy`
 * gives the machine a checkout of its own in the volume it commits into, with
 * nothing of the host's tree bound - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
 */
export type SessionTree = 'shared' | 'copy';

/**
 * The guard a machine's git directory is made with.
 *
 * `copy` leaves nothing of the host's git directory mounted but the objects,
 * read-only, which is exactly what `fetch` says: a machine working in a copy of
 * the tree commits in a git directory of its own, so the guard has nothing to
 * open and the machine is made - and labelled - as one under `fetch`.
 */
export const guardFor = (guard: GitGuard | undefined, tree: SessionTree | undefined): GitGuard =>
  (tree === 'copy' ? 'fetch' : guard ?? 'fetch');

/**
 * Whether a machine's commands run as the host user: always under `fetch`, and
 * under `open` where the git directory is mounted on its own.
 */
export const runsAsHost = (gitDir: string, root: string, guard: GitGuard = 'fetch'): boolean =>
  guard === 'fetch' || !gitInside(gitDir, root);

/** A bind as `docker run -v` spells it. */
export const volumeFlagOf = (bind: GitBind): string =>
  `${bind.path}:${bind.target ?? bind.path}${bind.readOnly ? ':ro' : ''}`;

/** A bind as the Dev Container CLI's own string spelling of a mount. */
export const cliMountOf = (bind: GitBind): string =>
  `type=bind,source=${bind.path},target=${bind.target ?? bind.path}${bind.readOnly ? ',readonly' : ''}`;

/** A named volume as the Dev Container CLI's own string spelling of a mount. */
export const cliVolumeOf = (volume: string, target: string): string =>
  `type=volume,source=${volume},target=${target}`;

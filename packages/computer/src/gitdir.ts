/**
 * A repository's git directory in a machine, and what in it stays the host's.
 *
 * A session whose folder is a linked worktree, or a folder below a
 * repository's root, needs the repository's common git directory beside it for
 * git to work inside the machine. That directory also holds what git on the
 * host runs - hooks, and the config naming `core.hooksPath`,
 * `core.fsmonitor` and `core.sshCommand` - and what git reads for where
 * everything else is, `commondir`, so the directory is mounted read-only and
 * only the data a commit writes is left writable over it - decision
 * `a-machines-git-directory-is-read-only-but-what-a-commit-writes`. The
 * machine's commands run as the host user, so every file git writes there
 * stays the host user's.
 */

import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * The label naming the `<uid>:<gid>` every command in a machine runs as, set
 * on a machine made with a git directory.
 */
export const MACHINE_USER = 'ahpd.user';

/**
 * The label naming the session's own worktree entry under the git directory,
 * whose `index.lock` is removed once the machine is gone.
 */
export const MACHINE_WORKTREE = 'ahpd.worktree';

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

/** One bind of a host path at the same path inside the machine. */
export interface GitBind {
  path: string;
  readOnly: boolean;
}

/** What a machine with a git directory mounts over it, and the entry that is the session's own. */
export interface GitMounts {
  /** Every bind after the folder's, in the order they are given to the runtime. */
  binds: GitBind[];
  /** The session's own `<gitDir>/worktrees/<name>`, when its folder is a linked worktree. */
  entry?: string;
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

/**
 * The tree's spelling of a path: the one a machine reaches it by.
 *
 * Git answers real paths, and a session's folder may be a symbolic link to the
 * same directory. The machine mounts the tree at the spelling the folder was
 * given, so a bind written the real way is a directory of its own inside the
 * machine - one nothing else is mounted at, and writable - rather than the
 * read-only view over the tree's own `.git`.
 */
const spellingOf = (root: string): (path: string) => string => {
  const real = realOf(root);
  return (path: string): string => {
    if (real === root) return path;
    if (path === real) return root;
    return path.startsWith(`${real}/`) ? join(root, path.slice(real.length + 1)) : path;
  };
};

/** Refuse a path the machine could swap for one of its own: a link inside a writable mount. */
const notLinked = (path: string): void => {
  if (statOf(path)?.isSymbolicLink() === true) {
    throw new Error(`${path} is a symbolic link, and a machine with the git directory mounted could replace it with something the host's git then runs; make it a plain ${basename(path) === 'config' ? 'file' : 'directory'}`);
  }
};

/**
 * The session's own worktree entry, read from the `.git` file at the root of
 * its tree, or nothing where the root holds a `.git` directory or no file at all.
 *
 * Only an entry directly under `<gitDir>/worktrees` is the session's: a `.git`
 * file naming anywhere else is refused, since the binds below would leave what
 * it names writable.
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
 * where the directories are about to be made: a `.git` naming another
 * repository makes git answer that repository as the common directory, and for
 * a main checkout the binds below would then be laid over somebody else's
 * history - `hooks/`, `worktrees/` and `modules/` made inside it - rather than
 * over the tree's own. A worktree entry is checked the way git reads it: the
 * `.git` file names it, and its own `gitdir` names that file back. The
 * comparisons are on real paths: the tree may be reached through a link, and
 * the `.git` on either side of the comparison is the same directory then.
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

/** Make a file on the host, with `said` in it, so a bind of it has a source. */
const madeFile = (path: string, said: string): void => {
  if (statOf(path) !== undefined) return;
  // `wx`, so a file that appeared since is left as it is.
  try { writeFileSync(path, said, { flag: 'wx', mode: 0o644 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
};

/**
 * What a session on a main checkout mounts: the git directory's root writable,
 * with the eight paths git reads pinned read-only over it.
 *
 * The root is writable because that session's `index`, `HEAD`, `ORIG_HEAD` and
 * `COMMIT_EDITMSG` are files in it, and git writes each as `<name>.lock` beside
 * it and renames it into place - which is why the linked-worktree allowlist
 * cannot be used here, and why the pinning is a list of what git reads instead.
 * `commondir` is written as `.`, naming the directory itself: an agent writing
 * it is a `core.fsmonitor` the host user's next git runs, and an empty one is
 * git reading nothing. `worktrees/` and `objects/info/` are pinned for the same
 * reason one level down - a sibling worktree's `commondir`, and `alternates` -
 * and the two of them hold every worktree of this repository, this session's own
 * included, which is why the root is not pinned instead. The rest are made
 * empty, so each bind has a source.
 */
const mainCheckoutBinds = (gitDir: string): GitBind[] => {
  const pins: { path: string; said?: string; directory?: boolean }[] = [
    { path: join(gitDir, 'commondir'), said: '.\n' },
    { path: join(gitDir, 'config.worktree'), said: '' },
    { path: join(gitDir, 'config') },
    { path: join(gitDir, 'packed-refs'), said: '' },
    { path: join(gitDir, 'info'), directory: true },
    { path: join(gitDir, 'hooks'), directory: true },
    { path: join(gitDir, 'worktrees'), directory: true },
    { path: join(gitDir, 'objects', 'info'), directory: true },
  ];
  for (const one of pins) {
    notLinked(one.path);
    if (one.directory === true) mkdirSync(one.path, { recursive: true });
    else if (one.said !== undefined) madeFile(one.path, one.said);
  }
  return [{ path: gitDir, readOnly: false }, ...pins.map((one) => ({ path: one.path, readOnly: true }))];
};

/**
 * Make every bind source that may be missing on the host, and answer the binds
 * in order.
 *
 * The git directory is always a mount point of its own, the folder's mount or
 * not, so it cannot be renamed aside and replaced by a directory the machine
 * fills - except in a main checkout, whose root stays writable (see
 * `mainCheckoutBinds`).
 *
 * In a linked worktree it is read-only, and what is written over it is what a
 * commit writes: `objects/` with `objects/info/` read-only again, since
 * `objects/info/alternates` names where git reads objects from, `refs/` and
 * `logs/`; then the session's own entry read-write, its `config.worktree`,
 * `commondir` and `gitdir` read-only over the entry, and read-only `hooks/`,
 * `config`, `worktrees/`, `modules/` and the worktree's own `.git` file. No
 * bind names another worktree's entry: the read-only `worktrees/` covers them
 * all, and a bind of an entry pruned meanwhile would have Docker make a
 * root-owned directory on the host in its place.
 *
 * Whatever is missing of these is made here first, so every bind has a source
 * and nothing inside the machine can make one. A source that is a symbolic
 * link is refused: the link lives in a directory the machine may write, and a
 * bind lands on what it points at, so the machine could replace the link
 * itself.
 */
export const gitMounts = (gitDir: string, root: string): GitMounts => {
  const found = entryOf(gitDir, root);
  ownOf(gitDir, root, found);
  /*
   * Every path below is the tree's spelling of the one git answered, so the
   * binds land where the machine mounts the tree: a folder reached through a
   * link is mounted at the link, and a bind of the real path would be a
   * directory of its own in the machine, leaving the tree's own `.git` open.
   */
  const at = spellingOf(root);
  const here = at(gitDir);
  const entry = found === undefined ? undefined : at(found);
  const hooks = join(here, 'hooks');
  const config = join(here, 'config');
  const worktrees = join(here, 'worktrees');
  const modules = join(here, 'modules');
  const objects = join(here, 'objects');
  const objectsInfo = join(objects, 'info');
  const refs = join(here, 'refs');
  const logs = join(here, 'logs');
  notLinked(config);
  if (statOf(config)?.isFile() !== true) throw new Error(`${config} is not there, so ${here} is not a git directory`);
  if (entry === undefined) return { binds: mainCheckoutBinds(here) };

  for (const one of [objects, objectsInfo, refs, logs, hooks, worktrees, modules]) notLinked(one);
  for (const one of [objects, objectsInfo, refs, logs, hooks, worktrees, modules]) mkdirSync(one, { recursive: true });
  notLinked(entry);
  const pins = ['config.worktree', 'commondir', 'gitdir'].map((name) => join(entry, name));
  for (const one of pins) notLinked(one);
  const [worktreeConfig] = pins as [string, string, string];
  madeFile(worktreeConfig, '');
  for (const one of pins) {
    if (statOf(one)?.isFile() !== true) throw new Error(`${one} is not there, so the worktree entry ${entry} is not one git can use`);
  }
  const binds: GitBind[] = [
    { path: here, readOnly: true },
    { path: objects, readOnly: false },
    { path: objectsInfo, readOnly: true },
    { path: refs, readOnly: false },
    { path: logs, readOnly: false },
    { path: hooks, readOnly: true },
    { path: config, readOnly: true },
    { path: worktrees, readOnly: true },
    { path: entry, readOnly: false },
    ...pins.map((path) => ({ path, readOnly: true })),
    { path: modules, readOnly: true },
  ];
  if (statOf(join(root, '.git'))?.isFile() === true) binds.push({ path: join(root, '.git'), readOnly: true });
  return { binds, entry };
};

/**
 * How a profile guards a git directory visible in its machines: `bind` puts
 * the read-only binds over it and runs every command as the host user; `open`
 * leaves it writable, mounting one outside the tree read-write on its own.
 */
export type GitGuard = 'bind' | 'open';

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
 * Under `bind`, the git directory and what is read-only or writable over it,
 * whether the tree holds the directory or not: its own mount is what makes it
 * a mount point. Under `open`, only the git directory's own mount, and nothing
 * where the tree holds it.
 */
export const guardedMounts = (gitDir: string, root: string, guard: GitGuard = 'bind'): GitMounts | undefined => {
  if (guard === 'bind') return gitMounts(gitDir, root);
  const inside = gitInside(gitDir, root);
  return inside ? undefined : { binds: [{ path: gitDir, readOnly: false }] };
};

/**
 * Whether a machine's commands run as the host user: always under `bind`, and
 * under `open` where the git directory is mounted on its own.
 */
export const runsAsHost = (gitDir: string, root: string, guard: GitGuard = 'bind'): boolean =>
  guard === 'bind' || !gitInside(gitDir, root);

/** A bind as `docker run -v` spells it. */
export const volumeFlagOf = (bind: GitBind): string => `${bind.path}:${bind.path}${bind.readOnly ? ':ro' : ''}`;

/** A bind as the Dev Container CLI's own string spelling of a mount. */
export const cliMountOf = (bind: GitBind): string =>
  `type=bind,source=${bind.path},target=${bind.path}${bind.readOnly ? ',readonly' : ''}`;

/**
 * Remove a crashed agent's `index.lock` from the session's own worktree entry,
 * once the machine that may have held it is gone.
 *
 * Only an entry under some `worktrees/` directory, and only its `index.lock`:
 * never the main index's. `rm` unlinks a link rather than what it names.
 *
 * Only the machine's own lock, too. A lock whose time is after the machine
 * stopped was not written by it: the host's git is the only other thing that
 * locks this index - `ahpd`'s own check, or a person committing in the
 * worktree - and it may be holding the lock at this moment, in which case
 * removing it puts two writers on the index at once. The lock names no holder,
 * so its time is the one thing that tells the machine's from the host's.
 */
export const releaseLock = async (entry: string, before: Date, log?: (line: string) => void): Promise<void> => {
  if (!isAbsolute(entry) || basename(dirname(entry)) !== 'worktrees') return;
  const lock = join(entry, 'index.lock');
  const there = statOf(lock);
  if (there === undefined) return;
  if (there.mtimeMs > before.getTime()) {
    log?.(`kept ${lock}, which was locked after the machine stopped, so it is not the machine's`);
    return;
  }
  await rm(lock, { force: true }).catch((error: unknown) => {
    log?.(`could not remove ${lock}: ${error instanceof Error ? error.message : String(error)}`);
  });
};

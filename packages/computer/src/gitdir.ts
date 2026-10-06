/**
 * A repository's git directory in a machine, and what in it stays the host's.
 *
 * A session whose folder is a linked worktree, or a folder below a
 * repository's root, needs the repository's common git directory beside it for
 * git to work inside the machine. That directory also holds what git on the
 * host runs - hooks, and the config naming `core.hooksPath`,
 * `core.fsmonitor` and `core.sshCommand` - so those parts are bound read-only
 * over it, and the machine's commands run as the host user so every file git
 * writes there stays the host user's.
 */

import { closeSync, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
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

/**
 * Make every bind source that may be missing, empty, on the host, and answer
 * the binds in order.
 *
 * The order is the read-write git directory, left out where `mountDir` is
 * false because the tree's own mount already holds it, then read-only
 * `hooks/`, `config` and `worktrees/`, then the session's own entry read-write
 * over that, its `config.worktree`, `commondir` and `gitdir` read-only over the
 * entry, `modules/` read-only, and the worktree's own `.git` file read-only. No bind names another worktree's entry: the read-only
 * `worktrees/` covers them all, and a bind of an entry pruned meanwhile would
 * have Docker make a root-owned directory on the host in its place.
 *
 * Whatever is missing of `hooks/`, `worktrees/`, `modules/` and the entry's
 * `config.worktree` is made here first, so every bind has a source and nothing
 * inside the machine can make one. A source that is a symbolic link is refused:
 * the link lives in the writable git directory, and a bind lands on what it
 * points at, so the machine could replace the link itself.
 */
export const gitMounts = (gitDir: string, root: string, mountDir = true): GitMounts => {
  const entry = entryOf(gitDir, root);
  const hooks = join(gitDir, 'hooks');
  const config = join(gitDir, 'config');
  const worktrees = join(gitDir, 'worktrees');
  const modules = join(gitDir, 'modules');
  for (const one of [hooks, config, worktrees, modules]) notLinked(one);
  if (statOf(config)?.isFile() !== true) throw new Error(`${config} is not there, so ${gitDir} is not a git directory`);
  mkdirSync(hooks, { recursive: true });
  mkdirSync(worktrees, { recursive: true });
  mkdirSync(modules, { recursive: true });
  const binds: GitBind[] = [
    ...(mountDir ? [{ path: gitDir, readOnly: false }] : []),
    { path: hooks, readOnly: true },
    { path: config, readOnly: true },
    { path: worktrees, readOnly: true },
  ];
  if (entry !== undefined) {
    notLinked(entry);
    const own = ['config.worktree', 'commondir', 'gitdir'].map((name) => join(entry, name));
    for (const one of own) notLinked(one);
    const [worktreeConfig] = own as [string, string, string];
    // `wx`, so a file that appeared since is left as it is.
    if (statOf(worktreeConfig) === undefined) {
      try { closeSync(openSync(worktreeConfig, 'wx', 0o644)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    for (const one of own) {
      if (statOf(one)?.isFile() !== true) throw new Error(`${one} is not there, so the worktree entry ${entry} is not one git can use`);
    }
    binds.push({ path: entry, readOnly: false }, ...own.map((path) => ({ path, readOnly: true })));
  }
  binds.push({ path: modules, readOnly: true });
  if (statOf(join(root, '.git'))?.isFile() === true) binds.push({ path: join(root, '.git'), readOnly: true });
  return { binds, ...(entry === undefined ? {} : { entry }) };
};

/**
 * How a profile guards a git directory visible in its machines: `bind` puts
 * the read-only binds over it and runs every command as the host user; `open`
 * leaves it writable, mounting one outside the tree read-write on its own.
 */
export type GitGuard = 'bind' | 'open';

/** Whether a git directory sits inside the tree mounted at `root`. */
export const gitInside = (gitDir: string, root: string): boolean =>
  gitDir === root || gitDir.startsWith(`${root}/`);

/**
 * What a machine mounts for a git directory under its guard, or nothing.
 *
 * Under `bind`, the git directory's own mount where the tree does not hold it
 * and the read-only binds either way; under `open`, only the git directory's
 * own mount, and nothing where the tree holds it.
 */
export const guardedMounts = (gitDir: string, root: string, guard: GitGuard = 'bind'): GitMounts | undefined => {
  const inside = gitInside(gitDir, root);
  if (guard === 'bind') return gitMounts(gitDir, root, !inside);
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
 */
export const releaseLock = async (entry: string, log?: (line: string) => void): Promise<void> => {
  if (!isAbsolute(entry) || basename(dirname(entry)) !== 'worktrees') return;
  const lock = join(entry, 'index.lock');
  await rm(lock, { force: true }).catch((error: unknown) => {
    log?.(`could not remove ${lock}: ${error instanceof Error ? error.message : String(error)}`);
  });
};

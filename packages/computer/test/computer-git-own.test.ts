import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GITFILE, MACHINE_GIT_TARGET, MACHINE_OBJECTS, gitMounts } from '../src/gitdir.js';

/*
 * The git directory the runtime is handed, checked before it makes anything.
 *
 * The host checks the git directory git answered before it makes a machine
 * (`packages/sdk/src/host/machines.ts`). This is the runtime's own guard under
 * that one, and where the machine's own git directory is placed: a git
 * directory that is not the tree's own, one holding a symbolic link, and one
 * whose objects name alternates of their own are each refused, and a refusal
 * makes nothing - not in the host's git directory and not in the directory this
 * host keeps its own files in.
 */

/** What `lstat` says of a path, or nothing when it is not there. */
const statOf = (path: string) => {
  try { return lstatSync(path); }
  catch { return undefined; }
};

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** A repository with one commit, one linked worktree, and a second repository beside them. */
const twoRepositories = () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-git-own-'));
  const made = (name: string) => {
    const repo = join(loose as string, name);
    mkdirSync(repo);
    const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'tracked.txt'), 'tracked\n');
    run('add', '-A');
    run('commit', '-q', '-m', 'first');
    return repo;
  };
  const repo = made('repo');
  const run = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  const tree = join(loose, 'tree');
  run('worktree', 'add', '-q', '-b', 'work', tree);
  const elsewhere = join(made('elsewhere'), '.git');
  const gitDir = join(repo, '.git');
  const state = join(loose, 'config');
  return { repo, tree, gitDir, state, entry: join(gitDir, 'worktrees', 'tree'), elsewhere };
};

it('refuses a git directory the tree\'s own .git names from somewhere else', () => {
  const { repo, gitDir, state, elsewhere } = twoRepositories();
  // What git answers for this folder is the other repository's git directory,
  // because the folder's own `.git` says so.
  const commondir = join(gitDir, 'commondir');
  writeFileSync(commondir, `${elsewhere}\n`);
  const before = readdirSync(elsewhere).sort();

  expect(() => gitMounts(elsewhere, repo, state)).toThrow(/commondir/);
  // And nothing was made in it, and nothing for a machine that was never given it.
  expect(readdirSync(elsewhere).sort()).toEqual(before);
  expect(existsSync(join(state, GITFILE))).toBe(false);
});

it('refuses a worktree entry whose gitdir names another file', () => {
  const { tree, gitDir, state, entry, elsewhere } = twoRepositories();
  writeFileSync(join(entry, 'gitdir'), `${join(elsewhere, 'worktrees', 'tree')}\n`);

  expect(() => gitMounts(gitDir, tree, state)).toThrow(/gitdir/);
  expect(existsSync(join(state, GITFILE))).toBe(false);
});

it('answers a main checkout the host\'s objects read-only, and its git directory at the tree\'s own .git', () => {
  const { repo, gitDir, state } = twoRepositories();

  const mounts = gitMounts(gitDir, repo, state);
  // The one path of the host's git directory a machine reads, read-only, at a
  // path of ahpd's own: `MACHINE_OBJECTS`, which is what the machine's own
  // `objects/info/alternates` names. Not at `<gitDir>/objects`, because this
  // tree's machine has a volume of its own at `<repo>/.git` and a mount inside
  // a mount wins - the host's objects would be the machine's own object store.
  expect(mounts.binds).toEqual([{ path: join(gitDir, 'objects'), target: MACHINE_OBJECTS, readOnly: true }]);
  expect(mounts.objects).toBe(MACHINE_OBJECTS);
  // And the machine's own git directory, which is a volume landed over the
  // tree's `.git`: a main checkout's is a directory, so a volume mounts there.
  expect(mounts.volume).toBe(join(repo, '.git'));
  expect(mounts.gitfile).toBeUndefined();
  // Nothing else of the host's is answered, and nothing was made for it.
  expect(existsSync(join(state, GITFILE))).toBe(false);
});

it('answers a linked worktree the host\'s objects, a gitfile over its .git, and the volume elsewhere', () => {
  const { tree, gitDir, state } = twoRepositories();

  const mounts = gitMounts(gitDir, tree, state);
  // A volume cannot be mounted over the file a linked worktree's `.git` is, so
  // the machine's own git directory lands at `MACHINE_GIT_TARGET` and the file
  // this host wrote stands in for the tree's `.git`.
  expect(mounts.binds).toEqual([
    { path: join(gitDir, 'objects'), target: MACHINE_OBJECTS, readOnly: true },
    { path: join(state, GITFILE), target: join(tree, '.git'), readOnly: true },
  ]);
  expect(mounts.objects).toBe(MACHINE_OBJECTS);
  expect(mounts.volume).toBe(MACHINE_GIT_TARGET);
  expect(mounts.gitfile).toBe(join(state, GITFILE));
  expect(readFileSync(join(state, GITFILE), 'utf8')).toBe(`gitdir: ${MACHINE_GIT_TARGET}\n`);
});

it('refuses a git directory holding a symbolic link, naming it and what it points at', () => {
  const { repo, tree, gitDir, state } = twoRepositories();
  rmSync(join(gitDir, 'logs'), { recursive: true, force: true });
  mkdirSync(join(repo, 'elsewhere'));
  symlinkSync(join(repo, 'elsewhere'), join(gitDir, 'logs'));

  // git writes no link under `logs/`, and the host's own git follows one
  // wherever it points - so it is named, with what it names, and nothing is
  // made and nothing is removed.
  expect(() => gitMounts(gitDir, tree, state)).toThrow(/holds .*logs, a symbolic link to .*elsewhere, which git never makes/);
  expect(existsSync(join(state, GITFILE))).toBe(false);
  expect(statOf(join(gitDir, 'logs'))?.isSymbolicLink()).toBe(true);
});

it('refuses a git directory whose objects name alternates of their own', () => {
  const { repo, tree, gitDir, state } = twoRepositories();
  mkdirSync(join(gitDir, 'objects', 'info'), { recursive: true });
  writeFileSync(join(gitDir, 'objects', 'info', 'alternates'), `${join(repo, 'elsewhere')}\n`);

  // The machine reads the host's objects through the alternates this host
  // writes; one already there names paths that are not mounted, and the
  // machine's git would fail on the first object it could not read.
  expect(() => gitMounts(gitDir, tree, state)).toThrow(/alternates/);
  expect(existsSync(join(state, GITFILE))).toBe(false);
  expect(readdirSync(join(gitDir, 'objects', 'info'))).toEqual(['alternates']);
});

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { gitMounts } from '../src/gitdir.js';

/*
 * The git directory the runtime is handed, checked before it makes anything.
 *
 * The host checks the git directory git answered before it makes a machine
 * (plan host/65 p2 task 02, `packages/sdk/src/host/machines.ts`). This is the
 * runtime's own guard under that one: `gitMounts` refuses a git directory that
 * is not the tree's own, so a machine spec built by anything else cannot leave
 * `hooks/`, `worktrees/` and `modules/` - or a writable history - inside
 * somebody else's repository.
 */

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
  return { repo, tree, gitDir, entry: join(gitDir, 'worktrees', 'tree'), elsewhere };
};

it('refuses a git directory the tree\'s own .git names from somewhere else', () => {
  const { repo, gitDir, elsewhere } = twoRepositories();
  // What git answers for this folder is the other repository's git directory,
  // because the folder's own `.git` says so.
  const commondir = join(gitDir, 'commondir');
  writeFileSync(commondir, `${elsewhere}\n`);
  const before = readdirSync(elsewhere).sort();

  expect(() => gitMounts(elsewhere, repo)).toThrow(/commondir/);
  // And nothing was made in it: no `commondir` for a main checkout, no
  // `worktrees/` and no `modules/` for a machine that was never given it.
  expect(readdirSync(elsewhere).sort()).toEqual(before);
});

it('refuses a worktree entry whose gitdir names another file', () => {
  const { tree, gitDir, entry, elsewhere } = twoRepositories();
  writeFileSync(join(entry, 'gitdir'), `${join(elsewhere, 'worktrees', 'tree')}\n`);

  expect(() => gitMounts(gitDir, tree)).toThrow(/gitdir/);
  // Before anything is made: the directories a machine needs are not there.
  expect(existsSync(join(gitDir, 'modules'))).toBe(false);
});

it('accepts the commondir this host itself writes for a main checkout', () => {
  const { repo, gitDir } = twoRepositories();
  // Task 01 pins `commondir` as `.` for a main checkout, because an empty one
  // is a file git reads rather than none at all. The check has to accept what
  // this host wrote, or the second session in a repository is refused its own
  // git directory.
  writeFileSync(join(gitDir, 'commondir'), '.\n');
  const mounts = gitMounts(gitDir, repo);
  expect(mounts.binds[0]).toEqual({ path: gitDir, readOnly: false });
  expect(mounts.binds.map((one) => one.path)).toContain(join(gitDir, 'commondir'));
});

it('answers the binds for the worktree git made, its entry and all', () => {
  const { tree, gitDir, entry } = twoRepositories();
  const mounts = gitMounts(gitDir, tree);
  expect(mounts.entry).toBe(entry);
  expect(mounts.binds[0]).toEqual({ path: gitDir, readOnly: true });
  expect(mounts.binds.at(-1)).toEqual({ path: join(tree, '.git'), readOnly: true });
});

it('pins what a sibling worktree and the object store read on a main checkout too', () => {
  const { repo, gitDir } = twoRepositories();
  /*
   * A main checkout's root is writable, so every name git reads below it has to
   * be pinned back: `worktrees/` holds each sibling worktree's `commondir`, and
   * an agent that rewrites one points that worktree at a directory it fills
   * with a `config` setting `core.fsmonitor` - which the host user's next git
   * there runs. `objects/info/alternates` names where git reads objects from,
   * and is the same shape of hole. The linked-worktree branch pins both; a main
   * checkout pins them with it.
   */
  const mounts = gitMounts(gitDir, repo);
  const readOnly = new Set(mounts.binds.filter((one) => one.readOnly).map((one) => one.path));
  expect(readOnly.has(join(gitDir, 'worktrees'))).toBe(true);
  expect(readOnly.has(join(gitDir, 'objects', 'info'))).toBe(true);
  // And the root stays writable, which is what the pins are for.
  expect(mounts.binds[0]).toEqual({ path: gitDir, readOnly: false });
});

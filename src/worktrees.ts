/** Git worktrees, so two sessions in one repository do not edit under each other. */

import { execFile } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import type { Worktree, Worktrees } from './types/worktrees.js';

/** Run git, and answer what it said. Rejects with git's own words. */
const git = (dir: string, args: string[], ms = 60_000): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', ['-C', dir, ...args], { timeout: ms, maxBuffer: 8 << 20 }, (error, out, bad) => {
      if (!error) return resolve(out.toString());
      // git's own message, not node's: "fatal: a branch named x already
      // exists" is something a person can act on and `Command failed` is not.
      const said = bad.toString().trim() || error.message;
      reject(new Error(said));
    });
  });

/**
 * Where a repository's worktrees live: `<repo>.worktrees`, beside it.
 *
 * Beside rather than inside, because a worktree inside its own repository is
 * a directory git then has to be told to ignore, and every tool that walks the
 * tree finds the same project twice. The name is the one VS Code's host uses,
 * so a worktree either of them makes is one the other finds.
 */
export const worktreesOf = (repository: string): string =>
  join(dirname(repository), `${basename(repository)}.worktrees`);

/** The directory name for a branch: no slashes, since it has to be one segment. */
export const worktreeFor = (branch: string): string =>
  branch.replace(/^agents\//, '').replace(/\//g, '-');

/**
 * Git worktrees, as a host's `Worktrees` port.
 *
 * Deliberately not part of `createHost`: it spawns `git`, which is a binary
 * rather than a runtime API and may not be installed at all. A host without it
 * offers no isolation and every session runs in the folder it was pointed at,
 * which is what this daemon did before there was a choice.
 *
 * ```ts
 * createHost({ path, agents: [claude({ paths })], worktrees: gitWorktrees() });
 * ```
 */
export function gitWorktrees(): Worktrees {
  return {
    repository: async (dir) => {
      const found = await git(dir, ['rev-parse', '--show-toplevel'], 5_000).catch(() => undefined);
      const root = found?.trim();
      return root === undefined || root === '' ? undefined : root;
    },

    branches: async (repository) => {
      /*
       * Local branches by most recent commit, then the remote ones.
       *
       * Ordered rather than alphabetical because the useful answer is almost
       * always near the top of the first list, and a picker that opens on
       * `archive/2019-cleanup` is one somebody has to search.
       */
      const said = await git(
        repository,
        ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
        10_000,
      ).catch(() => '');
      const seen = new Set<string>();
      for (const line of said.split('\n')) {
        const name = line.trim();
        // `origin/HEAD` is a symbolic ref rather than a branch, and checking
        // it out is a detached head instead of the branch somebody meant.
        if (name === '' || name.endsWith('/HEAD')) continue;
        seen.add(name.replace(/^origin\//, ''));
      }
      return [...seen];
    },

    create: async (worktree: Worktree) => {
      await mkdir(dirname(worktree.path), { recursive: true });
      /*
       * A new branch, or the one that was chosen.
       *
       * `--no-track` unless asked, because the new branch is this session's
       * own: tracking would make it push to the base branch's upstream by
       * default, so a `git push` inside a worktree session would go at the
       * branch it was started *from*. That is the one mistake in here that
       * reaches a shared repository.
       *
       * No branch at all is `worktreeCreateNewBranch: false` - the session
       * continues `base` rather than starting something. Git refuses a second
       * worktree on a branch already checked out, and that refusal is right.
       */
      await git(worktree.repository, worktree.branch === undefined
        ? ['worktree', 'add', worktree.path, worktree.base]
        : [
          'worktree', 'add', worktree.track === true ? '--track' : '--no-track',
          '-b', worktree.branch, worktree.path, worktree.base,
        ]);
      for (const pattern of worktree.include ?? []) {
        // Best effort, one pattern at a time: a `.env` that is not there is
        // the ordinary case, and a session that refused to start over a
        // missing optional file would be worse than one without it.
        await copy(worktree.repository, worktree.path, pattern).catch(() => undefined);
      }
    },

    dirty: async (path) => {
      // `--porcelain` says nothing at all about a clean tree, which makes the
      // empty answer the reliable one. Untracked files count: a file the
      // agent wrote and never added is exactly the work worth keeping.
      const said = await git(path, ['status', '--porcelain'], 10_000).catch(() => 'unknown');
      return said.trim() !== '';
    },

    remove: async (repository, path, branch) => {
      await git(repository, ['worktree', 'remove', path]);
      /*
       * The branch too, and only the one this host made.
       *
       * Named by the caller rather than derived from the directory: a branch
       * prefix a client asked for changes the name, and guessing it wrong
       * either deletes nothing or - far worse - names somebody else's. `-d`
       * refuses to delete a branch carrying commits nothing else has, which
       * is the same judgement the dirty check makes about uncommitted work.
       */
      if (branch !== undefined) await git(repository, ['branch', '-d', branch]).catch(() => undefined);
    },
  };
}

/**
 * Copy one git-ignored path into the new worktree, keeping its place.
 *
 * A glob only in the shallow sense the reference uses it: a literal path, or
 * one trailing `*` in the last segment. A full matcher here would be a
 * dependency and a surprise - the patterns clients send are `.env`,
 * `.env.local` and `node_modules`.
 */
const copy = async (from: string, to: string, pattern: string): Promise<void> => {
  if (pattern.includes('..') || pattern.startsWith('/')) return;
  const star = pattern.lastIndexOf('*');
  if (star === -1) {
    await cp(join(from, pattern), join(to, pattern), { recursive: true, errorOnExist: false });
    return;
  }
  const at = pattern.lastIndexOf('/');
  const dir = at === -1 ? '' : pattern.slice(0, at);
  const leaf = at === -1 ? pattern : pattern.slice(at + 1);
  if (leaf.indexOf('*') !== leaf.lastIndexOf('*')) return;
  const [before, after] = leaf.split('*');
  const entries = await readdir(join(from, dir)).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.startsWith(before ?? '') || !entry.endsWith(after ?? '')) continue;
    const source = join(from, dir, entry);
    // Directories as well as files: `node_modules` is the pattern that makes
    // the difference between a worktree that builds and one that does not.
    const what = await stat(source).catch(() => undefined);
    if (!what) continue;
    await cp(source, join(to, dir, entry), { recursive: what.isDirectory(), errorOnExist: false });
  }
};

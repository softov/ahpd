/** Git worktrees, so two sessions in one repository do not edit under each other. */

import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { cp, lstat, mkdir, mkdtemp, readdir, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import type { Worktree, Worktrees } from '../types/worktrees.js';
import { gitArgv } from './hardened.js';

/**
 * The untracked or ignored entries of a `status --porcelain` answer that are
 * links this host made: a link, whose last segment is one of the `linked`
 * folder names.
 *
 * The links read as untracked when `.gitignore` names the folder in its
 * directory form, and they are not anybody's work. Only while each is still a
 * link: a real folder at that name is. Ignored too, for Windows: there a link
 * is a junction, which git takes for the folder it points at, and so for one
 * the directory pattern ignores.
 */
const linksIn = async (path: string, said: string, linked: readonly string[]): Promise<string[]> => {
  const names = new Set(linked.map((one) => one.replace(/\/+$/, '')));
  if (names.size === 0) return [];
  const found: string[] = [];
  for (const line of said.split('\n')) {
    if (!line.startsWith('?? ') && !line.startsWith('!! ')) continue;
    const entry = line.slice(3).replace(/\/+$/, '');
    if (!names.has(entry.slice(entry.lastIndexOf('/') + 1))) continue;
    if (await lstat(join(path, entry)).then((info) => info.isSymbolicLink(), () => false)) found.push(entry);
  }
  return found;
};

/** `junction` on Windows, for the reason `link` gives. */
const linkType = process.platform === 'win32' ? 'junction' : 'dir';

/**
 * Run git, and answer what it said. Rejects with git's own words.
 *
 * `stdin` is written to the child and closed, for the commands that take
 * their input that way rather than as arguments: `check-ignore --stdin` is the
 * one, and it is how the reference asks about a list of candidates at once
 * rather than one path at a time. Written to the child rather than passed as
 * an `input` option, which the asynchronous form of `execFile` does not honour
 * - git would sit on an open pipe and never answer.
 */
const git = (dir: string, args: string[], ms = 60_000, stdin?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile('git', gitArgv(dir, args), { timeout: ms, maxBuffer: 8 << 20, windowsHide: true }, (error, out, bad) => {
      if (!error) return resolve(out.toString());
      // git's own message, not node's: "fatal: a branch named x already
      // exists" is something a person can act on and `Command failed` is not.
      const said = bad.toString().trim() || error.message;
      reject(new Error(said));
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
  });

/**
 * Where a repository's worktrees live: `<repo>.worktrees`, beside it.
 *
 * Beside rather than inside, because a worktree inside its own repository is
 * a directory git then has to be told to ignore, and every tool that walks the
 * tree finds the same project twice. The name is the one VS Code's host uses,
 * so a worktree either of them makes is one the other finds.
 *
 * A `root` puts them under that folder instead, as `<root>/<repo>/<name>`. That is this host's own
 * departure from the reference, which fixes the location and offers no
 * setting, so a tree made under a root is one the reference host does not
 * find.
 */
export const worktreesOf = (repository: string, root?: string): string =>
  root === undefined
    ? join(dirname(repository), `${basename(repository)}.worktrees`)
    : join(root, basename(repository));

/**
 * Whether `candidate` is one of a repository's own worktrees: a folder under
 * its `<repo>.worktrees`, and never that folder itself, as VS Code decides
 * which working directory may inherit its repository's trust. A tree under a
 * configured root is outside the layout.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/worktreePaths.ts#L26-L42
 */
export const isWorktreeUnderRepository = (candidate: string, repository: string): boolean => {
  const inside = relative(resolve(worktreesOf(repository)), resolve(candidate));
  return inside !== '' && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
};

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
      // git writes a Windows path with forward slashes; this host's own
      // spelling is what every caller compares it with.
      return root === undefined || root === '' ? undefined : resolve(root);
    },

    gitDir: async (dir) => {
      /*
       * One call for all three answers, under the same limit as `repository`.
       *
       * Both git directories, because they differ for a linked worktree and
       * they are what a caller checks the tree's own `.git` against: the
       * directory for a main checkout is the common one, and for a worktree
       * it is the entry the tree's `.git` file names.
       *
       * Outside a repository is the one refusal answered as nothing; anything
       * else git says - a config it cannot read, an owner it does not trust -
       * rejects in git's words, so a caller can tell the two apart.
       */
      let said: string;
      try {
        said = await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--absolute-git-dir', '--show-toplevel'], 5_000);
      }
      catch (error) {
        if (/not a git repository/i.test((error as Error).message)) return undefined;
        throw error;
      }
      const [common, own, top] = said.split('\n').map((line) => line.trim());
      if (common === undefined || common === '' || own === undefined || own === '' || top === undefined || top === '') return undefined;
      return { gitDir: resolve(common), worktreeDir: resolve(own), repository: resolve(top) };
    },

    commitOf: async (dir) => {
      const found = await git(dir, ['rev-parse', 'HEAD'], 5_000).catch(() => undefined);
      const commit = found?.trim();
      return commit === undefined || commit === '' ? undefined : commit;
    },

    branches: async (repository) => {
      /*
       * The branch checked out, then local branches by most recent commit,
       * then the remote ones.
       *
       * Ordered rather than alphabetical because the useful answer is almost
       * always near the top of the first list, and a picker that opens on
       * `archive/2019-cleanup` is one somebody has to search. The checked-out
       * one first because "work from here" is what a folder session means,
       * and it is what somebody who never opens the picker gets - the
       * reference host defaults to the same.
       */
      const [current, said] = await Promise.all([
        git(repository, ['branch', '--show-current'], 5_000).catch(() => ''),
        git(
          repository,
          ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
          10_000,
        ).catch(() => ''),
      ]);
      const seen = new Set<string>();
      if (current.trim() !== '') seen.add(current.trim());
      for (const line of said.split('\n')) {
        const name = line.trim();
        // `origin/HEAD` is a symbolic ref rather than a branch, and checking
        // it out is a detached head instead of the branch somebody meant.
        if (name === '' || name.endsWith('/HEAD')) continue;
        seen.add(name.replace(/^origin\//, ''));
      }
      return [...seen];
    },

    /*
     * The remote's `HEAD`, `origin`'s where there is one and the first
     * remote's otherwise, named as VS Code's host names it: the upstream of
     * the local branch it points at, the local branch where that tracks
     * nothing, or the remote branch where there is no local one.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitService.ts#L107-L137
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1036-L1044
     */
    defaultBranch: async (repository) => {
      const remotes = (await git(repository, ['remote'], 5_000).catch(() => '')).split('\n').map((one) => one.trim()).filter((one) => one !== '');
      const remote = remotes.includes('origin') ? 'origin' : remotes[0];
      if (remote === undefined) return undefined;
      const prefix = `refs/remotes/${remote}/`;
      const pointed = (await git(repository, ['symbolic-ref', '--quiet', `${prefix}HEAD`], 5_000).catch(() => '')).trim();
      if (!pointed.startsWith(prefix)) return undefined;
      const name = pointed.slice(prefix.length);
      const local = await git(repository, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], 5_000).then(() => true, () => false);
      if (!local) {
        const remoteBranch = await git(repository, ['show-ref', '--verify', '--quiet', pointed], 5_000).then(() => true, () => false);
        return remoteBranch ? `${remote}/${name}` : undefined;
      }
      const upstream = (await git(repository, ['rev-parse', '--abbrev-ref', `${name}@{upstream}`], 5_000).catch(() => '')).trim();
      return upstream === '' ? name : upstream;
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
      const sharing = worktree.symlink ?? [];
      if (sharing.length > 0) {
        /*
         * Before the include copy, as the reference runs it: a folder that is
         * linked should not also be copied, and the links are what the copy
         * runs against.
         *
         * One try around the whole pass rather than each link. `node_modules`
         * can be enormous, a pattern can name a folder this machine has no
         * permission to link, and none of that is a reason a session should
         * not start - a worktree without the link still runs an agent, which
         * is not true of one that never began.
         */
        try {
          for (const folder of await ignoredFolders(worktree.repository, sharing)) {
            await link(worktree.repository, worktree.path, folder);
          }
        } catch (error) {
          console.warn(`@ahpd/sdk: could not link every folder into ${worktree.path}: ${(error as Error).message}`);
        }
      }
      for (const pattern of worktree.include ?? []) {
        // Best effort, one pattern at a time: a `.env` that is not there is
        // the ordinary case, and a session that refused to start over a
        // missing optional file would be worse than one without it.
        await copy(worktree.repository, worktree.path, pattern).catch(() => undefined);
      }
    },

    dirty: async (path, linked = []) => {
      // `--porcelain` says nothing at all about a clean tree, which makes the
      // empty answer the reliable one. Untracked files count: a file the
      // agent wrote and never added is exactly the work worth keeping. With
      // folders linked, every untracked file on its own line, so a link
      // inside an untracked folder is not hidden behind the folder.
      const every = linked.length === 0 ? [] : ['--untracked-files=all'];
      const said = await git(path, ['status', '--porcelain', ...every], 10_000).catch(() => 'unknown');
      const links = new Set(await linksIn(path, said, linked));
      return said.split('\n').some((line) => line.trim() !== '' && !(line.startsWith('?? ') && links.has(line.slice(3))));
    },

    remove: async (repository, path, branch, linked = []) => {
      /*
       * The host's own links out of the way first, since git refuses a tree
       * with anything untracked in it, and that refusal is still the guard
       * for everything else. Put back when it refuses, so a tree that stays
       * is the tree it was.
       *
       * The ignored entries as well, by the folder that matched and not its
       * contents. On Windows a link left in place is a folder to git, and
       * `worktree remove` deletes what is inside it: the checkout's own
       * `node_modules`, through the junction.
       */
      const said = linked.length === 0
        ? ''
        : await git(path, ['status', '--porcelain', '--untracked-files=all', '--ignored=matching'], 10_000).catch(() => '');
      const links: { entry: string; target: string }[] = [];
      for (const entry of await linksIn(path, said, linked)) {
        links.push({ entry, target: await readlink(join(path, entry)) });
      }
      for (const { entry } of links) await rm(join(path, entry));
      await git(repository, ['worktree', 'remove', path]).catch(async (error: unknown) => {
        for (const { entry, target } of links) await symlink(target, join(path, entry), linkType).catch(() => undefined);
        throw error;
      });
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

    commit: async (path, message, linked = []) => {
      const said = await git(path, ['status', '--porcelain', '--untracked-files=all'], 10_000);
      const links = await linksIn(path, said, linked);
      await git(path, ['add', '-A', '--', '.', ...links.map((one) => `:(exclude,literal)${one}`)]);
      // A clean tree stages nothing, and is no commit at all.
      const staged = await git(path, ['diff', '--cached', '--name-only']);
      if (staged.trim() === '') return;
      await git(path, ['commit', '--quiet', '-m', message]);
    },

    head: async (path) => {
      // `--quiet` answers a detached `HEAD` with a bare failure, which is the
      // same answer as a tree git cannot read: no branch to name.
      const said = await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], 10_000).catch(() => '');
      const name = said.trim();
      return name === '' ? undefined : name;
    },

    pushed: async (path) => {
      // No upstream fails `rev-parse`, and that is the same answer as commits
      // nobody pushed: the branch is not on a remote as it is here.
      const upstream = await git(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 10_000).catch(() => '');
      if (upstream.trim() === '') return false;
      const ahead = await git(path, ['rev-list', '@{u}..HEAD'], 10_000).catch(() => undefined);
      return ahead !== undefined && ahead.trim() === '';
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

/** Git's NUL-separated output, as the entries it was. A path may hold a space. */
const entriesOf = (output: string): string[] => output.split('\0').filter((one) => one !== '');

/** Whether a repository-relative folder sits inside one of `folders`, or is one. */
const inside = (folder: string, folders: ReadonlySet<string>, self = true): boolean => {
  let at = self ? folder.length : folder.lastIndexOf('/');
  while (at > 0) {
    if (folders.has(`${folder.slice(0, at)}/`)) return true;
    at = folder.lastIndexOf('/', at - 1);
  }
  return false;
};

/**
 * The folders in a checkout that a set of `.gitignore` patterns names.
 *
 * Not the shallow matcher `copy` uses, and deliberately not: these patterns are
 * `.gitignore` syntax, where `node_modules/` means every directory of that name
 * at any depth, and a glob over one directory answers it for the root and
 * nothing else. So git is asked, the way the reference asks.
 *
 * A candidate is an ignored *file*'s ancestor - git names `node_modules` only
 * through the files inside it - and it is kept only when three things agree:
 * the checkout ignores it, these patterns match it, and it sits inside a
 * wholly ignored folder. Each is asked separately because each can fail while
 * the others pass: a pattern can match a file git tracks, a folder can be
 * ignored by a `.gitignore` the patterns never mention, and a folder matched at
 * the top can hold another folder matched at the bottom.
 *
 * Nothing here is fatal. An answer git refuses is an empty list, and the caller
 * has a session to start either way.
 */
const ignoredFolders = async (repository: string, patterns: string[]): Promise<string[]> => {
  // A pattern reaching outside the repository, or holding a line break, is one
  // a `.gitignore` file cannot carry - and a line break would split it into
  // two patterns and link neither.
  const clean = patterns.filter((one) =>
    one.trim() !== '' && !one.includes('..') && !one.startsWith('/') && !/[\r\n]/.test(one));
  if (clean.length === 0) return [];
  const temp = await mkdtemp(join(tmpdir(), 'ahpd-link-'));
  try {
    const excludes = join(temp, 'patterns');
    // A throwaway repository whose only job is to be a matcher. It has to be a
    // repository at all because `check-ignore` answers against one, and the
    // patterns reach it the way they reach a repository: `core.excludesFile`.
    const matcher = join(temp, 'matcher');
    await mkdir(matcher);
    await writeFile(excludes, `${clean.join('\n')}\n`);

    const base = ['ls-files', '--others', '--ignored', '-z'];
    const [ignoredOutput, matchedOutput, directoryOutput] = await Promise.all([
      git(repository, [...base, '--exclude-standard'], 30_000),
      git(repository, [...base, `--exclude-from=${excludes}`], 30_000),
      git(repository, [...base, '--exclude-standard', '--directory'], 30_000),
    ]);

    const named = new Set(entriesOf(matchedOutput));
    const candidates = new Set<string>();
    for (const file of entriesOf(ignoredOutput)) {
      if (!named.has(file)) continue;
      let at = file.lastIndexOf('/');
      while (at !== -1) {
        candidates.add(file.slice(0, at));
        at = file.lastIndexOf('/', at - 1);
      }
    }
    if (candidates.size === 0) return [];

    await git(matcher, ['init', '-q'], 10_000);
    /*
     * Each candidate offered as the directory it is, with its trailing slash.
     * A pattern written the way gitignore writes one - `node_modules/` - matches
     * directories and nothing else, and without the slash on the path git would
     * answer about a file and say nothing.
     */
    const asked = `${[...candidates].map((one) => `${one}/`).join('\0')}\0`;
    const [ignoredAnswer, matchedAnswer] = await Promise.all([
      git(repository, ['check-ignore', '--no-index', '-z', '--stdin'], 30_000, asked),
      git(matcher, ['-c', `core.excludesFile=${excludes}`, 'check-ignore', '--no-index', '-z', '--stdin'], 30_000, asked),
    ]);

    const ignored = new Set(entriesOf(ignoredAnswer));
    const matched = new Set(entriesOf(matchedAnswer));
    const wholly = new Set(entriesOf(directoryOutput).filter((one) => one.endsWith('/')));
    const folders = [...candidates].filter((one) =>
      ignored.has(`${one}/`) && matched.has(`${one}/`) && inside(one, wholly));
    // A folder inside another kept one, since linking the parent brings it.
    const kept = new Set(folders.map((one) => `${one}/`));
    return folders.filter((one) => !inside(one, kept, false));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

/**
 * Point one folder of a new worktree at the checkout's, as a symbolic link.
 *
 * Four checks, all the reference's, and each is there because of what goes
 * wrong without it. Two skip, two refuse.
 *
 * - A source already inside the worktree is skipped. A checkout and the tree
 *   made from it can share a directory, and a link from a worktree into itself
 *   resolves nowhere.
 * - A target parent that is a symbolic link, or is not a directory, is refused.
 *   A link under a link is one whose target nobody can say.
 * - A target that already exists is skipped. `lstat` and not `stat`, so a
 *   dangling link counts as existing: replacing it would take a link somebody
 *   made on purpose.
 * - Anything else is a folder whose parent is made and whose link is written.
 *
 * `junction` on Windows, as the reference does: a directory symlink there needs
 * a privilege an ordinary agent process does not have, and a junction does not.
 */
const link = async (from: string, to: string, folder: string): Promise<void> => {
  const at = folder.split('/');
  const source = join(from, ...at);
  const target = join(to, ...at);
  const [where, tree] = await Promise.all([realpath(source), realpath(to)]);
  // `relative` rather than a prefix test, so the separator is the platform's.
  const reached = relative(tree, where);
  if (reached === '' || (!reached.startsWith('..') && !isAbsolute(reached))) return;

  let current = to;
  for (const segment of at.slice(0, -1)) {
    current = join(current, segment);
    const what = await lstat(current).catch(() => undefined);
    // A parent that is not there yet is the ordinary case, and the mkdir below
    // makes it; only a parent that is there and is the wrong thing is a refusal.
    if (what === undefined) break;
    if (what.isSymbolicLink())
      throw new Error(`cannot link ${folder}: ${current} is a symbolic link`);
    if (!what.isDirectory())
      throw new Error(`cannot link ${folder}: ${current} is not a directory`);
  }

  if (await lstat(target).then(() => true, () => false)) return;
  await mkdir(dirname(target), { recursive: true });
  await symlink(source, target, linkType);
};

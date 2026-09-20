import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitChanges } from '../packages/sdk/src/changes.js';
import type { ChangesetOperationContext } from '../packages/sdk/src/types/changes.js';
import type { NewPullRequest, PullRequest } from '../packages/sdk/src/types/github.js';

/*
 * The pull request and checkout operations, on a real repository.
 *
 * Git is real because the operations are git: a branch is made, a commit is
 * made, a push goes to a remote, and the only honest test of that is a
 * repository. GitHub is faked, since what is under test is what this source
 * asks it and what it does with the answer, not GitHub.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const git = (dir: string, ...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();

/** A repository with a bare `origin` beside it, on `main`, with one commit. */
const repository = (): { dir: string; origin: string } => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-pr-'));
  made.push(root);
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const dir = join(root, 'work');
  execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'pipe' });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  return { dir, origin };
};

/** GitHub, as far as this source asks it. */
const github = (existing: PullRequest[] = []) => {
  const opened: NewPullRequest[] = [];
  const asked: { branch: string; token: string | undefined }[] = [];
  return {
    opened,
    asked,
    ask: {
      resource: { resource: 'https://api.github.com/repos' },
      forBranch: async (_repo: unknown, branch: string, token: string | undefined) => { asked.push({ branch, token }); return existing; },
      create: async (_repo: unknown, wanted: NewPullRequest, _token: string | undefined) => {
        opened.push(wanted);
        return { url: `https://github.com/softov/ahpd/pull/${opened.length}`, state: 'open' as const };
      },
    },
  };
};

const withGithub = (fake: ReturnType<typeof github>, token?: string): ChangesetOperationContext => ({
  github: { ask: fake.ask, owner: 'softov', repo: 'ahpd', ...(token === undefined ? {} : { token }) },
});

const invoke = (dir: string, operationId: string, context: ChangesetOperationContext, meta?: Record<string, unknown>, subject?: string) => {
  const source = gitChanges();
  if (source.invoke === undefined) throw new Error('gitChanges() no longer runs operations');
  return source.invoke({ ...context, dir, session: 'ahp-session:/s', scope: 'uncommitted', operationId, ...(meta ? { meta } : {}), ...(subject ? { subject } : {}) });
};

describe('what the working tree offers', () => {
  it('offers the pull request pair beside commit where GitHub can be asked, and drops it once the branch has one', async () => {
    const { dir } = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    const source = gitChanges();
    await source.refresh?.(dir);
    const ids = (context?: ChangesetOperationContext) => (source.operations?.(dir, 'ahp-session:/s', 'uncommitted', context) ?? []).map((one) => one.id);
    expect(ids()).toEqual(['commit', 'discard']);
    expect(ids(withGithub(github()))).toEqual(['commit', 'discard', 'create-pr', 'prepare-pull-request']);
    expect(ids({ ...withGithub(github()), pullRequest: true })).toEqual(['commit', 'discard']);
    // And checkout on a tree nobody has worked in yet, the way the reference
    // host offers it on an unused draft.
    expect(ids({ unused: true })).toEqual(['commit', 'discard', 'checkout']);
  });
});

describe('preparing a pull request', () => {
  it('answers the form without touching the tree, in the shape the reference client reads', async () => {
    const { dir } = repository();
    git(dir, 'checkout', '-q', '-b', 'fix/kqueue');
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    git(dir, 'commit', '-qam', 'Port the kqueue build');
    writeFileSync(join(dir, 'tracked.txt'), 'three\n');
    const fake = github();
    const said = await invoke(dir, 'prepare-pull-request', withGithub(fake), undefined, 'Fix the kqueue build');
    const uri = said?.followUp?.content.uri ?? '';
    expect(uri.startsWith('data:application/json,')).toBe(true);
    expect(said?.followUp?.content.contentType).toBe('application/json');
    const details = JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length))) as Record<string, unknown>;
    expect(details).toEqual({
      title: 'Fix the kqueue build',
      description: '- Port the kqueue build',
      branchName: 'fix/kqueue',
      baseBranchName: 'main',
      repository: 'softov/ahpd',
      autoMergeAllowed: false,
      mergeMethods: [],
      agentMergeAvailable: false,
      context: { workingDirectory: `file://${dir}`, repository: 'softov/ahpd', branchName: 'fix/kqueue', baseBranchName: 'main' },
    });
    // Nothing moved: still dirty, nothing pushed, nobody asked GitHub.
    expect(git(dir, 'status', '--porcelain')).not.toBe('');
    expect(fake.asked).toEqual([]);
    // A validation pass answers nothing at all when the tree still stands where it did.
    expect(await invoke(dir, 'prepare-pull-request', withGithub(fake), { 'vscode.pullRequest': { validateOnly: true, expectedContext: details.context } })).toEqual({});
    await expect(invoke(dir, 'prepare-pull-request', withGithub(fake), {
      'vscode.pullRequest': { validateOnly: true, expectedContext: { ...details.context as object, branchName: 'other' } },
    })).rejects.toThrow('have changed since this pull request was prepared');
  });
});

describe('creating a pull request', () => {
  it('commits, branches off the base, pushes, and opens it with what the form said', async () => {
    const { dir, origin } = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    const fake = github();
    const said = await invoke(dir, 'create-pr', withGithub(fake, 'gho_x'), {
      'vscode.pullRequest': { title: 'Port the kqueue build', description: 'Because libkqueue.', draft: true, agentMerge: false },
    }, 'Port the kqueue build');
    // Off `main`, on a branch named after the work, committed and pushed.
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('agent/port-the-kqueue-build');
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(git(origin, 'rev-parse', '--verify', 'refs/heads/agent/port-the-kqueue-build')).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(git(dir, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/agent/port-the-kqueue-build');
    // Opened as the person who lent the token, with the form's words.
    expect(fake.asked).toEqual([{ branch: 'agent/port-the-kqueue-build', token: 'gho_x' }]);
    expect(fake.opened).toEqual([{ title: 'Port the kqueue build', body: 'Because libkqueue.', head: 'agent/port-the-kqueue-build', base: 'main', draft: true }]);
    expect(said?.followUp).toEqual({ content: { uri: 'https://github.com/softov/ahpd/pull/1', contentType: 'text/html' }, external: true });
    // And what the host records: the page, the form's title and the branch it landed on.
    expect(said?.pullRequest).toEqual({
      url: 'https://github.com/softov/ahpd/pull/1',
      title: 'Port the kqueue build',
      branch: 'agent/port-the-kqueue-build',
    });
  });

  it('answers the request the branch already has rather than opening a second', async () => {
    const { dir } = repository();
    git(dir, 'checkout', '-q', '-b', 'fix/kqueue');
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    git(dir, 'commit', '-qam', 'Port it');
    const fake = github([{ url: 'https://github.com/softov/ahpd/pull/7', state: 'open' }]);
    const said = await invoke(dir, 'create-pr', withGithub(fake));
    expect(fake.opened).toEqual([]);
    expect(said?.followUp?.content.uri).toBe('https://github.com/softov/ahpd/pull/7');
    // The reused path still says what to record, with the subject's title as
    // the fallback because the port reported none.
    expect(said?.pullRequest).toEqual({
      url: 'https://github.com/softov/ahpd/pull/7',
      title: 'Port it',
      branch: 'fix/kqueue',
    });
  });

  it('refuses what this host cannot do, in the reference host\'s words', async () => {
    const { dir } = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    const fake = github();
    await expect(invoke(dir, 'create-pr', withGithub(fake), { 'vscode.pullRequest': { title: '', description: '', draft: false, agentMerge: false } }))
      .rejects.toThrow('A pull request title is required.');
    await expect(invoke(dir, 'create-pr', withGithub(fake), { 'vscode.pullRequest': { title: 'x', description: '', draft: false, agentMerge: true } }))
      .rejects.toThrow('Agent Merge is not available on this host.');
    // A clean tree on the base branch has nothing to request.
    git(dir, 'checkout', '-q', '--', '.');
    await expect(invoke(dir, 'create-pr', withGithub(fake))).rejects.toThrow('There are no branch changes to create a pull request for.');
    expect(fake.opened).toEqual([]);
  });
});

describe('checking a branch out', () => {
  it('checks out a local branch, and says so as markdown', async () => {
    const { dir } = repository();
    git(dir, 'branch', 'other');
    const said = await invoke(dir, 'checkout', {}, { treeish: 'other' });
    expect(said?.message).toEqual({ markdown: 'Checked out branch `other`.' });
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('other');
    await expect(invoke(dir, 'checkout', {}, {})).rejects.toThrow('Select a branch to check out.');
    await expect(invoke(dir, 'checkout', {}, { treeish: 'nobody' })).rejects.toThrow("Branch 'nobody' is not an existing local branch.");
    await expect(invoke(dir, 'checkout', {}, { treeish: '--orphan' })).rejects.toThrow('not an existing local branch');
  });

  it('refuses a dirty tree with the reason the reference client reads, and stashes or commits when told', async () => {
    const { dir } = repository();
    git(dir, 'branch', 'other');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'diverge');
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    git(dir, 'checkout', '-q', 'other');
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'tracked.txt'), 'two on main\n');
    git(dir, 'commit', '-qam', 'main moves tracked.txt');
    git(dir, 'checkout', '-q', 'other');
    writeFileSync(join(dir, 'tracked.txt'), 'dirty\n');
    const refused = await invoke(dir, 'checkout', {}, { treeish: 'main' }).then(() => undefined, (error: unknown) => error) as { message: string; code?: number; data?: unknown };
    expect(refused.message).toContain('would be overwritten by checkout');
    expect(refused.code).toBe(-32602);
    expect(refused.data).toEqual({ reason: 'dirtyWorkingTree' });
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('other');

    await invoke(dir, 'checkout', {}, { treeish: 'main', preCheckoutAction: 'stash' });
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(dir, 'stash', 'list')).toContain('WIP: Changes before checking out main');

    writeFileSync(join(dir, 'fresh.txt'), 'new\n');
    await invoke(dir, 'checkout', {}, { treeish: 'other', preCheckoutAction: 'commit' });
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('other');
    expect(git(dir, 'log', '-1', '--format=%s', 'main')).toBe('WIP: Save changes before checking out other');
  });
});

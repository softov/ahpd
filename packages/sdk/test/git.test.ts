import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitBranches } from '../src/git.js';

/*
 * What a client reads about a repository, in the words it reads them in.
 *
 * The protocol declares no `_meta` keys at all, so the vocabulary is the
 * reference host's and the only way to know it is to look at what that host
 * sends. This host wrote `git.branch` where the reference writes
 * `git.branchName`, which is a field present, populated and invisible.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const repository = (remote?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-git-'));
  made.push(dir);
  const run = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  if (remote !== undefined) run('remote', 'add', 'origin', remote);
  return dir;
};

describe('what git can say about a served directory', () => {
  it('names the branch the way the client that reads it does', async () => {
    const facts = gitBranches();
    const dir = repository();
    await facts.refresh?.(dir);
    const meta = facts.meta(dir) as { git: Record<string, unknown> };
    expect(meta.git.branchName).toBe('main');
    // The old spelling is gone rather than kept beside it: two names for one
    // fact is what made this invisible in the first place.
    expect(meta.git.branch).toBeUndefined();
  });

  it('counts the work nobody has committed', async () => {
    const facts = gitBranches();
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    writeFileSync(join(dir, 'fresh.txt'), 'new\n');
    await facts.refresh?.(dir);
    const meta = facts.meta(dir) as { git: Record<string, unknown> };
    // Untracked counts: a file the agent wrote and never added is exactly the
    // work somebody wants to be told about.
    expect(meta.git.uncommittedChanges).toBe(2);
    /*
     * And no drift at all, rather than none of it.
     *
     * A branch with no upstream is not zero ahead and zero behind, it is
     * neither. A client draws these as arrows beside the branch name, so a
     * pair of zeroes is two arrows that say nothing.
     */
    expect(meta.git.incomingChanges).toBeUndefined();
    expect(meta.git.outgoingChanges).toBeUndefined();
    expect(meta.git.upstreamBranchName).toBeUndefined();
  });

  it('counts the drift once there is something to drift from', async () => {
    const facts = gitBranches();
    const dir = repository();
    const run = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    run('branch', 'upstream');
    run('branch', '--set-upstream-to=upstream', 'main');
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    run('commit', '-qam', 'second');
    await facts.refresh?.(dir);
    const meta = facts.meta(dir) as { git: Record<string, unknown> };
    expect(meta.git.upstreamBranchName).toBe('upstream');
    expect(meta.git.outgoingChanges).toBe(1);
    expect(meta.git.incomingChanges).toBe(0);
  });

  it('says whether the remote is a GitHub one, and whose', async () => {
    const facts = gitBranches();
    const ssh = repository('git@github.com:softov/ahpd.git');
    await facts.refresh?.(ssh);
    const one = facts.meta(ssh) as { git: Record<string, unknown> };
    expect(one.git.hasGitHubRemote).toBe(true);
    expect(one.git.githubOwner).toBe('softov');
    expect(one.git.githubRepo).toBe('ahpd');

    // And says no rather than guessing, for a remote that is not GitHub.
    const other = repository('https://git.example.com/softov/ahpd.git');
    await facts.refresh?.(other);
    const two = facts.meta(other) as { git: Record<string, unknown> };
    expect(two.git.hasGitHubRemote).toBe(false);
    expect(two.git.githubOwner).toBeUndefined();
  });

  it('says nothing at all about a directory that is not a repository', async () => {
    const facts = gitBranches();
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-plain-'));
    made.push(dir);
    await facts.refresh?.(dir);
    expect(facts.meta(dir)).toBeUndefined();
  });
});

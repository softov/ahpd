import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { gitBranches } from '../src/git.js';

/*
 * The git that `gitBranches` runs in the background takes no optional lock.
 *
 * `git status` refreshes the index when it can, and doing so takes
 * `.git/index.lock`; a person's `git add` at that moment is then refused with
 * "index.lock: File exists". `GIT_OPTIONAL_LOCKS=0` is git's own switch for a
 * background reader. The `git` on `PATH` here is a wrapper that records the
 * variable each run was given and then runs the real one.
 */

let made: string[] = [];
const path = process.env.PATH;
afterEach(() => {
  process.env.PATH = path;
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();

/** A repository with one tracked file whose stat no longer matches the index. */
const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-branch-locks-'));
  made.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  // Same content, a new mtime: what makes `git status` want to refresh the index.
  const later = new Date(Date.now() + 5000);
  utimesSync(join(dir, 'tracked.txt'), later, later);
  return dir;
};

/** A `git` first on `PATH` that logs `GIT_OPTIONAL_LOCKS` per run, and the log it writes. */
const recording = (): string => {
  const bin = mkdtempSync(join(tmpdir(), 'ahpd-branch-locks-bin-'));
  made.push(bin);
  const real = execFileSync('sh', ['-c', 'command -v git']).toString().trim();
  const log = join(bin, 'runs.log');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "\${GIT_OPTIONAL_LOCKS:-unset} $*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  process.env.PATH = `${bin}:${path ?? ''}`;
  return log;
};

it('runs every git read of a directory with GIT_OPTIONAL_LOCKS=0', async () => {
  const dir = repository();
  const log = recording();

  await gitBranches().refresh?.(dir);

  const runs = readFileSync(log, 'utf8').trim().split('\n').filter((one) => one !== '');
  expect(runs.some((one) => one.includes(' status '))).toBe(true);
  expect(runs.filter((one) => !one.startsWith('0 '))).toEqual([]);
});

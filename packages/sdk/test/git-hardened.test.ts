import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { gitChanges } from '../src/changes.js';
import { gitBranches } from '../src/repo/git.js';
import { gitArgv } from '../src/repo/hardened.js';
import { gitWorktrees } from '../src/repo/worktrees.js';

/*
 * Every git this host runs turns off what a repository's own files could make
 * it run: the fsmonitor a config names, and a recursion into submodules whose
 * config an agent may have written inside a worktree.
 */

let root: string;
let log: string;
const before = { path: process.env.PATH, log: process.env.AHPD_FAKE_GIT_LOG };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-hardened-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  log = join(root, 'calls');
  // A `git` that records each argv on one line and answers nothing.
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$AHPD_FAKE_GIT_LOG"\nexit 0\n');
  chmodSync(join(bin, 'git'), 0o755);
  process.env.PATH = `${bin}:${before.path ?? ''}`;
  process.env.AHPD_FAKE_GIT_LOG = log;
});

afterEach(() => {
  process.env.PATH = before.path;
  if (before.log === undefined) delete process.env.AHPD_FAKE_GIT_LOG;
  else process.env.AHPD_FAKE_GIT_LOG = before.log;
  rmSync(root, { recursive: true, force: true });
});

const calls = (): string[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((one) => one !== '') : []);
const HARDENED = '-c core.fsmonitor= -c submodule.recurse=false';

it('spells the flags before the folder, and --ignore-submodules after a subcommand that takes it', () => {
  expect(gitArgv('/r', ['status', '--porcelain'])).toEqual([
    '-c', 'core.fsmonitor=', '-c', 'submodule.recurse=false', '-C', '/r', 'status', '--ignore-submodules', '--porcelain',
  ]);
  expect(gitArgv('/r', ['-c', 'core.excludesFile=/x', 'diff', '--cached'])).toEqual([
    '-c', 'core.fsmonitor=', '-c', 'submodule.recurse=false', '-C', '/r', '-c', 'core.excludesFile=/x', 'diff', '--ignore-submodules', '--cached',
  ]);
  expect(gitArgv('/r', ['rev-parse', 'HEAD'])).toEqual([
    '-c', 'core.fsmonitor=', '-c', 'submodule.recurse=false', '-C', '/r', 'rev-parse', 'HEAD',
  ]);
});

it('runs the worktree port\'s git hardened', async () => {
  await gitWorktrees().dirty(root);
  expect(calls()).toEqual([`${HARDENED} -C ${root} status --ignore-submodules --porcelain`]);
});

it('runs the changes source\'s git hardened', async () => {
  await gitChanges().refresh?.(root);
  const said = calls();
  expect(said.length).toBeGreaterThan(0);
  expect(said.every((one) => one.startsWith(`${HARDENED} -C ${root} `))).toBe(true);
  expect(said.find((one) => one.includes(' status '))).toContain('status --ignore-submodules');
});

it('runs the branch facts\' git hardened', async () => {
  await gitBranches().refresh?.(root);
  const said = calls();
  expect(said.length).toBeGreaterThan(0);
  expect(said.every((one) => one.startsWith(`${HARDENED} -C ${root} `))).toBe(true);
});

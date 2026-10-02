/*
 * The usage store a daemon keeps by default, and the one a plugin may replace.
 *
 * As a process, because what is under test is one line of `runForeground` and
 * the only thing that can see it from outside is the folder it makes and the
 * problems the fold reports. The configuration directory is a temporary one, so
 * what a case checks is a folder this case created.
 *
 * Nothing records to the store yet, so the daemon's own is proved by the folder
 * beside the sessions and the automations rather than by what is in it.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = join(import.meta.dirname, 'fixtures', 'plugin-echo');
/** A plugin that contributes a usage store instead of the daemon's. */
const USAGE = join(import.meta.dirname, 'fixtures', 'plugin-usage');

interface Said {
  code: number | null;
  stdout: string;
  stderr: string;
}

let home: string;
let config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-usage-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'config.json');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/**
 * A daemon over stdio, given the plugins the case names, and what it said.
 *
 * Its end of the pipe is closed at once: a stdio host serves until the client
 * goes away, and the case is what the daemon did before it left, not the socket
 * it would then hold open.
 */
const cli = (plugins: PluginSpec[]): Promise<Said> => {
  writeFileSync(config, `${JSON.stringify({ plugins })}\n`);
  const child = spawn(
    process.execPath,
    [MAIN, '--stdio', '--config-file', config, '--no-update-check'],
    {
      cwd: REPO,
      env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  return new Promise((done) => {
    const timer = setTimeout(() => { child.kill(); }, 15000);
    child.on('exit', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
};

/** The folder the daemon keeps usage in, beside the sessions and the automations. */
const usageFolder = (): string => join(home, 'ahpd', 'usage');

it('keeps usage in a folder of its own, beside the sessions and the automations', async () => {
  const said = await cli([BACKEND]);

  expect(said.code).toBe(0);
  expect(said.stderr).not.toContain('already set');
  // Made at startup rather than at the first record, so a path that cannot be
  // written is said while the log is still being read and not mid-turn.
  expect(existsSync(usageFolder())).toBe(true);
  expect(statSync(usageFolder()).isDirectory()).toBe(true);
  // The same data folder the other stores use, and not a directory of its own
  // beside it.
  expect(existsSync(join(home, 'ahpd', 'sessions.json'))).toBe(false);
  expect(existsSync(join(home, 'ahpd'))).toBe(true);
});

it('tells a plugin that its usage store was not wanted, and lets one take the port over', async () => {
  const refused = await cli([BACKEND, USAGE]);
  expect(refused.stderr).toContain('plugin usage-store sets usage, which the daemon already set');
  expect(refused.stderr).toContain("pass 'replace' to take it over");
  // The daemon's own store is what the host keeps, so the folder is still there.
  expect(existsSync(usageFolder())).toBe(true);

  const taken = await cli([BACKEND, { name: USAGE, options: { replace: true } }]);
  expect(taken.code).toBe(0);
  // The same plugin with 'replace', which is the whole difference between a
  // port the daemon keeps and a port a plugin has taken.
  expect(taken.stderr).not.toContain('already set');
  expect(taken.stderr).toContain('plugin usage-store');
});

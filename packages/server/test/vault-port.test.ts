/*
 * The vault a daemon keeps by default, and the one a plugin may replace.
 *
 * As a process, for the reason `usage-port.test.ts` is one: what is under test
 * is the wiring in `runForeground`, and the only things that can see it from
 * outside are the line the daemon said and what a plugin read.
 *
 * The secret is written into `vault.json` before the run rather than through
 * `ahpd vault`, which is `vault-command.test.ts`'s. Nothing is read at start
 * either: the store reads the file on each call, so a file written before the
 * daemon is the one every read is answered from.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = join(import.meta.dirname, 'fixtures', 'plugin-echo');
/** A plugin that contributes a vault instead of the daemon's. */
const VAULT = join(import.meta.dirname, 'fixtures', 'plugin-vault');
/** A plugin that reads one secret through `host.secret`. */
const READER = join(import.meta.dirname, 'fixtures', 'plugin-secret-reader');

interface Said {
  code: number | null;
  stdout: string;
  stderr: string;
}

let home: string;
let config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-vault-port-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'config.json');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** A daemon over stdio, given the plugins the case names, and what it said. */
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

/** What the daemon keeps its secrets in, beside the configuration. */
const vaultFile = (): string => join(home, 'ahpd', 'vault.json');

it('says where the vault is, and answers a secret a plugin read from the file', async () => {
  writeFileSync(vaultFile(), JSON.stringify({ version: 1, secrets: { 'host:probe': 'from the file' } }));
  const said = await cli([BACKEND, READER]);

  expect(said.code).toBe(0);
  // Its own line, so where a value lives is the first thing asked of a host
  // nobody trusts yet.
  expect(said.stderr).toContain(`vault ${vaultFile()}\n`);
  expect(said.stderr).toContain('secret probe from the file');
});

it('says a plugin took the vault over, and hands its secret to the plugins after it', async () => {
  const refused = await cli([BACKEND, READER, VAULT]);
  expect(refused.stderr).toContain('plugin vault-store sets vault, which the daemon already set');
  expect(refused.stderr).toContain("pass 'replace' to take it over");

  // Listed first, because a vault that loads after the plugin reading a secret
  // is not the one that plugin was resolved against.
  const taken = await cli([BACKEND, { name: VAULT, options: { replace: true } }, READER]);
  expect(taken.code).toBe(0);
  expect(taken.stderr).not.toContain('already set');
  expect(taken.stderr).toContain(`vault from a plugin\n`);
  expect(taken.stderr).toContain('secret probe from the plugin');
  expect(taken.stderr).not.toContain('from the file');
});
/*
 * The declarations themselves, checked before anything runs them.
 *
 * `pnpm test` runs this without a terminal or a daemon: what it asks is whether
 * the registry the program is built from is complete - every command valid,
 * every flag a run takes declared, and every command saying which grant it
 * needs. Building the registry validates each declaration, so an invalid one
 * fails here. A configuration file in a temporary directory is the one the
 * cases that run a command read, so none of them reads the configuration of
 * whoever runs the suite.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizeRequest } from '@cofold/commands';
import { cliRegistry } from '../src/commands/registry.js';
import { checkScopes } from '../src/commands/scopes.js';

const registry = cliRegistry();

let root: string;
let config: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-commands-'));
  config = join(root, 'config.json');
  writeFileSync(config, '{}\n');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** Every flag the pinning cases pin, which `ahpd start` has to declare. */
const DAEMON_FLAGS = [
  '--port', '--host', '--stdio', '--path', '--connection-token',
  '--connection-token-file', '--without-connection-token', '--config-file',
  '--users', '--resource', '--issuer', '--trust-token', '--advanced-tools',
  '--automations', '--sessions', '--wire', '--plugin', '--no-plugins',
  '--no-update-check',
];

describe('the command registry', () => {
  it('validates every command and every need', () => {
    expect(() => registry.verify()).not.toThrow();
  });

  it('gives start every daemon flag, spelled as it always was', () => {
    const start = registry.find('daemon.start');
    expect(start).toBeDefined();
    const options = start?.options ?? [];
    const names = new Set(options.map((option) => option.name));
    expect(DAEMON_FLAGS.filter((name) => !names.has(name))).toEqual([]);
    // The two repeatable ones collect rather than overwrite.
    const repeatable = new Set(options.filter((option) => option.repeatable === true).map((option) => option.name));
    expect([...repeatable].sort()).toEqual(['--path', '--plugin']);
  });

  it('says which grant each command needs', () => {
    const scopes = (id: string): readonly string[] => registry.find(id)?.scopes ?? [];
    expect(scopes('daemon.status')).toEqual(['config:read']);
    expect(scopes('plugin.list')).toEqual(['config:read']);
    expect(scopes('daemon.config')).toEqual(['config:write']);
    expect(scopes('plugin.install')).toEqual(['config:write']);
    expect(scopes('plugin.remove')).toEqual(['config:write']);
    for (const id of ['user.list', 'user.add', 'user.rm', 'user.token']) {
      expect(scopes(id)).toEqual(['users:write']);
    }
  });

  it('checks a command scopes in the hook, on the remote surface', async () => {
    const command = registry.find('daemon.config');
    expect(command).toBeDefined();
    const caller = { id: 'ada', roles: ['member'], can: () => false };
    await expect(registry.execute(command!, {
      surface: 'remote',
      input: { configFile: config },
      request: { actor: caller },
    })).rejects.toThrow('ada may not config:write here');
  });

  it('refuses a remote request that carries no actor', () => {
    const command = registry.find('daemon.status');
    expect(command).toBeDefined();
    expect(() => checkScopes({
      command: command!,
      scopes: ['config:read'],
      context: { surface: 'remote' },
    } as unknown as AuthorizeRequest)).toThrow('Sign in to use this host');
  });

  it('lets a remote caller holding the grant through the hook', async () => {
    const command = registry.find('daemon.config');
    expect(command).toBeDefined();
    const caller = { id: 'root', roles: ['admin'], can: () => true };
    const answer = await registry.execute(command!, {
      surface: 'remote',
      input: { configFile: config },
      request: { actor: caller },
    });
    expect(answer).not.toBeNull();
  });
});

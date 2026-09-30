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
import { createRegistry } from '@cofold/commands';
import type { AuthorizeRequest } from '@cofold/commands';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { checkScopes } from '../src/commands/scopes.js';
import { declareUser } from '../src/commands/user.js';

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
  '--update-check', '--plugin-option',
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
    expect([...repeatable].sort()).toEqual(['--path', '--plugin', '--plugin-option']);
  });

  it('says which grant each command needs', () => {
    const scopes = (id: string): readonly string[] => registry.find(id)?.scopes ?? [];
    expect(scopes('daemon.status')).toEqual(['config:read']);
    expect(scopes('plugin.list')).toEqual(['config:read']);
    expect(scopes('daemon.config')).toEqual(['config:write']);
    expect(scopes('plugin.install')).toEqual(['config:write']);
    expect(scopes('plugin.remove')).toEqual(['config:write']);
    expect(scopes('plugin.update')).toEqual(['config:write']);
    expect(scopes('daemon.restart')).toEqual(['config:write']);
    const only = (id: string): string | undefined => registry.find(id)?.meta?.deploymentTokenOnly;
    for (const id of ['plugin.install', 'plugin.remove']) expect(only(id)).toBe('install or remove a plugin');
    expect(only('plugin.update')).toBe('update a plugin');
    for (const id of ['plugin.config', 'plugin.config.set']) expect(only(id)).toBe("change a plugin's options");
    for (const id of ['plugin.enable', 'plugin.disable']) expect(only(id)).toBe('enable or disable a plugin');
    expect(only('daemon.restart')).toBe('restart the daemon');
    for (const id of ['plugin.config', 'plugin.config.set', 'plugin.enable', 'plugin.disable']) {
      expect(scopes(id)).toEqual(['config:write']);
    }
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

  it('refuses a served user add with no actor, whatever the hook let through', async () => {
    const bare = createRegistry({ authorize: () => undefined });
    declareUser(bare);
    const command = bare.find('user.add');
    expect(command).toBeDefined();
    const users = join(root, 'users.json');
    await expect(bare.execute(command!, {
      surface: 'remote',
      input: { users, id: 'eve' },
    })).rejects.toMatchObject({ status: 401 });
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

describe('the update check', () => {
  it('is on unless the input or the file turns it off', () => {
    expect(optionsFrom({ configFile: config, updateCheck: false }).updateCheck).toBe(false);
    expect(optionsFrom({ configFile: config, updateCheck: true }).updateCheck).toBe(true);
    expect(optionsFrom({ configFile: config }).updateCheck).toBe(true);
  });
});

describe('--plugin-option', () => {
  const plugins = (input: Record<string, unknown>) => optionsFrom({ configFile: config, ...input }).plugins;

  it('merges over the file\'s options for that plugin, one flag per option', () => {
    writeFileSync(config, JSON.stringify({ plugins: [{ name: 'a', options: { x: 1, y: 2 } }, 'b'] }));
    expect(plugins({ pluginOptions: ['a.y=3', 'a.z=x'] })).toEqual([{ name: 'a', options: { x: 1, y: 3, z: 'x' } }, 'b']);
  });

  it('reads the value as JSON when it parses and as text otherwise', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(plugins({ pluginOptions: ['a.n=1', 'a.s=x', 'a.b=true', 'a.o={"k":[1]}', 'a.e=x=y'] }))
      .toEqual([{ name: 'a', options: { n: 1, s: 'x', b: true, o: { k: [1] }, e: 'x=y' } }]);
  });

  it('keeps a number only when it reads back as typed, and a JSON string as text', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(plugins({ pluginOptions: ['a.id=12345678901234567890', 'a.f=1.0', 'a.n=42', 'a.x=-1.5', 'a.s="123"'] }))
      .toEqual([{ name: 'a', options: { id: '12345678901234567890', f: '1.0', n: 42, x: -1.5, s: '123' } }]);
  });

  it('refuses a JSON value holding a number that would not read back as typed, and says to quote it', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(() => plugins({ pluginOptions: ['a.ids={"id":12345678901234567890}'] }))
      .toThrow('{"id":12345678901234567890} holds 12345678901234567890, which would be kept as 12345678901234567000; write it in quotes, as a JSON string.');
    expect(() => plugins({ pluginOptions: ['a.ids=[1,[9007199254740993]]'] })).toThrow('holds 9007199254740993, which would be kept as 9007199254740992');
    expect(() => plugins({ pluginOptions: ['a.f={"a":1.0}'] })).toThrow('{"a":1.0} holds 1.0, which would be kept as 1;');
    expect(() => plugins({ pluginOptions: ['a.f={"a":1e21}'] })).toThrow('holds 1e21, which would be kept as 1e+21;');
    expect(() => plugins({ pluginOptions: ['a.f={"a":0.12345678901234567890}'] })).toThrow('holds 0.12345678901234567890, which would be kept as 0.12345678901234568;');
    expect(() => plugins({ pluginOptions: ['a.big={"x":1e400}'] }))
      .toThrow('{"x":1e400} holds 1e400, too large to be a number; write it in quotes, as a JSON string.');
    // What reads back as typed is kept, and digits inside a string are the string's.
    expect(plugins({ pluginOptions: ['a.ids={"id":"12345678901234567890","n":9007199254740992,"x":-1.5,"s":"1.0"}'] }))
      .toEqual([{ name: 'a', options: { ids: { id: '12345678901234567890', n: 9007199254740992, x: -1.5, s: '1.0' } } }]);
  });

  it('splits a scoped name and a path at the last dot before the value', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['@ahpd/agent-claude', './p/index.ts'] }));
    expect(plugins({ pluginOptions: ['@ahpd/agent-claude.workerStop=session', './p/index.ts.mode=fast'] })).toEqual([
      { name: '@ahpd/agent-claude', options: { workerStop: 'session' } },
      { name: './p/index.ts', options: { mode: 'fast' } },
    ]);
  });

  it('sets an option on a plugin named by a typed --plugin', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(plugins({ plugins: ['b'], pluginOptions: ['b.k=true'] })).toEqual([{ name: 'b', options: { k: true } }]);
  });

  it('refuses a plugin this run does not load, naming it', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(() => plugins({ pluginOptions: ['c.k=1'] })).toThrow('--plugin-option names c, which is not a plugin this run loads.');
    expect(() => plugins({ plugins: ['b'], pluginOptions: ['a.k=1'] })).toThrow('--plugin-option names a');
  });

  it('refuses a plugin whose entry is switched off, which this run does not load', () => {
    writeFileSync(config, JSON.stringify({ plugins: [{ name: 'a', enabled: false }, 'b'] }));
    expect(() => plugins({ pluginOptions: ['a.k=1'] })).toThrow('--plugin-option names a, which is not a plugin this run loads.');
    expect(plugins({ pluginOptions: ['b.k=1'] })).toEqual([{ name: 'a', enabled: false }, { name: 'b', options: { k: 1 } }]);
  });

  it('refuses one that is not <plugin>.<key>=<value>', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    for (const bad of ['a.k', 'ak=1', '.k=1', 'a.=1']) {
      expect(() => plugins({ pluginOptions: [bad] })).toThrow(`--plugin-option takes <plugin>.<key>=<value>, not ${bad}`);
    }
  });

  it('is not a key the configuration file may hold', () => {
    writeFileSync(config, JSON.stringify({ pluginOptions: ['a.k=1'] }));
    expect(optionsFrom({ configFile: config }).warnings.join('\n')).toContain('pluginOptions is not a setting ahpd knows');
  });
});

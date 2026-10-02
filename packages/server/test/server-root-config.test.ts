import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { daemonRootConfig } from '../src/rootconfig.js';
import { loadPlugins } from '../src/plugins.js';
import { optionsFrom } from '../src/commands/options.js';
import { echo } from '../../../examples/echo/agent.js';
import type { PluginSpec } from '@ahpd/sdk';
import type { RootConfigPort } from '@ahpd/sdk';

/*
 * The daemon's own settings, as root config carries them.
 *
 * Every case reads and writes a file in a temporary directory, so none of them
 * edits the configuration of whoever runs the suite.
 */

let home: string;
let config: string;
const fixtures = join(import.meta.dirname, './fixtures');
const repo = join(import.meta.dirname, '../../..');
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-root-config-'));
  config = join(home, 'config.json');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** The port for a run that was given this file and these flags. */
const port = (typed: Record<string, unknown> = {}): RootConfigPort => {
  put({ port: 9187, host: '127.0.0.1', paths: ['/from-file'] });
  return daemonRootConfig(optionsFrom({ configFile: config, ...typed }), typed);
};

const put = (value: unknown): void => { writeFileSync(config, JSON.stringify(value)); };
/** The file as it is on disk, read whole so a key the case did not ask about counts. */
const held = (): Record<string, unknown> => JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;

/** The port for a run whose file names these entries and which loaded `load`. */
const withPlugins = async (entries: unknown[], load = entries as PluginSpec[], cwd = import.meta.dirname): Promise<RootConfigPort> => {
  put({ plugins: entries });
  const { problems } = await loadPlugins(load, {
    base: { path: home, agents: [echo({ path: home })] },
    configDir: cwd,
    cwd,
    log: () => {},
  });
  expect(problems).toEqual([]);
  return daemonRootConfig(optionsFrom({ configFile: config }));
};

const SCHEMA = './fixtures/plugin-schema/index.ts';
/** A plugin whose `apiKey` is `writeOnly` and whose `region` is an ordinary option. */
const SECRET = './fixtures/plugin-secret/index.ts';
/** The backend that keeps its credentials in a preset's environment. */
const CLAUDE = './packages/agent-claude/src/index.ts';
/** The backend whose own search providers keep a key of their own. */
const COFOLD = './packages/agent-cofold/src/index.ts';
/** One plugin key's `properties`, as the port declares it. */
const keySchema = (root: RootConfigPort, key: string): Record<string, unknown> =>
  ((root.schema() as { properties: Record<string, { properties: Record<string, unknown> }> }).properties[key] ?? { properties: {} }).properties;

describe('the daemon keys root config carries', () => {
  it('are the seven of them, and none of the others', () => {
    const { schema } = port();
    const properties = (schema() as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).toEqual(['paths', 'port', 'host', 'http', 'updateCheck', 'advancedTools', 'wire']);
    for (const key of ['stdio', 'configFile', 'connectionToken', 'connectionTokenFile', 'trustToken', 'issuer', 'resource', 'users', 'automations', 'sessions']) {
      expect(Object.keys(properties)).not.toContain(key);
    }
  });

  it('say what the file holds, and nothing the file does not', async () => {
    put({ port: 9000, host: '127.0.0.1', paths: ['/from-file'], connectionToken: 'secret' });
    const root = daemonRootConfig(optionsFrom({ configFile: config }), {});
    expect(await root.values()).toEqual({ port: 9000, host: '127.0.0.1', paths: ['/from-file'] });
  });
});

describe('a write to the daemon keys', () => {
  it('changes the file, keeps every other key, and says a restart is needed', async () => {
    const answer = await port().write({ paths: ['/elsewhere'] });
    expect(answer).toEqual({ restartNeeded: true });
    expect(held()).toEqual({ port: 9187, host: '127.0.0.1', paths: ['/elsewhere'] });
  });

  it('takes a key back when the client sends it as a null', async () => {
    await port().write({ host: null });
    expect(held()).toEqual({ port: 9187, paths: ['/from-file'] });
  });

  it('is refused naming the key, and leaves the file as it was', async () => {
    const root = port();
    await expect(root.write({ port: 'x' })).rejects.toThrow(`port must be an integer`);
    expect(held()).toEqual({ port: 9187, host: '127.0.0.1', paths: ['/from-file'] });
  });
});

describe('a key a start flag overrode', () => {
  const saysSo = (key: string): string => {
    const properties = (port({ port: 9000 }).schema() as { properties: Record<string, { description?: string }> }).properties;
    return properties[key]?.description ?? '';
  };

  it('says the file is not what this run uses', () => {
    expect(saysSo('port')).toContain('--port');
  });

  it('says nothing when the flag agrees with the file, or was not typed', () => {
    expect(saysSo('host')).not.toContain('--host');
    expect(saysSo('paths')).not.toContain('--path');
  });
});

describe('each configured plugin as a key', () => {
  it('carries the schema of a plugin that loaded', async () => {
    const root = await withPlugins([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    const key = `plugins.${SCHEMA}`;
    expect(keySchema(root, key)['enabled']).toMatchObject({ type: 'boolean' });
    expect(keySchema(root, key)['options']).toMatchObject({
      type: 'object',
      properties: { command: { type: 'string' }, retries: { type: 'integer', minimum: 0 } },
    });
    expect(await root.values()).toMatchObject({ [key]: { enabled: true, options: { command: 'run', greeting: 'hi' } } });
  });

  it('says a switched-off plugin is off, and holds nothing of its options back', async () => {
    // Never imported, so nothing is known of which of its options are credentials.
    const unchecked = './fixtures/plugin-unchecked/index.ts';
    const root = await withPlugins([{ name: unchecked, enabled: false, options: { anything: 1 } }]);
    const key = `plugins.${unchecked}`;
    expect((await root.values())[key]).toEqual({ enabled: false, options: { anything: '<set>' } });
    expect(keySchema(root, key)['options']).toEqual({});
  });

  it('writes enabled and options into the entry, and says a restart is needed', async () => {
    const root = await withPlugins([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    const answer = await root.write({ [`plugins.${SCHEMA}`]: { options: { command: 'walk', greeting: 'hi' } } });
    expect(answer).toEqual({ restartNeeded: true });
    expect(held().plugins).toEqual([{ name: SCHEMA, options: { command: 'walk', greeting: 'hi' } }]);
  });

  it('turns a string entry into an object one when it is switched off', async () => {
    const root = await withPlugins([SCHEMA], [{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    await root.write({ [`plugins.${SCHEMA}`]: { enabled: false } });
    expect(held().plugins).toEqual([{ name: SCHEMA, enabled: false }]);
  });

  it('leaves a string entry alone when it is switched on, which it already was', async () => {
    const root = await withPlugins([SCHEMA], [{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    await root.write({ [`plugins.${SCHEMA}`]: { enabled: true } });
    expect(held().plugins).toEqual([SCHEMA]);
  });

  it('refuses a value the schema refuses, naming the option, and leaves the file', async () => {
    const root = await withPlugins([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    await expect(root.write({ [`plugins.${SCHEMA}`]: { options: { command: 'run', greeting: 'hi', retries: -1 } } }))
      .rejects.toThrow(`plugins.${SCHEMA}.options.retries must be an integer >= 0`);
    expect(held().plugins).toEqual([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
  });

  it('refuses a write for a plugin the file does not name', async () => {
    const root = await withPlugins([SCHEMA], [{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    await expect(root.write({ 'plugins./fixtures/plugin-hello': { enabled: false } })).rejects.toThrow('not in plugins');
    expect(held().plugins).toEqual([SCHEMA]);
  });

  it('takes one option back and leaves the rest of the entry as it was', async () => {
    const root = await withPlugins([{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }]);
    await root.write({ [`plugins.${SECRET}`]: { options: { region: null } } });
    expect(held().plugins).toEqual([{ name: SECRET, options: { apiKey: 'k-1' } }]);
  });
});

describe('the keys that apply while this daemon runs', () => {
  it('opens the capture a write of wire names, and stops it when the key goes', async () => {
    const at = join(home, 'frames.ndjson');
    const opened: (string | undefined)[] = [];
    put({});
    const root = daemonRootConfig(optionsFrom({ configFile: config }), {}, (where) => { opened.push(where); });
    expect(await root.write({ wire: at })).toEqual({ restartNeeded: false });
    expect(opened).toEqual([at]);
    expect(await root.write({ wire: null })).toEqual({ restartNeeded: false });
    expect(opened).toEqual([at, undefined]);
    expect(held()).toEqual({});
  });

  it('says a restart is needed for a key that cannot apply at once', async () => {
    expect(await port().write({ paths: ['/elsewhere'] })).toEqual({ restartNeeded: true });
    expect(await port().write({ port: 9200 })).toEqual({ restartNeeded: true });
    expect(await port().write({ host: '127.0.0.2' })).toEqual({ restartNeeded: true });
  });

  it('answers no restart for advancedTools, which applies here', async () => {
    expect(await port().write({ advancedTools: true })).toEqual({ restartNeeded: false });
  });
});

describe('a credential in a plugin key', () => {
  it('is answered as set, and any other option as the file holds it', async () => {
    const root = await withPlugins([{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }]);
    expect((await root.values())[`plugins.${SECRET}`]).toEqual({
      enabled: true,
      options: { apiKey: '<set>', region: 'eu' },
    });
  });

  it('is left as it is when a client sends the key back', async () => {
    const root = await withPlugins([{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }]);
    const answer = await root.write({ [`plugins.${SECRET}`]: { options: { apiKey: '<set>', region: 'eu' } } });
    expect(answer).toEqual({ restartNeeded: true });
    expect(held().plugins).toEqual([{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }]);
  });

  it('is replaced when the client sends another value for it', async () => {
    const root = await withPlugins([{ name: SECRET, options: { apiKey: 'k-1' } }]);
    await root.write({ [`plugins.${SECRET}`]: { options: { apiKey: 'k-2' } } });
    expect(held().plugins).toEqual([{ name: SECRET, options: { apiKey: 'k-2' } }]);
  });

  it('is honoured however deep in the plugin options it sits', async () => {
    const root = await withPlugins([{
      name: COFOLD,
      options: { tools: { web: { search: { brave: { apiKey: 'bs-1' }, duckduckgo: true } } } },
    }], undefined, repo);
    expect((await root.values())[`plugins.${COFOLD}`]).toMatchObject({
      options: { tools: { web: { search: { brave: { apiKey: '<set>' }, duckduckgo: true } } } },
    });
  });

  it('is a preset environment value, which is where Claude keeps its key', async () => {
    const root = await withPlugins([{
      name: CLAUDE,
      options: { presets: { default: { env: { ANTHROPIC_API_KEY: 'sk-1', ANTHROPIC_AUTH_TOKEN: 'at-1' }, sandbox: 'on' } } },
    }], undefined, repo);
    const answered = (await root.values())[`plugins.${CLAUDE}`] as { options: { presets: Record<string, unknown> } };
    expect(answered.options.presets['default']).toEqual({
      env: { ANTHROPIC_API_KEY: '<set>', ANTHROPIC_AUTH_TOKEN: '<set>' },
      sandbox: 'on',
    });
  });

  it('is left as it is when a client sends a whole preset back', async () => {
    const options = { presets: { default: { env: { ANTHROPIC_API_KEY: 'sk-1' }, sandbox: 'on' } } };
    const root = await withPlugins([{ name: CLAUDE, options }], undefined, repo);
    const answer = await root.write({ [`plugins.${CLAUDE}`]: { options: { presets: { default: { env: { ANTHROPIC_API_KEY: '<set>' }, sandbox: 'off' } } } } });
    expect(answer).toEqual({ restartNeeded: true });
    expect(held().plugins).toEqual([{ name: CLAUDE, options: { presets: { default: { env: { ANTHROPIC_API_KEY: 'sk-1' }, sandbox: 'off' } } } }]);
  });
});

describe('one plugin loaded twice', () => {
  const twice = async (): Promise<RootConfigPort> => await withPlugins([
    { name: CLAUDE, options: { provider: 'claude', displayName: 'Claude Code' } },
    { name: CLAUDE, options: { provider: 'openrouter', displayName: 'OpenRouter' } },
  ], undefined, repo);

  it('is one key per entry, each carrying its own provider', async () => {
    const values = await (await twice()).values() as Record<string, { options: Record<string, unknown> }>;
    expect(Object.keys(values)).toEqual([`plugins.${CLAUDE}#claude`, `plugins.${CLAUDE}#openrouter`]);
    expect(values[`plugins.${CLAUDE}#claude`]?.options).toEqual({ provider: 'claude', displayName: 'Claude Code' });
    expect(values[`plugins.${CLAUDE}#openrouter`]?.options).toEqual({ provider: 'openrouter', displayName: 'OpenRouter' });
  });

  it('is a write to each key that edits its own entry and no other', async () => {
    const root = await twice();
    await root.write({ [`plugins.${CLAUDE}#openrouter`]: { options: { displayName: 'Router' } } });
    expect(held().plugins).toEqual([
      { name: CLAUDE, options: { provider: 'claude', displayName: 'Claude Code' } },
      { name: CLAUDE, options: { provider: 'openrouter', displayName: 'Router' } },
    ]);
  });

  it('is refused by key when no entry holds that one', async () => {
    const root = await twice();
    await expect(root.write({ [`plugins.${CLAUDE}#gemini`]: { enabled: false } }))
      .rejects.toThrow(`plugins.${CLAUDE}#gemini is not in plugins`);
  });
});
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { daemonRootConfig } from '../src/rootconfig.js';
import { loadPlugins, optionsSchemaLoaded, pluginIdOf } from '../src/plugins.js';
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
/** A plugin whose options carry item bounds, on an array and on a string. */
const BOUNDED = './fixtures/plugin-bounded/index.ts';
/** A plugin that keeps the host it was handed and the schema it exported. */
const AFTER = './fixtures/plugin-after/index.ts';
/** The backend that keeps its credentials in a preset's environment. */
const CLAUDE = './packages/agent-claude/src/index.ts';
/** The backend whose own search providers keep a key of their own. */
const COFOLD = './packages/agent-cofold/src/index.ts';
/** One plugin key's `properties`, as the port declares it. */
const keySchema = (root: RootConfigPort, key: string): Record<string, unknown> =>
  ((root.schema() as { properties: Record<string, { properties: Record<string, unknown> }> }).properties[key] ?? { properties: {} }).properties;

describe('the daemon keys root config carries', () => {
  it('are the twenty-one of them, and none of the others', () => {
    const { schema } = port();
    const properties = (schema() as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).toEqual(['paths', 'port', 'host', 'httpApi', 'routes', 'modelProxy', 'updateCheck', 'advancedTools', 'sessionTools', 'sessionToolsProviders', 'closedChats', 'unofferedModel', 'workspacelessFolder', 'rootOwner', 'turnSenders', 'backendBackgroundWork', 'agentOrchestrationLimitsScope', 'archiveDirtyWorktree', 'pullRequestLookup', 'wire', 'mcpServers']);
    for (const key of ['stdio', 'configFile', 'connectionToken', 'connectionTokenFile', 'requireIssuer', 'issuer', 'resource', 'users', 'automations', 'sessions']) {
      expect(Object.keys(properties)).not.toContain(key);
    }
  });

  it('say what the file holds, and nothing the file does not', async () => {
    put({ port: 9000, host: '127.0.0.1', paths: ['/from-file'], connectionToken: 'secret' });
    const root = daemonRootConfig(optionsFrom({ configFile: config }), {});
    expect(await root.values()).toEqual({ port: 9000, host: '127.0.0.1', paths: ['/from-file'] });
  });
});

describe('the schema a client reads', () => {
  const properties = (): Record<string, Record<string, unknown>> =>
    (port().schema() as { properties: Record<string, Record<string, unknown>> }).properties;

  it('gives every daemon key one of the five types and a title of its own', () => {
    const written = properties();
    for (const [key, property] of Object.entries(written)) {
      expect(property['title']).toEqual(expect.any(String));
      expect(property['title']).not.toBe(key);
    }
    expect(written['port']).toMatchObject({ type: 'number', title: 'Port' });
    expect(written['host']).toMatchObject({ type: 'string', title: 'Bind address' });
    expect(written['paths']).toMatchObject({ type: 'array', title: 'Folders', items: { type: 'string', title: 'Folder' } });
    expect(written['updateCheck']).toMatchObject({ type: 'boolean', title: 'Update check' });
    expect(written['advancedTools']).toMatchObject({ type: 'boolean', title: 'Advanced tools' });
    // Two keys, because one key cannot be both a boolean and a list: the
    // switch is a control, and the providers it narrows to are a list. Neither
    // declares a default, for the same reason `advancedTools` does not: a
    // default on the field would fill the input before the file was read.
    expect(written['sessionTools']).toMatchObject({ type: 'boolean', title: 'Session tools' });
    expect(written['sessionTools']).not.toHaveProperty('default');
    expect(written['sessionToolsProviders']).toMatchObject({ type: 'array', title: 'Session tool providers', items: { type: 'string', title: 'Provider' } });
    expect(written['sessionToolsProviders']).not.toHaveProperty('default');
    expect(written['closedChats']).toMatchObject({ type: 'string', title: 'Closed Chats', enum: ['hidden', 'delete'] });
    expect(written['archiveDirtyWorktree']).toMatchObject({ type: 'string', enum: ['keep', 'commit'] });
    expect(written['pullRequestLookup']).toMatchObject({ type: 'string', enum: ['url', 'branch'] });
    expect(written['wire']).toMatchObject({ type: 'string', title: 'Wire capture' });
    expect(written['mcpServers']).toMatchObject({ type: 'object', title: 'MCP servers' });
  });

  it('gives httpApi one type, its two settings, and their descriptions with their bounds as words', () => {
    expect(properties()['httpApi']).toMatchObject({
      type: 'object',
      title: 'HTTP API',
      properties: {
        port: { type: 'number', title: 'Port', description: "The port of the API's own listener. Absent serves the API on the daemon's port. Between 0 and 65535." },
        host: { type: 'string', title: 'Host', description: "The address the API's own listener binds. Needs a port. Has no spaces." },
      },
    });
  });

  it('names a property by its key, and takes an unnamed level from the schema above it', async () => {
    const root = await withPlugins([{ name: SECRET, options: { region: 'eu' } }]);
    const options = keySchema(root, `plugins.${pluginIdOf(SECRET)}`)['options'] as { title?: string; properties: Record<string, Record<string, unknown>> };
    expect(options.title).toBe('Options');
    expect(options.properties['apiKey']).toMatchObject({ type: 'string', title: 'Api Key' });
    expect(options.properties['region']).toMatchObject({ type: 'string', title: 'Region' });
  });

  it('folds a lone bound into the description, and drops the keyword', async () => {
    const root = await withPlugins([{ name: SECRET, options: { region: 'eu' } }]);
    const options = keySchema(root, `plugins.${pluginIdOf(SECRET)}`)['options'] as { properties: Record<string, Record<string, unknown>> };
    expect(options.properties['retries']).toEqual({ type: 'number', title: 'Retries', description: 'At least 0.' });
  });

  it('keeps the item bounds of an array and drops them from a string', async () => {
    const root = await withPlugins([{ name: BOUNDED, options: {} }]);
    const options = keySchema(root, `plugins.${pluginIdOf(BOUNDED)}`)['options'] as { properties: Record<string, Record<string, unknown>> };
    expect(options.properties['paths']).toMatchObject({ type: 'array', title: 'Paths', minItems: 1, maxItems: 4 });
    expect(options.properties['label']).toEqual({ type: 'string', title: 'Label' });
  });
});

describe('the httpApi key', () => {
  it('is one type, and a stored true is answered as the object it stands for', async () => {
    put({ httpApi: true });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    expect(await root.values()).toEqual({ httpApi: {} });
    // Nobody wrote, so the file still holds what it held.
    expect(held()).toEqual({ httpApi: true });
  });

  it('answers no httpApi at all for a stored false', async () => {
    put({ httpApi: false });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    expect(await root.values()).toEqual({});
  });

  it('stores the object a client writes, and takes the key back for a null', async () => {
    put({ httpApi: true });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    expect(await root.write({ httpApi: { port: 8081 } })).toEqual({ restartNeeded: true });
    expect(held()).toEqual({ httpApi: { port: 8081 } });
    await root.write({ httpApi: null });
    expect(held()).toEqual({});
  });

  it('is still checked against the file\'s own schema, bound and all', async () => {
    const root = port();
    await expect(root.write({ httpApi: { port: 70000 } })).rejects.toThrow('httpApi.port must be an integer');
    expect(held()).toEqual({ port: 9187, host: '127.0.0.1', paths: ['/from-file'] });
  });

  it('answers an old name under the new one, and a write removes the old name', async () => {
    put({ http: true });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    expect(await root.values()).toEqual({ httpApi: {} });
    await root.write({ httpApi: { port: 8081 } });
    expect(held()).toEqual({ httpApi: { port: 8081 } });
  });

  it('takes the old name back with the key when the client sends a null', async () => {
    put({ http: true });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    await root.write({ httpApi: null });
    expect(held()).toEqual({});
  });
});

describe('the modelProxy key', () => {
  it('answers the model proxy the file holds, under its new name', async () => {
    put({ modelProxy: { sessionCalls: 'skip' } });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    expect(await root.values()).toEqual({ modelProxy: { sessionCalls: 'skip' } });
  });

  it('answers an old name under the new one, and a write removes the old name', async () => {
    put({ proxy: { sessionCalls: 'skip' } });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    expect(await root.values()).toEqual({ modelProxy: { sessionCalls: 'skip' } });
    expect(await root.write({ modelProxy: { sessionCalls: 'record' } })).toEqual({ restartNeeded: true });
    expect(held()).toEqual({ modelProxy: { sessionCalls: 'record' } });
  });

  it('takes the old name back with the key when the client sends a null', async () => {
    put({ proxy: { sessionCalls: 'skip' } });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    await root.write({ modelProxy: null });
    expect(held()).toEqual({});
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
    const key = `plugins.${pluginIdOf(SCHEMA)}`;
    expect(keySchema(root, key)['enabled']).toMatchObject({ type: 'boolean' });
    expect(keySchema(root, key)['options']).toMatchObject({
      type: 'object',
      title: 'Options',
      properties: { command: { type: 'string', title: 'Command' }, retries: { type: 'number', title: 'Retries', description: 'At least 0.' } },
    });
    expect(await root.values()).toMatchObject({ [key]: { enabled: true, options: { command: 'run', greeting: 'hi' } } });
  });

  it('says a switched-off plugin is off, and holds nothing of its options back', async () => {
    // Never imported, so nothing is known of which of its options are credentials.
    const unchecked = './fixtures/plugin-unchecked/index.ts';
    const root = await withPlugins([{ name: unchecked, enabled: false, options: { anything: 1 } }]);
    const key = `plugins.${pluginIdOf(unchecked)}`;
    expect((await root.values())[key]).toEqual({ enabled: false, options: { anything: '<set>' } });
    // Nothing is known of its options, so the schema says only that they are
    // an object, which is a shape a client can draw and no promise about keys.
    expect(keySchema(root, key)['options']).toEqual({ type: 'object', title: 'Options' });
  });

  it('writes enabled and options into the entry, and says a restart is needed', async () => {
    const root = await withPlugins([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    const answer = await root.write({ [`plugins.${pluginIdOf(SCHEMA)}`]: { options: { command: 'walk', greeting: 'hi' } } });
    expect(answer).toEqual({ restartNeeded: true });
    expect(held().plugins).toEqual([{ source: SCHEMA, options: { command: 'walk', greeting: 'hi' } }]);
  });

  it('is keyed by the plugin id, not by the path that loads it', async () => {
    const root = await withPlugins([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    expect(Object.keys(await root.values())).toEqual(['plugins.schema']);
  });

  it('edits the entry its key names when an entry before it is not a plugin', async () => {
    const root = await withPlugins([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    put({ plugins: [42, { name: SCHEMA, options: { command: 'run', greeting: 'hi' } }] });
    await expect(root.write({ [`plugins.${pluginIdOf(SCHEMA)}`]: { options: { command: 'walk' } } })).rejects.toThrow();
    expect(held().plugins).toEqual([42, { name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
  });

  it('turns a string entry into an object one when it is switched off', async () => {
    const root = await withPlugins([SCHEMA], [{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    await root.write({ [`plugins.${pluginIdOf(SCHEMA)}`]: { enabled: false } });
    expect(held().plugins).toEqual([{ source: SCHEMA, enabled: false }]);
  });

  it('leaves a string entry alone when it is switched on, which it already was', async () => {
    const root = await withPlugins([SCHEMA], [{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    await root.write({ [`plugins.${pluginIdOf(SCHEMA)}`]: { enabled: true } });
    expect(held().plugins).toEqual([SCHEMA]);
  });

  it('refuses a value the schema refuses, naming the option, and leaves the file', async () => {
    const root = await withPlugins([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    await expect(root.write({ [`plugins.${pluginIdOf(SCHEMA)}`]: { options: { command: 'run', greeting: 'hi', retries: -1 } } }))
      .rejects.toThrow(`plugins.${pluginIdOf(SCHEMA)}.options.retries must be an integer >= 0`);
    expect(held().plugins).toEqual([{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
  });

  it('keeps a reference written for a string option, and refuses a name that is not one', async () => {
    // The reference is a name and not a value, so it is held to the name rule
    // rather than to the option's schema: what it resolves to is read when the
    // plugin loads, and not here.
    const root = await withPlugins([{ name: SECRET, options: { region: 'eu' } }]);
    await root.write({ [`plugins.${pluginIdOf(SECRET)}`]: { options: { apiKey: { $secret: 'host:orders' } } } });
    expect(held().plugins).toEqual([{ source: SECRET, options: { region: 'eu', apiKey: { $secret: 'host:orders' } } }]);
    // And it answers as written, so a client editing the entry can see the name
    // it is pointing at rather than a mask.
    expect((await root.values())[`plugins.${pluginIdOf(SECRET)}`]).toMatchObject({ options: { apiKey: { $secret: 'host:orders' } } });

    await expect(root.write({ [`plugins.${pluginIdOf(SECRET)}`]: { options: { apiKey: { $secret: 'x' } } } }))
      .rejects.toThrow('x is not a secret name');
    expect(held().plugins).toEqual([{ source: SECRET, options: { region: 'eu', apiKey: { $secret: 'host:orders' } } }]);
  });

  it('refuses a write for a plugin the file does not name', async () => {
    const root = await withPlugins([SCHEMA], [{ name: SCHEMA, options: { command: 'run', greeting: 'hi' } }]);
    await expect(root.write({ 'plugins./fixtures/plugin-hello': { enabled: false } })).rejects.toThrow('not in plugins');
    expect(held().plugins).toEqual([SCHEMA]);
  });

  it('takes one option back and leaves the rest of the entry as it was', async () => {
    const root = await withPlugins([{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }]);
    await root.write({ [`plugins.${pluginIdOf(SECRET)}`]: { options: { region: null } } });
    expect(held().plugins).toEqual([{ source: SECRET, options: { apiKey: 'k-1' } }]);
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

  it('answers no restart for the tool keys, closedChats, archiveDirtyWorktree and pullRequestLookup, which apply here', async () => {
    expect(await port().write({ advancedTools: true })).toEqual({ restartNeeded: false });
    expect(await port().write({ sessionTools: false })).toEqual({ restartNeeded: false });
    expect(await port().write({ sessionToolsProviders: ['claude'] })).toEqual({ restartNeeded: false });
    expect(await port().write({ closedChats: 'delete' })).toEqual({ restartNeeded: false });
    expect(await port().write({ archiveDirtyWorktree: 'commit' })).toEqual({ restartNeeded: false });
    expect(await port().write({ pullRequestLookup: 'branch' })).toEqual({ restartNeeded: false });
  });
});

describe('the mcpServers key', () => {
  const SERVERS = {
    search: { type: 'stdio', command: 'mcp-search', args: ['--stdio'], env: { KEY: 'k-1' } },
    notes: { type: 'http', url: 'https://notes.test/mcp', headers: { Authorization: 'Bearer t-1' } },
  };
  const withServers = (servers: unknown = SERVERS): RootConfigPort => {
    put({ mcpServers: servers });
    return daemonRootConfig(optionsFrom({ configFile: config }));
  };

  it('answers what the file holds, with an env and a header as set', async () => {
    expect((await withServers().values()).mcpServers).toEqual({
      search: { type: 'stdio', command: 'mcp-search', args: ['--stdio'], env: { KEY: '<set>' } },
      notes: { type: 'http', url: 'https://notes.test/mcp', headers: { Authorization: '<set>' } },
    });
  });

  it('writes a server, says no restart, and leaves a credential that was sent back', async () => {
    const root = withServers();
    const answer = await root.write({ mcpServers: { search: { type: 'stdio', command: 'mcp-search', env: { KEY: '<set>' } }, new: { type: 'http', url: 'https://new.test' } } });
    expect(answer).toEqual({ restartNeeded: false });
    // The env was sent back as it was answered, which says leave it as it was.
    expect((held().mcpServers as Record<string, { env?: Record<string, string> }>).search?.env).toEqual({ KEY: 'k-1' });
    expect(held().mcpServers).toHaveProperty('new');
  });

  // rootConfigWrite replaced: the protocol's reducer replaces each top-level
  // key's value whole (types/channels-root/reducer.ts L26-L36 at spec v1.0.0).
  it('writes the servers sent in place of the map under rootConfigWrite replaced, a <set> taken out with its credential', async () => {
    put({ mcpServers: SERVERS, rootConfigWrite: 'replaced' });
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    await root.write({ mcpServers: { search: { type: 'stdio', command: 'mcp-search', env: { KEY: '<set>' } } } });
    expect(held().mcpServers).toEqual({ search: { type: 'stdio', command: 'mcp-search' } });
  });

  it('hands the written servers, credentials included, to the next session', async () => {
    put({ mcpServers: SERVERS });
    let next: unknown;
    const root = daemonRootConfig(optionsFrom({ configFile: config }), {}, () => {}, (servers) => { next = servers; });
    await root.write({ mcpServers: { search: { type: 'stdio', command: 'mcp-search', env: { KEY: '<set>' } } } });
    expect((next as Record<string, { env?: Record<string, string> }>).search?.env).toEqual({ KEY: 'k-1' });
    expect(next).toHaveProperty('notes');
  });

  it('hands on only the servers a session could open, and leaves the rest in the file', async () => {
    put({ mcpServers: SERVERS });
    let next: Record<string, unknown> = {};
    const root = daemonRootConfig(optionsFrom({ configFile: config }), {}, () => {}, (servers) => { next = servers as Record<string, unknown>; });
    await root.write({ mcpServers: { broken: { type: 'http' }, notes: { type: 'http', url: 'https://notes.test/mcp', headers: { Authorization: '<set>' } } } });
    // An http server with no url is not one, and the file still holds it, so the
    // next start is the one that says so.
    expect(next).not.toHaveProperty('broken');
    expect(next.notes).toEqual({ type: 'http', url: 'https://notes.test/mcp', headers: { Authorization: 'Bearer t-1' } });
    expect((held().mcpServers as Record<string, unknown>).broken).toEqual({ type: 'http' });
  });

  it('replaces a server whose type changed rather than merging the two', async () => {
    const root = withServers();
    await root.write({ mcpServers: { search: { type: 'http', url: 'https://search.test/mcp' }, notes: { type: 'stdio', command: 'mcp-notes' } } });
    expect((held().mcpServers as Record<string, unknown>).search).toEqual({ type: 'http', url: 'https://search.test/mcp' });
    // The header went with the http server it belonged to, rather than sitting
    // in the stdio entry that replaced it.
    expect((held().mcpServers as Record<string, unknown>).notes).toEqual({ type: 'stdio', command: 'mcp-notes' });
  });

  it('takes a server back when the client sends it as a null', async () => {
    await withServers().write({ mcpServers: { search: null } });
    expect(Object.keys(held().mcpServers as object)).toEqual(['notes']);
  });

  it('refuses a value the schema refuses, naming the key, and leaves the file', async () => {
    await expect(withServers().write({ mcpServers: 'on' })).rejects.toThrow('mcpServers must be an object');
    expect(held().mcpServers).toEqual(SERVERS);
  });
});

describe('a credential in a plugin key', () => {
  it('is answered as set, and any other option as the file holds it', async () => {
    const root = await withPlugins([{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }]);
    expect((await root.values())[`plugins.${pluginIdOf(SECRET)}`]).toEqual({
      enabled: true,
      options: { apiKey: '<set>', region: 'eu' },
    });
  });

  it('is left as it is when a client sends the key back', async () => {
    const root = await withPlugins([{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }]);
    const answer = await root.write({ [`plugins.${pluginIdOf(SECRET)}`]: { options: { apiKey: '<set>', region: 'eu' } } });
    expect(answer).toEqual({ restartNeeded: true });
    expect(held().plugins).toEqual([{ source: SECRET, options: { apiKey: 'k-1', region: 'eu' } }]);
  });

  it('is replaced when the client sends another value for it', async () => {
    const root = await withPlugins([{ name: SECRET, options: { apiKey: 'k-1' } }]);
    await root.write({ [`plugins.${pluginIdOf(SECRET)}`]: { options: { apiKey: 'k-2' } } });
    expect(held().plugins).toEqual([{ source: SECRET, options: { apiKey: 'k-2' } }]);
  });

  it('is masked from the copy the host took, not from the manifest it read', async () => {
    put({ plugins: [{ name: AFTER, options: { region: 'eu', apiKey: 'k-1' } }] });
    const { loaded, problems } = await loadPlugins([AFTER], {
      base: { path: home, agents: [echo({ path: home })] },
      configDir: import.meta.dirname,
      cwd: import.meta.dirname,
      log: () => {},
    });
    expect(problems).toEqual([]);

    // The schema the manifest carries is one the loader read, and this copy of
    // it is rewritable after the load.
    const own = loaded[0]?.manifest?.optionsSchema as { properties: Record<string, Record<string, unknown>> };
    delete own.properties['apiKey']?.['writeOnly'];
    expect(own.properties['apiKey']).not.toHaveProperty('writeOnly');

    // What a client is served walks the host's copy, which still marks it: the
    // write reached a schema nobody answers from.
    const root = daemonRootConfig(optionsFrom({ configFile: config }));
    expect((await root.values())[`plugins.${pluginIdOf(AFTER)}`]).toMatchObject({ options: { apiKey: '<set>', region: 'eu' } });

    // And the copy is the host's own, frozen: the same write made to it is
    // refused where it is made rather than quietly dropped.
    const kept = optionsSchemaLoaded(pluginIdOf(AFTER)) as { properties: Record<string, Record<string, unknown>> };
    expect(kept).not.toBe(own);
    expect(Object.isFrozen(kept.properties['apiKey'])).toBe(true);
    expect(() => { delete kept.properties['apiKey']?.['writeOnly']; }).toThrow(TypeError);
  });

  it('is honoured however deep in the plugin options it sits', async () => {
    const root = await withPlugins([{
      name: COFOLD,
      options: { tools: { web: { search: { brave: { apiKey: 'bs-1' }, duckduckgo: true } } } },
    }], undefined, repo);
    expect((await root.values())[`plugins.${pluginIdOf(COFOLD)}`]).toMatchObject({
      options: { tools: { web: { search: { brave: { apiKey: '<set>' }, duckduckgo: true } } } },
    });
  });

  it('is a search provider\'s key, however deep in the plugin options it sits', async () => {
    const root = await withPlugins([{
      name: COFOLD,
      options: { tools: { web: { search: { tavily: { apiKey: 'tv-1' }, brave: { apiKey: 'bs-1' }, duckduckgo: true } } } },
    }], undefined, repo);
    const answered = (await root.values())[`plugins.${pluginIdOf(COFOLD)}`] as {
      options: { tools: { web: { search: Record<string, unknown> } } };
    };
    expect(answered.options.tools.web.search).toEqual({
      tavily: { apiKey: '<set>' },
      brave: { apiKey: '<set>' },
      duckduckgo: true,
    });
  });

  it('is left as it is when a client sends a whole provider back, masked', async () => {
    const options = { tools: { web: { search: { tavily: { apiKey: 'tv-1' }, duckduckgo: true } } } };
    const root = await withPlugins([{ name: COFOLD, options }], undefined, repo);
    const answer = await root.write({
      [`plugins.${pluginIdOf(COFOLD)}`]: {
        options: { tools: { web: { search: { tavily: { apiKey: '<set>' }, duckduckgo: false } } } },
      },
    });
    expect(answer).toEqual({ restartNeeded: true });
    expect(held().plugins).toEqual([{
      source: COFOLD,
      options: { tools: { web: { search: { tavily: { apiKey: 'tv-1' }, duckduckgo: false } } } },
    }]);
  });
});

describe('one Claude entry', () => {
  it('is keyed by its name, with its own options under it', async () => {
    const root = await withPlugins([{ name: CLAUDE, options: { workerStop: 'session' } }], undefined, repo);
    const values = await root.values() as Record<string, { options: Record<string, unknown> }>;
    expect(Object.keys(values)).toEqual(['plugins.agent-claude']);
    expect(values[`plugins.${pluginIdOf(CLAUDE)}`]?.options).toEqual({ workerStop: 'session' });
  });

  it('is a write that edits its own entry', async () => {
    const root = await withPlugins([{ name: CLAUDE, options: { workerStop: 'session' } }], undefined, repo);
    await root.write({ [`plugins.${pluginIdOf(CLAUDE)}`]: { options: { workerStop: 'worker' } } });
    expect(held().plugins).toEqual([{ source: CLAUDE, options: { workerStop: 'worker' } }]);
  });

  it('is refused by key when no entry holds that one', async () => {
    const root = await withPlugins([{ name: CLAUDE, options: {} }], undefined, repo);
    await expect(root.write({ [`plugins.${pluginIdOf(CLAUDE)}#gemini`]: { enabled: false } }))
      .rejects.toThrow(`plugins.${pluginIdOf(CLAUDE)}#gemini is not in plugins`);
  });
});
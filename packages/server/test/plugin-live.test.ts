import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { check } from '@cofold/commands';
import type { JsonSchema } from '@cofold/commands';
import { createHost } from '../../sdk/src/host.js';
import { connectorsChannel } from '../../sdk/src/connectors/channel.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { applyPlugins, eventFailed, type Applied } from '../src/applyplugins.js';
import { memoryAutomations } from '../../sdk/src/automations/automations.js';
import { loadPlugins, pluginSet } from '../src/plugins.js';
import { raise } from '../../sdk/src/plugins/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ServedAdapter } from '../../sdk/src/types/connectors.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';
import type { TriggerTypeDefinition } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Principal } from '../../sdk/src/types/users.js';
import type { Vault } from '../../sdk/src/types/vault.js';

/*
 * A plugin loaded, unloaded and applied again while the daemon runs.
 *
 * The plugin list in the file is the only source: a change to it is written,
 * `applyPlugins` reads it back, and what a client notices is a tool on the
 * session it already has, a closer that ran, an adapter that is gone, and a
 * restart asked for only where nothing else can happen. Each plugin here is a
 * module on disk, written by the case, because that is what the loader imports.
 */

const REPO = join(import.meta.dirname, '../../..');

let home: string;
let configFile: string;
let marker: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-live-'));
  configFile = join(home, 'config.json');
  marker = join(home, 'marker.log');
  writeFileSync(configFile, JSON.stringify({ plugins: [] }));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const settle = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean, what: string, tries = 600): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (done()) return;
    await new Promise((done) => { setTimeout(done, 1); });
  }
  throw new Error(`${what} never happened`);
};

/** The file a plugin is loaded from, by the name it writes into its own log. */
const pluginFile = (id: string): string => {
  // A standalone plugin needs a manifest, and a file the case names gets the
  // `plugin.json` beside it, in its own folder.
  const folder = join(home, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'plugin.json'), JSON.stringify({ id, main: `./${id}.mjs` }));
  return join(folder, `${id}.mjs`);
};

/**
 * A plugin that adds one tool and closes cleanly.
 *
 * Both `apply` and the closer append to the marker file, which is how one case
 * proves the closer ran and another proves it ran before `apply` ran again.
 */
const toolPlugin = (id: string, tool: string): string => {
  const file = pluginFile(id);
  writeFileSync(file, `
import { appendFileSync } from 'node:fs';
export const name = ${JSON.stringify(id)};
export function apply(host, options) {
  appendFileSync(options.marker, 'applied ' + (options.tag ?? '') + '\\n');
  host.registerTool({
    definition: {
      name: ${JSON.stringify(tool)},
      description: 'A tool a plugin loaded while the daemon runs adds',
      inputSchema: { type: 'object', properties: {} },
    },
    run: () => 'ran',
  });
  host.registerClose(() => { appendFileSync(options.marker, 'closed ' + (options.tag ?? '') + '\\n'); });
}
`);
  return file;
};

/** A plugin whose contribution is an adapter, for the connectors channel. */
const adapterPlugin = (id: string, adapter: string): string => {
  const file = pluginFile(id);
  writeFileSync(file, `
export const name = ${JSON.stringify(id)};
export function apply(host) {
  host.registerAdapter({
    name: ${JSON.stringify(adapter)},
    title: 'Live adapter',
    description: 'An adapter a plugin loaded while the daemon runs adds',
    schema: { type: 'object', properties: { target: { type: 'string' } } },
    capabilities: [],
    open: () => () => {},
  });
}
`);
  return file;
};

/** A plugin that takes a port, which no running host can take on. */
const portPlugin = (id: string): string => {
  const file = pluginFile(id);
  writeFileSync(file, `
import { appendFileSync } from 'node:fs';
export const name = ${JSON.stringify(id)};
export function apply(host, options) {
  host.registerCommandParser((line) => (line === '' ? undefined : { text: line }));
  host.registerClose(() => { appendFileSync(options.marker, 'closed port\\n'); });
}
`);
  return file;
};

/**
 * A plugin that registers a backend under a provider of its own.
 *
 * The backend is the repository's own `echo`, imported from a file URL handed
 * in as an option: the module lives in a temp folder, so it cannot reach the
 * example by a relative import.
 */
const agentPlugin = (id: string, provider: string): string => {
  const file = pluginFile(id);
  writeFileSync(file, `
export const name = ${JSON.stringify(id)};
export async function apply(host, options) {
  const { echo } = await import(options.echo);
  host.registerAgent({ ...echo({ path: options.dir, pace: 0 }), provider: ${JSON.stringify(provider)} });
}
`);
  return file;
};

/**
 * A plugin that offers one trigger type, and fires it when the case says so.
 *
 * `fire` is exported by the module itself, so a case fires through the plugin's
 * own `fireTrigger` - the road a webhook or a bot takes - rather than by
 * reaching for the host's entry.
 */
const triggerPlugin = (id: string, type: string, event: string): string => {
  const file = pluginFile(id);
  writeFileSync(file, `
export const name = ${JSON.stringify(id)};
export let fire;
export function apply(host) {
  host.registerTriggerType({
    type: ${JSON.stringify(type)},
    title: 'A live event',
    description: 'An event a plugin loaded while the daemon runs fires',
    events: [{ id: ${JSON.stringify(event)}, title: 'It happened', description: 'The event happened.' }],
  });
  fire = () => { host.fireTrigger(${JSON.stringify(type)}, ${JSON.stringify(event)}, {}); };
}
`);
  return file;
};

/** One entry of the file, with the marker it writes to. */
const spec = (file: string, tag: string): PluginSpec => ({ name: file, options: { marker, tag } });

/** What the file says the plugins are, which is the only thing an apply reads. */
const configured = (...specs: PluginSpec[]): void => {
  writeFileSync(configFile, JSON.stringify({ plugins: specs }));
};

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

/**
 * A daemon that started with no plugin, as one started from an empty file does.
 *
 * The set is the one a live change is made against: it holds the agent list and
 * the contributions the host was built over, and `apply` is exactly what the
 * channel, root config and the command line ask for after they write the file.
 */
const daemon = async (over: Partial<HostOptions> = {}) => {
  const base: HostOptions = {
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base backend' }],
    ...over,
  };
  const where = { configDir: REPO, cwd: REPO, log: () => {} };
  const set = pluginSet({ base, ...where });
  const first = await loadPlugins([], { base, ...where, set });
  expect(first.problems).toEqual([]);
  const host = createHost(first.options);
  const apply = (reload?: string[]): Promise<Applied> => applyPlugins({
    set, configFile, host: () => host, log: () => {},
    ...(reload === undefined ? {} : { reload }),
  });
  return { host, set, apply, folded: () => set.fold().options, close: async () => { await host.close(); } };
};

type Host = ReturnType<typeof createHost>;

/** A client of `host` with a session open on `provider`. */
const session = async (host: Host, provider = 'base') => {
  const said = peer();
  const client = host.accept(said);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'live', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } }) as {
    snapshot: { state: { serverTools?: { name: string }[] } };
  };
  return { said, client, opened };
};

/** What the root says now, read by a client of its own. */
let roots = 0;
const root = async (host: Host): Promise<{ agents?: { provider?: string }[]; activeSessions?: number }> => {
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: `root-${roots++}`, protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { snapshots: { state: { agents?: { provider?: string }[]; activeSessions?: number } }[] };
  return ready.snapshots[0]!.state;
};

/** The tools the last `session/serverToolsChanged` named. */
const told = (said: ReturnType<typeof peer>): string[] => {
  const sent = said.notes
    .filter((note) => note.method === 'action')
    .map((note) => (note.params as { action: { type: string; tools?: { name: string }[] } }).action)
    .filter((action) => action.type === 'session/serverToolsChanged');
  const last = sent.at(-1);
  return last === undefined ? [] : (last.tools ?? []).map((one) => one.name);
};

it('loads a plugin enabled while the daemon runs, and its tool reaches the session already open', async () => {
  const { host, apply, close } = await daemon();
  const { said, opened } = await session(host);
  expect((opened.snapshot.state.serverTools ?? []).map((one) => one.name)).not.toContain('live_tool');

  configured(spec(toolPlugin('live-tool', 'live_tool'), 'one'));
  const answer = await apply();

  expect(answer.problems).toEqual([]);
  expect(answer.restart).toBe(false);
  expect(answer.loaded.map((one) => one.name)).toEqual(['live-tool']);
  await settle();
  expect(told(said)).toContain('live_tool');
  expect(readFileSync(marker, 'utf8')).toBe('applied one\n');
  await close();
});

it('unloads a plugin disabled while the daemon runs, running its closer and taking its tool away', async () => {
  const { host, apply, close } = await daemon();
  const { said } = await session(host);
  const file = toolPlugin('live-tool', 'live_tool');
  configured(spec(file, 'one'));
  await apply();
  await settle();
  expect(told(said)).toContain('live_tool');

  configured({ name: file, options: { marker, tag: 'one' }, enabled: false });
  const answer = await apply();

  expect(answer.problems).toEqual([]);
  expect(answer.restart).toBe(false);
  expect(answer.loaded).toEqual([]);
  await settle();
  expect(told(said)).not.toContain('live_tool');
  expect(readFileSync(marker, 'utf8')).toBe('applied one\nclosed one\n');
  await close();
});

it('runs the closers before applying a plugin again with new options', async () => {
  const { apply, close } = await daemon();
  const file = toolPlugin('live-tool', 'live_tool');
  configured(spec(file, 'one'));
  expect((await apply()).restart).toBe(false);

  configured(spec(file, 'two'));
  const answer = await apply();

  expect(answer.problems).toEqual([]);
  expect(answer.restart).toBe(false);
  expect(readFileSync(marker, 'utf8').split('\n').filter((one) => one !== ''))
    .toEqual(['applied one', 'closed one', 'applied two']);
  await close();
});

it('serves a connector of a disabled plugin as unavailable', async () => {
  const { host, apply, folded, close } = await daemon();
  const collection = await memoryRecords().collection('connectors', { format: 'json' });
  await collection.put({ id: 'hook', adapter: 'live', owner: 'host', title: 'Hook', config: { target: 'x' } });
  const adapters = (): Record<string, ServedAdapter> => folded().adapters ?? {};
  const vault: Vault = {
    get: async () => undefined,
    set: async () => {},
    delete: async () => false,
    list: async () => [],
  };
  const connectors = connectorsChannel({
    collection,
    adapters,
    vault: () => vault,
    check: (value, schema, label) => { check(value, schema as JsonSchema, label); },
  });
  const reader: Principal = { id: 'probe', roles: [], can: () => true };
  const stateOf = async (): Promise<string | undefined> => {
    const state = await connectors.channel.channel.snapshot('x-ahpd-connectors://', reader, 'probe') as {
      records: { id: string; record: { state?: string } }[];
    };
    return state.records.find((one) => one.id === 'hook')?.record.state;
  };

  const file = adapterPlugin('live-adapter', 'live');
  configured({ name: file });
  const loaded = await apply();
  expect(loaded.problems).toEqual([]);
  expect(Object.keys(folded().adapters ?? {})).toEqual(['live']);
  expect(await stateOf()).toBe('invalid');

  configured({ name: file, enabled: false });
  const unloaded = await apply();
  expect(unloaded.problems).toEqual([]);
  expect(folded().adapters ?? {}).toEqual({});
  // The connector stays on disk, and is served as one whose adapter is gone.
  expect(await stateOf()).toBe('unavailable');
  await close();
});

it('asks for a restart instead of loading a plugin that holds a port', async () => {
  const { apply, folded, close } = await daemon();
  const file = portPlugin('live-port');
  configured({ name: file, options: { marker } });
  const answer = await apply();

  expect(answer.restart).toBe(true);
  expect(answer.loaded).toEqual([]);
  expect(answer.problems.join('\n')).toMatch(/holds a port or a URI scheme/);
  // Nothing of it is held: the plugin was applied once and taken back out.
  expect(folded().commandParser).toBeUndefined();
  expect(readFileSync(marker, 'utf8')).toBe('closed port\n');
  await close();
});

it('ends the sessions of a plugin agent when the plugin unloads, and drops the agent', async () => {
  const { host, apply, close } = await daemon();
  const file = agentPlugin('live-agent', 'live');
  const echo = pathToFileURL(join(REPO, 'examples/echo/agent.ts')).href;
  const options = { echo, dir: home };
  configured({ name: file, options });
  const loaded = await apply();
  expect(loaded.problems).toEqual([]);
  expect(loaded.restart).toBe(false);
  expect((await root(host)).agents?.map((one) => one.provider)).toContain('live');

  await session(host, 'live');
  expect((await root(host)).activeSessions).toBe(1);

  configured({ name: file, options, enabled: false });
  const unloaded = await apply();

  expect(unloaded.problems).toEqual([]);
  expect(unloaded.restart).toBe(false);
  expect((await root(host)).activeSessions).toBe(0);
  expect((await root(host)).agents?.map((one) => one.provider)).not.toContain('live');
  await close();
});

it('ends an agent plugin its sessions before a reload runs its closers', async () => {
  const { host, apply, close } = await daemon();
  const file = agentPlugin('live-agent', 'live');
  const echo = pathToFileURL(join(REPO, 'examples/echo/agent.ts')).href;
  configured({ name: file, options: { echo, dir: home, tag: 'one' } });
  expect((await apply()).restart).toBe(false);
  await session(host, 'live');
  expect((await root(host)).activeSessions).toBe(1);

  configured({ name: file, options: { echo, dir: home, tag: 'two' } });
  const answer = await apply();

  expect(answer.problems).toEqual([]);
  expect(answer.restart).toBe(false);
  // The backend is loaded again under the same provider, and its old session is gone.
  expect((await root(host)).agents?.map((one) => one.provider)).toContain('live');
  expect((await root(host)).activeSessions).toBe(0);
  await close();
});

it('imports a plugin again from a new URL when the code it points at changed', async () => {
  const { host, apply, close } = await daemon();
  const { said } = await session(host);
  const file = toolPlugin('live-tool', 'live_tool');
  configured(spec(file, 'one'));
  expect((await apply()).restart).toBe(false);
  await settle();
  expect(told(said)).toContain('live_tool');

  // The module is replaced, and the entry that names it is not: only a reload
  // can say that the code moved.
  toolPlugin('live-tool', 'live_tool_two');
  const answer = await apply(['live-tool']);

  expect(answer.problems).toEqual([]);
  expect(answer.restart).toBe(false);
  expect(answer.loaded.map((one) => one.name)).toEqual(['live-tool']);
  await settle();
  expect(told(said)).toContain('live_tool_two');
  expect(told(said)).not.toContain('live_tool');
  // The closers of the code that went ran before the code on disk applied.
  expect(readFileSync(marker, 'utf8').split('\n').filter((one) => one !== ''))
    .toEqual(['applied one', 'closed one', 'applied one']);
  await close();
});

it('asks for a restart when the reload names something the file does not hold', async () => {
  const { apply, close } = await daemon();
  const answer = await apply(['missing']);

  // A package a plugin uses has no entry to import again: only a restart loads it.
  expect(answer.restart).toBe(true);
  expect(answer.problems.join('\n')).toMatch(/missing is not in/);
  await close();
});

it('fires into an automation from a plugin enabled while the daemon runs', async () => {
  const at = 'ahp-automation:/live';
  const type: TriggerTypeDefinition = {
    type: 'live-event',
    title: 'A live event',
    description: 'An event a plugin loaded while the daemon runs fires',
    events: [{ id: 'ping', title: 'It happened', description: 'The event happened.' }],
  };
  // The store checks a save against the types it is told of, and the plugin is
  // the one that brings this type, so the case says it first.
  const types: TriggerTypeDefinition[] = [type];
  const store = memoryAutomations({ pluginTypes: () => types });
  store.create(at, {
    title: 'Watch the live type',
    enabled: true,
    message: { text: 'It happened.' },
    session: { provider: 'base', workingDirectories: [pathToFileURL(home).href] },
    triggers: [{ id: 't1', kind: 'event', type: type.type, title: type.title, events: [{ id: 'ping' }], config: {} }],
  });
  const { apply, folded, close } = await daemon({ automations: store });

  const file = triggerPlugin('live-trigger', type.type, 'ping');
  configured({ name: file });
  const answer = await apply();
  expect(answer.problems).toEqual([]);
  expect(answer.restart).toBe(false);
  const entries = folded().pluginTriggers ?? [];
  expect(entries).toHaveLength(1);
  expect(typeof entries[0]?.deliver).toBe('function');

  // The plugin fires through its own handle, which reads the entry the host
  // set `deliver` on when it took the fold.
  const module = await import(pathToFileURL(file).href) as { fire(): void };
  module.fire();

  await until(() => (store.get(at)?.runs ?? []).length === 1, 'the run the fire started');
  await close();
});

it('gives a session start to a plugin enabled while the daemon runs', async () => {
  const { apply, folded, close } = await daemon();
  expect(folded().pluginStarts).toBeUndefined();

  const file = toolPlugin('live-tool', 'live_tool');
  configured(spec(file, 'one'));
  const answer = await apply();
  expect(answer.problems).toEqual([]);

  const starts = folded().pluginStarts ?? [];
  expect(starts).toHaveLength(1);
  // Set when the host took the fold, so the plugin's own `startSession` answers
  // rather than saying no host is built over it.
  expect(typeof starts[0]?.start).toBe('function');
  expect(typeof starts[0]?.startChat).toBe('function');
  expect(typeof starts[0]?.opens).toBe('function');
  await close();
});

/** A plugin that writes each `listening` and `stopping` it hears, and its closer, to the marker. */
const eventPlugin = (id: string): string => {
  const file = pluginFile(id);
  writeFileSync(file, `
import { appendFileSync } from 'node:fs';
export const name = ${JSON.stringify(id)};
export function apply(host, options) {
  host.on('listening', (event) => { appendFileSync(options.marker, 'listening ' + options.tag + ' ' + event.port + '\\n'); });
  host.on('stopping', () => { appendFileSync(options.marker, 'stopping ' + options.tag + '\\n'); });
  host.registerClose(() => { appendFileSync(options.marker, 'closed ' + options.tag + '\\n'); });
}
`);
  return file;
};

/** The `listening` event `run.ts` keeps from the start, which a late load is raised. */
const LISTENED = { type: 'listening', runtime: 'node', host: '127.0.0.1', port: 4100, guarded: false } as const;

/**
 * A daemon whose socket is open, with the two hooks `run.ts` gives an apply:
 * `stopping` before a plugin's closers, and the kept `listening` after a load.
 */
const listening = async () => {
  const running = await daemon();
  const apply = (reload?: string[]): Promise<Applied> => applyPlugins({
    set: running.set, configFile, host: () => running.host, log: () => {},
    ...(reload === undefined ? {} : { reload }),
    beforeUnload: (_id, events) => raise(events, { type: 'stopping' }),
    afterLoad: (_id, events) => raise(events, LISTENED),
  });
  return { ...running, apply };
};

/** The marker, one line each. */
const marked = (): string[] => readFileSync(marker, 'utf8').split('\n').filter((one) => one !== '');

it('raises listening to a plugin enabled after the socket opened, once, with the port of the start', async () => {
  const { apply, close } = await listening();
  configured(spec(eventPlugin('heard'), 'one'));
  expect((await apply()).problems).toEqual([]);
  expect(marked()).toEqual(['listening one 4100']);
  await close();
});

it('raises stopping to a plugin disabled while the daemon runs, before its closer', async () => {
  const { apply, close } = await listening();
  configured(spec(eventPlugin('heard'), 'one'));
  await apply();
  configured();
  expect((await apply()).problems).toEqual([]);
  expect(marked()).toEqual(['listening one 4100', 'stopping one', 'closed one']);
  await close();
});

it('gives the old copy of a reconfigured plugin stopping and the new copy listening', async () => {
  const { apply, close } = await listening();
  const file = eventPlugin('heard');
  configured(spec(file, 'one'));
  await apply();
  configured(spec(file, 'two'));
  expect((await apply()).problems).toEqual([]);
  expect(marked()).toEqual(['listening one 4100', 'stopping one', 'closed one', 'listening two 4100']);
  await close();
});

it('gives the old copy of a reloaded plugin stopping and the new copy listening', async () => {
  const { apply, close } = await listening();
  configured(spec(eventPlugin('heard'), 'one'));
  await apply();
  expect((await apply(['heard'])).problems).toEqual([]);
  expect(marked()).toEqual(['listening one 4100', 'stopping one', 'closed one', 'listening one 4100']);
  await close();
});

it('does not raise listening again to a plugin a later apply leaves as it was', async () => {
  const { apply, close } = await listening();
  const first = spec(eventPlugin('first'), 'one');
  configured(first);
  await apply();
  configured(first, spec(eventPlugin('second'), 'two'));
  expect((await apply()).problems).toEqual([]);
  expect(marked()).toEqual(['listening one 4100', 'listening two 4100']);
  await close();
});

/** A plugin whose `listening` handler throws, with the count of throws in its message. */
const throwingPlugin = (id: string): string => {
  const file = pluginFile(id);
  writeFileSync(file, `
let times = 0;
export const name = ${JSON.stringify(id)};
export function apply(host) {
  host.on('listening', () => { times += 1; throw new Error('no tunnel ' + times); });
}
`);
  return file;
};

it('alerts the row of a plugin whose listening handler throws, and keeps the line for the log', async () => {
  const running = await daemon();
  const lines: string[] = [];
  configured(spec(throwingPlugin('broken'), 'one'));
  await applyPlugins({ set: running.set, configFile, host: () => running.host, log: () => {} });
  const events = running.set.held('broken')?.contribution.events;
  await raise(events, LISTENED, eventFailed(running.set, (line) => { lines.push(line); }, 'listening'));
  expect(lines).toEqual(['broken failed at listening: no tunnel 1']);
  expect(running.set.alerts().broken).toEqual([
    { level: 'error', ref: 'event:listening', text: 'This plugin failed when ahpd started, and the ahpd log has the details.' },
  ]);
  await raise(events, LISTENED, eventFailed(running.set, (line) => { lines.push(line); }, 'listening'));
  expect(lines).toHaveLength(2);
  expect(running.set.alerts().broken).toHaveLength(1);
  await running.close();
});

it('raises no alert for a plugin the set does not hold', async () => {
  const running = await daemon();
  running.set.alert('gone', { level: 'error', ref: 'event:stopping', text: 'x' });
  expect(running.set.alerts()).toEqual({});
  await running.close();
});

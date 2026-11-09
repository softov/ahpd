import { loggerOf } from '../src/log.js';
import { beforeEach, expect, it, vi } from 'vitest';
import { memoryAutomations } from '../src/automations/automations.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import {
  claude, createHost, hello, machine, peer, resetSdk, sdk,
} from './support/host.js';
import { sdkVersion } from '../src/version.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext, TriggerTypeDefinition } from '../src/types/plugin.js';
import { WAIT_MS } from '../../../tools/wait.ts';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * A trigger type a plugin brings with it.
 *
 * The host lists two kinds of event trigger of its own - what a session does,
 * and the presets - and a type registered here is a third: the plugin knows
 * when its own events happen and says so, and an automation that names the type
 * runs when it does. What is checked is the whole of the seam: the type in the
 * listing a client draws its form from, the fire reaching every automation that
 * watches it, and the two names a plugin may not take.
 */

const DIR = '/home/softov';
const ROOT = 'ahp-root://';
const AUTOMATION = 'ahp-automation:/batten';

/** The one type these cases register, and the event it fires. */
const WEATHER: TriggerTypeDefinition = {
  type: 'weather',
  title: 'The weather',
  description: 'What a forecast says.',
  events: [{ id: 'storm', title: 'A storm is coming', description: 'Heavy rain on the way.' }],
};

/**
 * A type that asks for a field, the way the webhook type asks for its connector.
 *
 * Nothing about the host knows what `connector` means: the type says it is
 * required, and a save that leaves it out is refused with that word, because a
 * trigger this host cannot place is one it would never fire for the right call.
 */
const DEPLOY: TriggerTypeDefinition = {
  type: 'webhook',
  title: 'A webhook call',
  description: 'A call that arrived at an endpoint.',
  events: [{ id: 'call', title: 'A call', description: 'An endpoint was called.' }],
  configSchema: {
    type: 'object',
    properties: {
      connector: { type: 'string', title: 'Connector', description: 'The connector the call came to.' },
    },
    required: ['connector'],
  },
};

/** One automation watching for that event, the way a client would have saved it. */
const BATTEN: Bag = {
  title: 'Batten down',
  enabled: true,
  message: { text: 'Weather: {{event}} ({{trigger}}) on {{event.where}}' },
  session: { provider: 'claude', workingDirectories: [`file://${DIR}`] },
  triggers: [{
    id: 't1',
    kind: 'event',
    type: 'weather',
    title: 'The weather',
    events: [{ id: 'storm' }],
    config: {},
  }],
};

const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/** The value as a keyed object, for reading what a run was told. */
const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null && !Array.isArray(value)
  ? value as Bag
  : {});

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean, what: string, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened in ${ms} ms`);
};

/**
 * One host, one plugin offering trigger types, and the store behind them.
 *
 * The automation is written before the host is built, because that is when the
 * host reads every definition it will watch - an automation saved while it runs
 * is read when the store says it moved, and that path has its own file.
 */
function offered(definitions: TriggerTypeDefinition[] = [WEATHER], written?: Bag, over: Partial<HostOptions> = {}) {
  // Read at each save, so the store checks a definition written after the
  // plugins were loaded and leaves one written before them alone - which is
  // the order a daemon starts in, and what a definition restored from a file
  // looks like.
  const types: TriggerTypeDefinition[] = [];
  const store = memoryAutomations({ pluginTypes: () => types });
  if (written !== undefined) store.create(AUTOMATION, written);
  const { host: plugin, contribution } = pluginHost('weather', context());
  for (const one of definitions) plugin.registerTriggerType(one);
  types.push(...definitions);

  const base: HostOptions = {
    path: DIR,
    agents: [claude({ paths: [DIR] })],
    ...machine(),
    automations: store,
    ...over,
  };
  const { options, problems } = foldHostOptions(base, [contribution]);
  const host = createHost(options);
  const client = host.accept(peer());
  return { plugin, contribution, store, host, client, problems };
}

/** The runs of the one automation these cases watch, newest first, off its entry. */
const runs = (store: ReturnType<typeof memoryAutomations>): Bag[] =>
  (store.get(AUTOMATION)?.runs ?? []).map(bag);

it('lists a trigger type a plugin registered', async () => {
  const { client } = offered();
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));

  const answer = await client.handle({
    method: 'listAutomationTriggerDefinitions', params: { channel: ROOT },
  }) as { items: { type: string }[] };

  // Beside the host's own two, because a client draws the same form from it -
  // and because a type that is not listed is a type this host will not fire.
  expect(answer.items.map((one) => one.type)).toEqual(['session', 'watch', 'weather']);
});

it('lists a connector field with the host\'s connectors as its choices, marked to ask', async () => {
  const marked: TriggerTypeDefinition = {
    ...DEPLOY,
    configSchema: {
      type: 'object',
      properties: {
        connector: { type: 'string', title: 'Connector', 'x-ahpd-connector': { adapter: 'webhook' } } as never,
      },
      required: ['connector'],
    },
  };
  const { client } = offered([marked], undefined, {
    connectors: {
      refs: () => [
        { id: 'ci', adapter: 'webhook', owner: 'host', title: 'CI calls' },
        { id: 'ana-ci', adapter: 'webhook', owner: 'user:ana' },
      ],
      run: async () => ({}),
    },
  });
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));

  const answer = await client.handle({
    method: 'listAutomationTriggerDefinitions', params: { channel: ROOT },
  }) as { items: Bag[] };

  const webhook = answer.items.find((one) => one['type'] === 'webhook');
  expect(bag(bag(webhook?.['configSchema'])['properties'])['connector']).toEqual({
    type: 'string',
    title: 'Connector',
    'x-ahpd-connector': { adapter: 'webhook' },
    enum: ['ci'],
    enumLabels: ['CI calls'],
    enumDynamic: true,
    'x-ahpd-completions': { command: 'x-ahpd/completions', ref: 'connector:webhook' },
  });
});

it('starts a run when the plugin fires its event', async () => {
  const { plugin, store, client } = offered([WEATHER], BATTEN);
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));

  plugin.fireTrigger('weather', 'storm', { where: 'the coast' });
  await until(() => runs(store).length === 1, 'the run the fire started');

  // What the plugin knew rides on the run's origin, which is where the protocol
  // keeps a host's own provenance for a run a trigger made.
  const run = runs(store)[0] as Bag;
  expect(bag(run['origin'])).toMatchObject({ kind: 'trigger', triggerId: 't1' });
  expect(bag(bag(run['origin'])['event'])).toMatchObject({ event: 'storm', where: 'the coast' });

  // And the words the type gave the event are what the run is told: an agent
  // receives its message and nothing else, so the event has to be in there.
  await until(() => sdk.said.some((line) => line.includes('A storm is coming')), 'the message the run was given');
  // A field of the fire's data is named in the message, and filled from it.
  expect(sdk.said.some((line) => line.includes('Weather: A storm is coming (The weather) on the coast'))).toBe(true);
});

/*
 * A plugin names an automation by its id or by its URI, any URI in the
 * `ahp-automation` scheme, as VS Code's automation service takes one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L1513-L1517
 */
it('runs an automation a plugin names by a URI in the ahp-automation scheme', async () => {
  const { plugin, store, client } = offered([WEATHER]);
  const resource = 'ahp-automation:batten';
  store.create(resource, BATTEN);
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));

  plugin.runAutomation(resource, { where: 'the coast' });
  await until(() => (store.get(resource)?.runs ?? []).length === 1, 'the run the plugin asked for');
});

/** BATTEN, with its trigger's `config` set to `config`. */
const battenWith = (config: Bag): Bag => ({
  ...BATTEN,
  triggers: [{ ...(BATTEN['triggers'] as Bag[])[0], config }],
});

/** BATTEN, with its one trigger re-pointed at `type` and `event`, holding `config`. */
const triggerOf = (type: string, event: string, config: Bag): Bag => ({
  ...BATTEN,
  triggers: [{ id: 't1', kind: 'event', type, title: 'A call', events: [{ id: event }], config }],
});

it('runs a trigger whose config matches the fire data', async () => {
  const { plugin, store, client } = offered([WEATHER], battenWith({ where: 'the coast' }));
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));
  plugin.fireTrigger('weather', 'storm', { where: 'the coast' });
  await until(() => runs(store).length === 1, 'the run the fire started');
});

it('does not run a trigger whose config differs from the fire data', async () => {
  const { plugin, store, client } = offered([WEATHER], battenWith({ where: 'the hills' }));
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));
  plugin.fireTrigger('weather', 'storm', { where: 'the coast' });
  // A fire whose config matches, after the one that does not, so the wait has an end.
  plugin.fireTrigger('weather', 'storm', { where: 'the hills' });
  await until(() => runs(store).length === 1, 'the run the matching fire started');
  await new Promise((r) => { setTimeout(r, 20); });
  expect(runs(store)).toHaveLength(1);
  expect(bag(bag(runs(store)[0]?.['origin'])['event'])).toMatchObject({ where: 'the hills' });
});

it('runs a trigger whose config holds a key the fire data does not', async () => {
  // A form setting that is not a field of the fire, such as a unit, never blocks a run.
  const { plugin, store, client } = offered([WEATHER], battenWith({ where: 'the coast', units: 'metric' }));
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));
  plugin.fireTrigger('weather', 'storm', { where: 'the coast' });
  await until(() => runs(store).length === 1, 'the run the fire started');
});

it('does not run a trigger whose config differs on a key the data holds, beside a key it does not', async () => {
  const { plugin, store, client } = offered([WEATHER], battenWith({ where: 'the hills', units: 'metric' }));
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));
  plugin.fireTrigger('weather', 'storm', { where: 'the coast' });
  plugin.fireTrigger('weather', 'storm', { where: 'the hills' });
  await until(() => runs(store).length === 1, 'the run the matching fire started');
  await new Promise((r) => { setTimeout(r, 20); });
  expect(runs(store)).toHaveLength(1);
  expect(bag(bag(runs(store)[0]?.['origin'])['event'])).toMatchObject({ where: 'the hills' });
});

it('runs a trigger with no config when its type requires nothing', async () => {
  // The weather type has no schema, so an empty config is the whole of its
  // rule. A type that requires a field is the other side of this, below: the
  // save is refused without it, and a stored one that has it missing does not run.
  const { plugin, store, client } = offered([WEATHER], { ...BATTEN, _meta: { ahpd: { overlap: 'parallel' } } });
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));
  plugin.fireTrigger('weather', 'storm', { where: 'the coast' });
  plugin.fireTrigger('weather', 'storm', { where: 'the hills' });
  await until(() => runs(store).length === 2, 'a run for each fire');
});

it('refuses a save whose plugin trigger leaves out a field its type requires', () => {
  const { store } = offered([DEPLOY]);
  // Named as the client wrote it, so the form can point at the field to fill.
  expect(() => store.create(AUTOMATION, triggerOf('webhook', 'call', {}))).toThrow('connector is required');
});

it('refuses a save whose plugin trigger names an event its type does not offer', () => {
  const { store } = offered([DEPLOY]);
  // A config that passes, beside an event nobody offers: the event is the one
  // thing wrong, and the id is named rather than the type.
  expect(() => store.create(AUTOMATION, triggerOf('webhook', 'calls', { connector: 'deploys' })))
    .toThrow('calls is not an event this host watches for');
});

it('saves a trigger of a type no loaded plugin registers', () => {
  const { store } = offered([DEPLOY]);
  // A plugin that is not loaded today may be loaded tomorrow, so its type is
  // not a name this store can call wrong - neither its config nor its events.
  expect(() => store.create(AUTOMATION, triggerOf('nobody', 'anything', {}))).not.toThrow();
});

it('does not run a stored trigger whose config its type refuses, and says so once', async () => {
  const lines: string[] = [];
  const { plugin, store, client } = offered([DEPLOY], triggerOf('webhook', 'call', {}), {
    onEvent: (line) => { lines.push(line); },
  });
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));

  // Written before the plugin was loaded, so the save never saw the schema.
  // The fire is where the host finds out, and it does not wake the automation.
  plugin.fireTrigger('webhook', 'call', { connector: 'deploys' });
  plugin.fireTrigger('webhook', 'call', { connector: 'deploys' });
  await until(() => lines.some((line) => line.includes('connector is required')), 'the problem line');
  await new Promise((r) => { setTimeout(r, 20); });

  expect(runs(store)).toEqual([]);
  // Once, though the sender called twice: a fire can come every few seconds.
  expect(lines.filter((line) => line.includes('connector is required'))).toHaveLength(1);
});

it('leaves an automation nobody owns out when the host says so', async () => {
  // The daemon's own setting about sessions no automation may be shown: an event
  // from a session is filtered by it, and a plugin's fire is the same question
  // asked about an automation that names no session at all - whether this
  // automation is one this host runs at all.
  const shut = offered([WEATHER], BATTEN, { unownedAutomations: 'none' });
  await shut.client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));
  shut.plugin.fireTrigger('weather', 'storm', { where: 'the coast' });
  await new Promise((r) => { setTimeout(r, 20); });
  expect(runs(shut.store)).toEqual([]);

  // And the same fire on a host that offers every session to an automation
  // nobody owns: the type, the trigger and the plugin are all the same.
  const open = offered([WEATHER], BATTEN);
  await open.client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));
  open.plugin.fireTrigger('weather', 'storm', { where: 'the coast' });
  await until(() => runs(open.store).length === 1, 'the run the fire started');
});

it('refuses a second plugin with the same type name', () => {
  const first = pluginHost('weather', context());
  first.host.registerTriggerType(WEATHER);
  const second = pluginHost('forecast', context());
  second.host.registerTriggerType({ ...WEATHER, title: 'The forecast' });

  const { options, problems } = foldHostOptions({ path: DIR, agents: [] }, [first.contribution, second.contribution]);

  // A saved trigger names its type by string, so two definitions of one name is
  // a trigger nothing could choose between: the second is reported and loses
  // that type alone, keeping everything else it contributed.
  expect(problems).toEqual([
    'plugin forecast registers trigger type weather, which plugin weather already registered',
  ]);
  expect(options.pluginTriggers?.map((one) => one.by)).toEqual(['weather']);
  expect(options.pluginTriggers?.[0]?.types['weather']?.title).toBe('The weather');
});

it('refuses a name the host answers for, and a name the plugin already used', () => {
  const { host } = pluginHost('weather', context());

  // The host's own two are what a saved `session` or `watch` trigger already
  // means, so a plugin's definition under one of them would never be what fired.
  expect(() => { host.registerTriggerType({ ...WEATHER, type: 'session' }); })
    .toThrow('plugin weather: registerTriggerType needs session to be a name the host does not already use; session and watch are its own');
  expect(() => { host.registerTriggerType({ ...WEATHER, type: 'watch' }); }).toThrow(/registerTriggerType needs watch to be/);

  // And one plugin registering a name twice is one `apply` making a mistake
  // rather than two plugins disagreeing, so it is refused where it is written.
  host.registerTriggerType(WEATHER);
  expect(() => { host.registerTriggerType(WEATHER); })
    .toThrow('plugin weather: registerTriggerType needs weather to be a type name no other type in this plugin uses');
});

import { beforeEach, expect, it, vi } from 'vitest';
import { memoryAutomations } from '../src/automations.js';
import { foldHostOptions, pluginHost } from '../src/plugins.js';
import {
  claude, createHost, hello, machine, peer, resetSdk, sdk,
} from './support/host.js';
import { sdkVersion } from '../src/version.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions } from '../src/types/host.js';
import type { PluginContext, TriggerTypeDefinition } from '../src/types/plugin.js';

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

/** One automation watching for that event, the way a client would have saved it. */
const BATTEN: Bag = {
  title: 'Batten down',
  enabled: true,
  message: { text: 'Weather: {{event}} ({{trigger}})' },
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

const context = (): PluginContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: () => {}, say: () => {},
});

/** The value as a keyed object, for reading what a run was told. */
const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null && !Array.isArray(value)
  ? value as Bag
  : {});

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean, what: string, tries = 600): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened`);
};

/**
 * One host, one plugin offering trigger types, and the store behind them.
 *
 * The automation is written before the host is built, because that is when the
 * host reads every definition it will watch - an automation saved while it runs
 * is read when the store says it moved, and that path has its own file.
 */
function offered(definitions: TriggerTypeDefinition[] = [WEATHER], written?: Bag, over: Partial<HostOptions> = {}) {
  const store = memoryAutomations();
  if (written !== undefined) store.create(AUTOMATION, written);
  const { host: plugin, contribution } = pluginHost('weather', context());
  for (const one of definitions) plugin.registerTriggerType(one);

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

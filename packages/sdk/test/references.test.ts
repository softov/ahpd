import { loggerOf } from '../src/log.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fileUsers } from '../src/access/users.js';
import { memoryAutomations } from '../src/automations/automations.js';
import { connectorsChannel } from '../src/connectors/channel.js';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { memoryRecords } from '../src/resources/records.js';
import { servedRecords } from '../src/resources/recordschannel.js';
import { sdkVersion } from '../src/version.js';
import { claude, hello, machine, peer, resetSdk } from './support/host.js';
import type { ConnectorRef, ServedAdapter } from '../src/types/connectors.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext, TriggerTypeDefinition } from '../src/types/plugin.js';
import type { Owner } from '../src/types/usage.js';
import type { Vault } from '../src/types/vault.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * What a schema field may name, and whose it may be.
 *
 * A trigger config field marked `x-ahpd-connector` names a connector, and an
 * adapter config field marked `x-ahpd-automation` names an automation. Both are
 * checked where they are written - the automation store for the first, the
 * connectors channel for the second - and both follow one rule: the record is
 * the same owner's, or it is the host's. A fire and a `runAutomation` carry the
 * owner of the connector they came from, so a plugin cannot reach an
 * automation its connector could not.
 */

const DIR = '/home/softov';
const ROOT = 'ahp-root://';
const AUTOMATION = 'ahp-automation:/bobs';

type Bag = Record<string, any>;

/** The webhook type, as a plugin offers it, with its connector field marked. */
const DEPLOY = {
  type: 'webhook',
  title: 'A webhook call',
  description: 'A call that arrived at an endpoint.',
  events: [{ id: 'call', title: 'A call', description: 'An endpoint was called.' }],
  configSchema: {
    type: 'object',
    properties: {
      connector: {
        type: 'string',
        title: 'Connector',
        description: 'The connector the call came to.',
        'x-ahpd-connector': { adapter: 'webhook' },
      },
    },
    required: ['connector'],
  },
} as unknown as TriggerTypeDefinition;

/** An automation watching the webhook type, whose trigger names `connector`. */
const watching = (connector: string): Bag => ({
  title: 'Batten down',
  enabled: true,
  message: { text: 'A call came to {{connector}}' },
  session: { provider: 'claude', workingDirectories: [`file://${DIR}`] },
  triggers: [{
    id: 't1',
    kind: 'event',
    type: 'webhook',
    title: 'A call',
    events: [{ id: 'call' }],
    config: { connector },
  }],
});

/** The connectors this host serves, as the store's reference check reads them. */
const served: ConnectorRef[] = [
  { id: 'alice-ci', adapter: 'webhook', owner: 'user:alice' },
  { id: 'host-ci', adapter: 'webhook', owner: 'host' },
];

/** An automation store over that list, as a daemon builds one. */
const store = () => memoryAutomations({ pluginTypes: () => [DEPLOY], connectors: () => served });

const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
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

/** The runs of one automation, newest first, off its entry. */
const runs = (held: ReturnType<typeof memoryAutomations>, resource = AUTOMATION): Bag[] =>
  (held.get(resource)?.runs ?? []).map(bag);

/** A home in this process, so the users file the harnesses read is real. */
let home: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-references-'));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: { member: ['session:read', 'connector:put'] },
    users: [
      { id: 'alice', roles: ['member'] },
      { id: 'bob', roles: ['member'] },
    ],
  }));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/**
 * An automation store and a webhook plugin over this host's automations.
 *
 * Both people sign in before a fire is sent, because that is what tells this
 * host who they are: an owner it has never met holds no `session:read`, and an
 * automation they own would not run at all.
 */
async function hosted(written: { resource: string; connector: string; owner?: Owner }[] = []) {
  const held = store();
  for (const one of written) held.create(one.resource, watching(one.connector), one.owner);
  const { host: plugin, contribution } = pluginHost('webhook', context());
  plugin.registerTriggerType(DEPLOY);

  const users = fileUsers({ path: usersFile });
  const base: HostOptions = {
    path: DIR,
    agents: [claude({ paths: [DIR] })],
    ...machine(),
    automations: held,
    users,
  };
  const { options, problems } = foldHostOptions(base, [contribution]);
  const host = createHost(options);
  for (const id of ['alice', 'bob']) {
    const other = host.accept(peer());
    await other.handle(hello(['0.9.0'], { clientId: id }));
    const token = await users.mint(id);
    await other.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  }
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));
  return { plugin, store: held, host, client, problems };
}

/** The adapter schema the connectors channel checks a put against. */
const ADAPTER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    automation: { type: 'string', 'x-ahpd-automation': true },
  },
  required: ['target'],
};

/** The subset of JSON Schema the adapter's form uses, as the daemon's checker reads it. */
const check = (value: unknown, schema: Bag, label: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const given = value as Bag;
  const properties = (schema['properties'] ?? {}) as Bag;
  for (const name of (schema['required'] ?? []) as string[]) {
    if (given[name] === undefined) throw new Error(`${label}.${name} is required`);
  }
  for (const name of Object.keys(given)) {
    if (!(name in properties)) throw new Error(`${label}.${name} is not a field`);
  }
};

/** A vault that is a map. */
const vault = (): Vault & { held: Map<string, string> } => {
  const held = new Map<string, string>();
  return {
    held,
    get: async (name) => held.get(name),
    set: async (name, value) => { held.set(name, value); },
    delete: async (name) => held.delete(name),
    list: async () => [...held.keys()].sort(),
  };
};

it('refuses an automation whose trigger names another person\'s connector', () => {
  const held = store();
  // The trigger would read calls that arrive at alice's connector, which bob
  // never owned - so the save is where it is caught, with the id named.
  expect(() => held.create(AUTOMATION, watching('alice-ci'), 'user:bob'))
    .toThrow('connector names alice-ci, which belongs to user:alice, so this automation cannot read its calls');
  expect(held.get(AUTOMATION)).toBeUndefined();
});

it('saves the same automation when the connector is the host\'s', () => {
  const held = store();
  expect(() => held.create(AUTOMATION, watching('host-ci'), 'user:bob')).not.toThrow();
  // The owner rides in `_meta`, where the protocol has room for it.
  expect(held.get(AUTOMATION)?._meta?.['ahpd.owner']).toBe('user:bob');
});

it('refuses a connector naming another person\'s automation', async () => {
  const collection = await memoryRecords().collection('connectors', { format: 'json' });
  const adapters: Record<string, ServedAdapter> = {
    webhook: {
      name: 'webhook',
      title: 'Webhook',
      description: 'Receives calls at a URL.',
      by: 'webhook',
      schema: ADAPTER_SCHEMA,
      capabilities: [{ type: 'receive', name: 'call', title: 'Receives calls', description: 'Receives calls at a URL.' }],
      open: () => () => {},
    },
  };
  const connectors = connectorsChannel({
    collection,
    adapters: () => adapters,
    vault,
    check,
    // The daemon's lookup, which takes an id or its resource name.
    automations: (id) => (id === 'bobs' || id === AUTOMATION ? { owner: 'user:bob' } : undefined),
  });
  const wire = servedRecords('ahpd', [connectors.channel], connectors.methods);
  const users = fileUsers({ path: usersFile });
  const host = createHost({
    path: home,
    agents: [claude({ paths: [home] })],
    resources: fileResources(),
    channels: wire.channels,
    methods: wire.methods,
    users,
  });
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0'], { clientId: 'alice', initialSubscriptions: [ROOT] }));
  const token = await users.mint('alice');
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });

  const answer = await client.handle({
    method: 'x-ahpd/connectors/put',
    params: {
      id: 'ci', adapter: 'webhook', owner: 'user:alice', config: { target: 'a', automation: 'bobs' },
    },
  }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => ({ code: error.code, message: error.message }),
  );

  expect(answer).toEqual({
    code: -32602,
    message: 'automation names bobs, which belongs to user:bob, so user:alice may not start it',
  });
  expect(await collection.list()).toEqual([]);
  await host.close();
});

it('does not run another person\'s automation when a fire names its connector owner', async () => {
  const { plugin, store: held } = await hosted([{ resource: AUTOMATION, connector: 'host-ci', owner: 'user:bob' }]);

  // The connector is the host's, so the automation saves; the fire names
  // alice's connector, and her owner is not bob's.
  plugin.fireTrigger('webhook', 'call', { connector: 'host-ci', from: 'alice' }, 'user:alice');
  await new Promise((r) => { setTimeout(r, 20); });
  expect(runs(held)).toEqual([]);

  // The same fire from the automation's own owner reaches it, so the wait has an end.
  plugin.fireTrigger('webhook', 'call', { connector: 'host-ci', from: 'bob' }, 'user:bob');
  await until(() => runs(held).length === 1, 'the run the owner\'s fire started');
  expect(bag(bag(runs(held)[0]?.['origin'])['event'])).toMatchObject({ from: 'bob' });
});

it('starts one run of the automation a plugin names, and no other', async () => {
  const { plugin, store: held } = await hosted([
    { resource: 'ahp-automation:/one', connector: 'host-ci', owner: 'user:alice' },
    { resource: 'ahp-automation:/two', connector: 'host-ci', owner: 'user:alice' },
  ]);
  const data = { connector: 'host-ci', body: { ref: 'main' } };
  plugin.runAutomation('ahp-automation:/one', data, 'user:alice');
  await until(() => runs(held, 'ahp-automation:/one').length === 1, 'the run the plugin asked for');

  // A run of the one automation named, holding what the plugin knew on its
  // origin - and not a second run of the other one watching the same type.
  await new Promise((r) => { setTimeout(r, 20); });
  expect(runs(held, 'ahp-automation:/two')).toEqual([]);
  const origin = bag(runs(held, 'ahp-automation:/one')[0]?.['origin']);
  expect(origin).toMatchObject({ kind: 'trigger', triggerId: 't1' });
  expect(bag(origin['event'])).toEqual(data);
});

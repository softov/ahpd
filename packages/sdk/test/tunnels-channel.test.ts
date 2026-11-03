import { expect, it } from 'vitest';
import { invokeOperation } from '../src/kinds/operations.js';
import { memoryRecords } from '../src/resources/records.js';
import { tunnelsChannel } from '../src/tunnels/channel.js';
import type { TunnelsChannel } from '../src/tunnels/channel.js';
import type { ServedTunnelKind, Tunnel, TunnelReport } from '../src/types/tunnels.js';
import type { Vault } from '../src/types/vault.js';

/*
 * `x-ahpd-tunnels` over a store in memory, a vault that is a map, and one fake
 * kind. The command is the real one, so a call goes through the checks a client
 * meets: the operation, the target, the input and the state.
 *
 * The kind makes a tunnel of whatever is sent, reports what it is told to, and
 * keeps every call, so a test reads what the host saved and what the kind was
 * handed.
 */

const URI = 'x-ahpd-tunnels://';

type Bag = Record<string, any>;

/** The kind's schema: one whole number, one secret and one choice. */
const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    port: { type: 'integer', title: 'Port' },
    token: { type: 'string', title: 'Token', secret: true },
    anonymous: { type: 'boolean', title: 'Anyone can open it', default: false },
  },
  required: ['port'],
};

/** The subset of JSON Schema the kind's form uses: a type, the required fields and no others. */
const check = (value: unknown, schema: Bag, label: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const given = value as Bag;
  const properties = (schema['properties'] ?? {}) as Bag;
  for (const name of (schema['required'] ?? []) as string[]) {
    if (given[name] === undefined) throw new Error(`${label}.${name} is required`);
  }
  for (const [name, one] of Object.entries(properties) as [string, Bag][]) {
    if (given[name] === undefined) continue;
    if (one['type'] === 'integer' && !Number.isInteger(given[name])) throw new Error(`${label}.${name} must be a whole number`);
    if (one['type'] === 'string' && typeof given[name] !== 'string') throw new Error(`${label}.${name} must be text`);
    if (one['type'] === 'boolean' && typeof given[name] !== 'boolean') throw new Error(`${label}.${name} must be true or false`);
  }
  for (const name of Object.keys(given)) {
    if (!(name in properties)) throw new Error(`${label}.${name} is not a field`);
  }
};

/** A vault that is a map, and says what is in it. */
const made = (): Vault & { held: Map<string, string> } => {
  const held = new Map<string, string>();
  return {
    held,
    get: async (name) => held.get(name),
    set: async (name, value) => { held.set(name, value); },
    delete: async (name) => held.delete(name),
    list: async () => [...held.keys()].sort(),
  };
};

/** One call the host made on the kind. */
interface Called {
  what: string;
  tunnel: Tunnel;
  input?: Record<string, unknown>;
}

/** The fake kind, what it was called, and the last report each tunnel was given. */
const fakeKind = (options: { failCreate?: boolean } = {}) => {
  const called: Called[] = [];
  const reports = new Map<string, (report: TunnelReport) => void>();
  const kind: ServedTunnelKind = {
    name: 'fake',
    title: 'Fake',
    description: 'A fake tunnel.',
    by: 'fake-plugin',
    schema: SCHEMA,
    operations: [
      { id: 'restart' },
      { id: 'open' },
      { id: 'peek', input: { type: 'object', properties: { text: { type: 'string' } } } },
    ],
    create: async (tunnel, report) => {
      called.push({ what: 'create', tunnel });
      reports.set(tunnel.id, report);
      if (options.failCreate === true) throw new Error('the port is taken');
    },
    update: async (tunnel, input, report) => {
      called.push({ what: 'update', tunnel, input });
      reports.set(tunnel.id, report);
    },
    remove: async (tunnel) => { called.push({ what: 'remove', tunnel }); },
    invoke: async (name, tunnel, report) => {
      called.push({ what: name, tunnel });
      reports.set(tunnel.id, report);
      if (name === 'start') {
        report({ status: 'running', url: `https://fake-${String(tunnel.settings['port'])}.example/` });
      }
      if (name === 'stop') report({ status: 'stopped' });
      // A setting changed while the operation ran: the host saves it, and the
      // answer carries it.
      if (name === 'open') report({ settings: { anonymous: true, token: 'shh-2' } });
    },
    system: async (context) => ({ port: context.port }),
  };
  return { kind, called, reports };
};

/** A channel over a store in memory, bound to one subscriber whose actions are kept. */
async function setup(options: { failCreate?: boolean } = {}) {
  const collection = await memoryRecords().collection('tunnels', { format: 'json' });
  const vault = made();
  const problems: string[] = [];
  const fake = fakeKind(options);
  const kinds: Record<string, ServedTunnelKind> = { fake: fake.kind };
  const tunnels = tunnelsChannel({
    collection,
    kinds: () => kinds,
    vault: () => vault,
    check,
    onProblem: (line) => { problems.push(line); },
  });
  const sent: { uri: string; action: Bag }[] = [];
  tunnels.channel.bind({
    publish: (uri, action) => { sent.push({ uri, action }); },
    subscribers: (uri) => (uri === URI ? [{ client: 'c1', reader: undefined }] : []),
    localeOf: () => undefined,
  });
  const command = invokeOperation({
    channels: () => ({ [URI]: tunnels.operations }),
    check,
    onProblem: (line) => { problems.push(line); },
  });
  const invoke = async (operationId: string, input?: Bag, target?: string) =>
    await command.handle({
      channel: URI,
      operationId,
      ...(input === undefined ? {} : { input }),
      ...(target === undefined ? {} : { target: { id: target } }),
    }, undefined, 'c1');
  return { tunnels, collection, vault, problems, sent, invoke, called: fake.called, reports: fake.reports, kinds };
}

/** The state a client subscribes to. */
const stateOf = async (tunnels: TunnelsChannel): Promise<Bag> =>
  await tunnels.channel.channel.snapshot(URI, undefined, 'c1') as Bag;

it('creates a person tunnel, calls the kind, and sends the report to a subscriber', async () => {
  const one = await setup();
  // A subscriber with a snapshot already has the ids it was shown, so the new row is `added`.
  await stateOf(one.tunnels);

  const answer = await one.invoke('fake/create', { port: 8080 }) as Bag;
  const stored = (await one.collection.list())[0]!;
  expect(stored).toMatchObject({ kind: 'fake', plugin: 'fake-plugin', purpose: 'person', enabled: true, port: 8080 });
  expect(stored['owner']).toBeUndefined();
  expect(one.called[0]).toMatchObject({ what: 'create' });
  expect(one.called[0]?.tunnel).toMatchObject({ id: stored.id, settings: { port: 8080 } });
  expect(answer['id']).toBe(stored.id);
  expect(one.sent.map((s) => s.action['type'])).toContain('x-ahpd-tunnels/added');

  one.reports.get(stored.id)!({ status: 'running', url: 'https://fake-8080.example/' });
  await one.tunnels.refresh();
  expect(one.sent.at(-1)?.action).toMatchObject({
    type: 'x-ahpd-tunnels/changed',
    id: stored.id,
    record: { id: stored.id, status: 'running', url: 'https://fake-8080.example/' },
  });
});

it('keeps a secret in the vault, and only a reference in the record, the answer and the list', async () => {
  const one = await setup();
  const answer = await one.invoke('fake/create', { port: 8080, token: 'shh-1' }) as Bag;
  const id = String(answer['id']);

  expect(await one.vault.get(`host:tunnel/${id}/token`)).toBe('shh-1');
  const stored = await one.collection.get(id);
  expect(stored?.['token']).toEqual({ $secret: `host:tunnel/${id}/token` });
  // The kind is handed the value, because that is what it opens the tunnel with.
  expect(one.called[0]?.tunnel.settings).toEqual({ port: 8080, token: 'shh-1' });

  expect(JSON.stringify(stored)).not.toContain('shh-1');
  expect(JSON.stringify(answer)).not.toContain('shh-1');
  expect(JSON.stringify(await stateOf(one.tunnels))).not.toContain('shh-1');
  expect(JSON.stringify(one.sent)).not.toContain('shh-1');
});

it('keeps the stored secret when an update sends the field blank', async () => {
  const one = await setup();
  const created = await one.invoke('fake/create', { port: 8080, token: 'shh-1' }) as Bag;
  const id = String(created['id']);

  await one.invoke('fake/update', { port: 9090, token: '' }, id);

  expect(await one.vault.get(`host:tunnel/${id}/token`)).toBe('shh-1');
  expect((await one.collection.get(id))?.['token']).toEqual({ $secret: `host:tunnel/${id}/token` });
  expect(one.called.find((call) => call.what === 'update')?.input).toEqual({ port: 9090, token: 'shh-1' });
});

it('saves the settings a kind reports, as a put saves them, and answers with them', async () => {
  const one = await setup();
  const created = await one.invoke('fake/create', { port: 8080, token: 'shh-1' }) as Bag;
  const id = String(created['id']);

  const answer = await one.invoke('fake/open', {}, id) as Bag;

  const stored = await one.collection.get(id);
  expect(stored?.['anonymous']).toBe(true);
  // Only the fields the report named; the port the create wrote is untouched.
  expect(stored?.['port']).toBe(8080);
  // A secret in a report is moved to the vault, and the record keeps the reference.
  expect(stored?.['token']).toEqual({ $secret: `host:tunnel/${id}/token` });
  expect(await one.vault.get(`host:tunnel/${id}/token`)).toBe('shh-2');
  // The answer reads the record after the save, not before it.
  expect(answer['anonymous']).toBe(true);
  expect(JSON.stringify(answer)).not.toContain('shh-2');
});

it('leaves no record and no secret when the kind throws on create', async () => {
  const one = await setup({ failCreate: true });
  await expect(one.invoke('fake/create', { port: 8080, token: 'shh-1' })).rejects.toThrow('the port is taken');

  expect(await one.collection.list()).toEqual([]);
  expect(await one.vault.list()).toEqual([]);
  expect(one.problems.join('\n')).not.toContain('shh-1');
});

it('stops a tunnel on disable and starts it again on enable', async () => {
  const one = await setup();
  const created = await one.invoke('fake/create', { port: 8080 }) as Bag;
  const id = String(created['id']);
  one.reports.get(id)!({ status: 'running', url: 'https://fake-8080.example/' });

  const disabled = await one.invoke('fake/disable', {}, id) as Bag;
  expect(disabled).toMatchObject({ id, enabled: false, status: 'stopped' });
  expect((await one.collection.get(id))?.['enabled']).toBe(false);
  expect(one.called.filter((call) => call.what === 'stop')).toHaveLength(1);

  const enabled = await one.invoke('fake/enable', {}, id) as Bag;
  expect(enabled).toMatchObject({ id, enabled: true, status: 'running', url: 'https://fake-8080.example/' });
  expect((await one.collection.get(id))?.['enabled']).toBe(true);
  expect(one.called.filter((call) => call.what === 'start')).toHaveLength(1);
});

it('adds one system tunnel at a start, starts it, and adds no second one', async () => {
  const one = await setup();
  await one.tunnels.startAll(5181);

  const records = await one.collection.list();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ kind: 'fake', plugin: 'fake-plugin', purpose: 'system', enabled: true, port: 5181 });
  expect(one.called.filter((call) => call.what === 'start')).toHaveLength(1);
  expect(one.tunnels.urls()).toEqual(['https://fake-5181.example/']);

  await one.tunnels.startAll(5181);
  expect(await one.collection.list()).toHaveLength(1);
  // Already running, so the second start calls nothing.
  expect(one.called.filter((call) => call.what === 'start')).toHaveLength(1);
});

it('answers its operations beside the records, and a record operation on its row', async () => {
  const one = await setup();
  const state = await stateOf(one.tunnels);
  expect((state['operations'] as Bag[]).map((operation) => operation['id'])).toEqual([
    'fake/create', 'fake/update', 'fake/remove', 'fake/enable', 'fake/disable', 'fake/restart', 'fake/open', 'fake/peek',
  ]);
  expect((state['operations'] as Bag[]).find((operation) => operation['id'] === 'fake/remove'))
    .toMatchObject({ scopes: ['tunnel'], grant: 'tunnel:delete' });
});

import { expect, it } from 'vitest';
import {
  COMPLETIONS_COMMAND,
  completionsCommand,
  connectorRefusal,
  withConnectorChoices,
} from '../src/connectors/fields.js';
import { enginesChannel } from '../src/agents/engines.js';
import { invokeOperation } from '../src/kinds/operations.js';
import { memoryRecords } from '../src/resources/records.js';
import { tunnelsChannel } from '../src/tunnels/channel.js';
import type { ServedEngine } from '../src/types/agents.js';
import type { ConnectorRef } from '../src/types/connectors.js';
import type { ServedTunnelKind } from '../src/types/tunnels.js';
import type { Grant, Principal } from '../src/types/users.js';

/*
 * A schema field marked `x-ahpd-connector`: the check a save makes, the
 * choices a schema is sent with, and `x-ahpd/completions`. The tunnels and
 * engines channels are the real ones, over a store in memory, so the tests
 * read what a client is sent.
 */

type Bag = Record<string, any>;

/** Two host connectors, one of them titled, one of another adapter, and one person's. */
const SERVED: ConnectorRef[] = [
  { id: 'host-tunnel', adapter: 'devtunnel', owner: 'host', title: 'Work tunnel' },
  { id: 'spare-tunnel', adapter: 'devtunnel', owner: 'host' },
  { id: 'host-mail', adapter: 'mail', owner: 'host' },
  { id: 'ana-tunnel', adapter: 'devtunnel', owner: 'user:ana', title: 'Ana tunnel' },
];

/** One field that names a connector, one list whose items do, and one plain field. */
const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    connector: { type: 'string', title: 'Connector', 'x-ahpd-connector': 'devtunnel' },
    mails: { type: 'array', items: { type: 'string', 'x-ahpd-connector': { adapter: 'mail' } } },
    port: { type: 'integer', title: 'Port' },
  },
};

it('refuses an id no connector of the adapter has', () => {
  expect(connectorRefusal({ connector: 'asd' }, SCHEMA, SERVED, undefined))
    .toEqual({ field: 'connector', id: 'asd', adapter: 'devtunnel' });
  // An id of another adapter is not one of this field's.
  expect(connectorRefusal({ connector: 'host-mail' }, SCHEMA, SERVED, undefined))
    .toEqual({ field: 'connector', id: 'host-mail', adapter: 'devtunnel' });
});

it('refuses a person\'s connector to host work and to another person', () => {
  expect(connectorRefusal({ connector: 'ana-tunnel' }, SCHEMA, SERVED, undefined))
    .toMatchObject({ field: 'connector', id: 'ana-tunnel', found: { owner: 'user:ana' } });
  expect(connectorRefusal({ connector: 'ana-tunnel' }, SCHEMA, SERVED, 'user:cy'))
    .toMatchObject({ found: { owner: 'user:ana' } });
  expect(connectorRefusal({ connector: 'ana-tunnel' }, SCHEMA, SERVED, 'user:ana')).toBeUndefined();
  expect(connectorRefusal({ connector: 'host-tunnel' }, SCHEMA, SERVED, 'user:cy')).toBeUndefined();
});

it('checks each entry of a list whose items are marked, and skips what names nothing', () => {
  expect(connectorRefusal({ mails: ['host-mail', 'gone'] }, SCHEMA, SERVED, undefined))
    .toEqual({ field: 'mails', id: 'gone', adapter: 'mail' });
  expect(connectorRefusal({ connector: '', mails: [3], port: 'x' }, SCHEMA, SERVED, undefined)).toBeUndefined();
});

it('fills a marked field with the host\'s connectors, and leaves a person\'s out', () => {
  const filled = withConnectorChoices(SCHEMA, SERVED, false) as Bag;
  expect(filled.properties.connector).toEqual({
    type: 'string',
    title: 'Connector',
    'x-ahpd-connector': 'devtunnel',
    enum: ['host-tunnel', 'spare-tunnel'],
    enumLabels: ['Work tunnel', 'spare-tunnel'],
  });
  expect(filled.properties.mails.items).toMatchObject({ enum: ['host-mail'], enumLabels: ['host-mail'] });
  expect(filled.properties.port).toBe((SCHEMA['properties'] as Bag)['port']);
  // The schema handed in is not changed.
  expect((SCHEMA['properties'] as Bag)['connector']['enum']).toBeUndefined();
});

it('marks a field to ask, and gives no enum where the host has no connector', () => {
  const filled = withConnectorChoices(SCHEMA, [], true) as Bag;
  expect(filled.properties.connector['enum']).toBeUndefined();
  expect(filled.properties.connector).toMatchObject({
    enumDynamic: true,
    'x-ahpd-completions': { command: COMPLETIONS_COMMAND, ref: 'connector:devtunnel' },
  });
  expect(filled.properties.mails.items['x-ahpd-completions']).toEqual({ command: COMPLETIONS_COMMAND, ref: 'connector:mail' });
});

it('answers a schema with no marked field as it came', () => {
  const plain = { type: 'object', properties: { port: { type: 'integer' } } };
  expect(withConnectorChoices(plain, SERVED, true)).toBe(plain);
});

/** A signed-in person who may list connectors. */
const person = (id: string, grants: string[] = ['connector:list']): Principal => ({
  id,
  roles: [],
  can: (grant: Grant) => grants.includes(grant),
});

it('answers the host\'s connectors and the caller\'s own', async () => {
  const command = completionsCommand({ connectors: () => SERVED });
  const ana = await command.handle({ ref: 'connector:devtunnel' }, person('ana'), 'c1', 'user:ana');
  expect(ana).toEqual({
    items: [
      { value: 'host-tunnel', label: 'Work tunnel' },
      { value: 'spare-tunnel', label: 'spare-tunnel' },
      { value: 'ana-tunnel', label: 'Ana tunnel' },
    ],
  });
  const cy = await command.handle({ ref: 'connector:devtunnel' }, person('cy'), 'c1', 'user:cy') as Bag;
  expect(cy.items.map((one: Bag) => one.value)).toEqual(['host-tunnel', 'spare-tunnel']);
  const root = await command.handle({ ref: 'connector:devtunnel' }, undefined, 'c1', 'root:box') as Bag;
  expect(root.items.map((one: Bag) => one.value)).toEqual(['host-tunnel', 'spare-tunnel']);
});

it('filters by the query in the id or the title, and answers nothing for a ref it does not know', async () => {
  const command = completionsCommand({ connectors: () => SERVED });
  const asked = await command.handle({ ref: 'connector:devtunnel', query: 'WORK' }, undefined, 'c1', undefined) as Bag;
  expect(asked.items.map((one: Bag) => one.value)).toEqual(['host-tunnel']);
  const spare = await command.handle({ ref: 'connector:devtunnel', query: 'spare' }, undefined, 'c1', undefined) as Bag;
  expect(spare.items.map((one: Bag) => one.value)).toEqual(['spare-tunnel']);
  expect(await command.handle({ ref: 'agent:any' }, undefined, 'c1', undefined)).toEqual({ items: [] });
  expect(await command.handle({}, undefined, 'c1', undefined)).toEqual({ items: [] });
});

it('takes connector:list, and lets connector:all in', async () => {
  const command = completionsCommand({ connectors: () => SERVED });
  expect(command.grant).toBe('connector:list');
  expect(await command.authorize?.({}, person('admin', ['connector:all']))).toBe(true);
  expect(await command.authorize?.({}, person('nobody', []))).toBe(false);
});

/** A tunnel kind whose schema names a devtunnel connector. */
const tunnelKind = (): ServedTunnelKind => ({
  name: 'dev',
  title: 'Dev',
  description: 'A tunnel through a connector.',
  by: 'dev-plugin',
  schema: {
    type: 'object',
    properties: {
      connector: { type: 'string', title: 'Connector', 'x-ahpd-connector': 'devtunnel' },
      port: { type: 'integer', title: 'Port' },
    },
    required: ['connector', 'port'],
  },
  create: async () => {},
  update: async () => {},
  remove: async () => {},
  invoke: async () => {},
});

/** A tunnels channel over a store in memory, with the connectors above. */
const tunnels = async () => {
  const collection = await memoryRecords().collection('tunnels', { format: 'json' });
  const kinds = { dev: tunnelKind() };
  const sent: Bag[] = [];
  const channel = tunnelsChannel({
    collection,
    kinds: () => kinds,
    vault: () => undefined,
    check: () => {},
    connectors: () => SERVED,
  });
  channel.channel.bind({
    publish: (_uri, action) => { sent.push(action); },
    subscribers: () => [{ client: 'c1', reader: undefined }],
    localeOf: () => undefined,
  });
  const command = invokeOperation({ channels: () => ({ 'x-ahpd-tunnels://': channel.operations }), check: () => {} });
  const invoke = async (operationId: string, input: Bag, target?: string) =>
    await command.handle({
      channel: 'x-ahpd-tunnels://',
      operationId,
      input,
      ...(target === undefined ? {} : { target: { id: target } }),
    }, undefined, 'c1');
  return { channel, collection, sent, invoke };
};

it('refuses a tunnel that names no host connector, at a create and an update', async () => {
  const one = await tunnels();
  await expect(one.invoke('dev/create', { connector: 'asd', port: 80 }))
    .rejects.toMatchObject({ message: 'connector names asd, and this host serves no devtunnel connector with that id' });
  await expect(one.invoke('dev/create', { connector: 'ana-tunnel', port: 80 }))
    .rejects.toMatchObject({ message: 'connector names ana-tunnel, which belongs to user:ana, so a tunnel may not use it' });
  expect(await one.collection.list()).toEqual([]);

  const made = await one.invoke('dev/create', { connector: 'host-tunnel', port: 80 }) as Bag;
  await expect(one.invoke('dev/update', { connector: 'gone', port: 80 }, String(made['id'])))
    .rejects.toMatchObject({ message: 'connector names gone, and this host serves no devtunnel connector with that id' });
  expect((await one.collection.get(String(made['id'])))?.['connector']).toBe('host-tunnel');
});

it('sends the tunnel forms with the host\'s connectors as choices, and again on request', async () => {
  const one = await tunnels();
  const state = await one.channel.channel.channel.snapshot('x-ahpd-tunnels://', undefined, 'c1') as Bag;
  const inputs = (state.operations as Bag[]).filter((op) => op.input !== undefined).map((op) => [op.id, op.input.properties.connector]);
  expect(inputs).toEqual([
    ['dev/create', expect.objectContaining({ enum: ['host-tunnel', 'spare-tunnel'], enumLabels: ['Work tunnel', 'spare-tunnel'] })],
    ['dev/update', expect.objectContaining({ enum: ['host-tunnel', 'spare-tunnel'] })],
  ]);
  // A tunnel's list is whole: it asks for nothing more.
  expect(inputs[0]?.[1]).not.toHaveProperty('enumDynamic');

  one.channel.refreshOperations();
  expect(one.sent.at(-1)).toMatchObject({ type: 'x-ahpd-tunnels/operations' });
  expect(one.sent.at(-1)?.operations[0].input.properties.connector.enum).toEqual(['host-tunnel', 'spare-tunnel']);
});

it('sends an engine\'s schema with its connector choices, marked to ask', async () => {
  const engine = {
    name: 'claude',
    title: 'Claude',
    description: 'An engine.',
    by: 'agent-claude',
    schema: SCHEMA,
    open: () => { throw new Error('not opened here'); },
  } as unknown as ServedEngine;
  const channel = enginesChannel({ engines: () => ({ claude: engine }), connectors: () => SERVED });
  const state = await channel.channel.channel.snapshot('x-ahpd-engines://', undefined, 'c1') as Bag;
  const row = JSON.stringify(state);
  expect(row).toContain('"enumDynamic":true');
  expect(row).toContain('"ref":"connector:devtunnel"');
  expect(row).toContain('"enum":["host-tunnel","spare-tunnel"]');
  expect(row).not.toContain('ana-tunnel');
});

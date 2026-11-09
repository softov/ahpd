import { loggerOf } from '../src/log.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { adaptersChannel } from '../src/connectors/adapters.js';
import { createHost } from '../src/host.js';
import { fileUsers } from '../src/access/users.js';
import { pluginHost } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { servedRecords } from '../src/resources/recordschannel.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Adapter, ServedAdapter } from '../src/types/connectors.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Users } from '../src/types/users.js';
import type { Icon } from '@microsoft/agent-host-protocol';

/*
 * The adapters channel over a fold that holds two adapters.
 *
 * The channel is read-only and needs `connector:list`; it lists what the
 * plugins registered before any connector exists, keyed by the adapter's name.
 */

const URI = 'x-ahpd-adapters://';
const ROOT = 'ahp-root://';

type Bag = Record<string, any>;

const WEBHOOK: ServedAdapter = {
  name: 'webhook',
  title: 'Webhook',
  description: 'A URL that talks to a bot or fires an automation.',
  by: 'webhook',
  schema: { type: 'object', properties: { secret: { type: 'string', writeOnly: true } }, required: ['secret'] },
  capabilities: [
    { type: 'receive', name: 'calls', title: 'Receives calls', description: 'Answers a POST.', path: '/plugins/webhook/{id}' },
    { type: 'command', name: 'deploy', title: 'Deploy', description: 'Runs a deploy.' },
  ],
  open: () => {},
};

const MAIL: ServedAdapter = {
  name: 'mail',
  title: 'Mail',
  description: 'A mailbox that sends and receives.',
  by: 'mail',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  capabilities: [],
  icons: [{ src: 'https://example.com/mail.svg', contentType: 'image/svg+xml', sizes: ['any'], theme: 'light' }],
  open: () => {},
};

let home: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-adapters-'));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: {
      lister: ['connector:list'],
      'config-reader': ['config:read'],
    },
    users: [
      { id: 'ana', roles: ['lister'] },
      { id: 'bo', roles: [] },
      { id: 'fa', roles: ['config-reader'] },
    ],
  }));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

type Host = ReturnType<typeof createHost>;

/** A plugin context for a registration the host refuses before anything loads. */
const CONTEXT: LoaderContext = {
  path: '/tmp/adapters',
  paths: ['/tmp/adapters'],
  version: '0.0.0',
  hostName: 'host',
  configDir: '/tmp/adapters',
  log: loggerOf(() => {}),
  say: () => {},
};

/** A host serving the adapters channel over two adapters, and no connector. */
async function served(pluginIcons?: (name: string) => Icon[] | undefined) {
  const adapters: Record<string, ServedAdapter> = { webhook: WEBHOOK, mail: MAIL };
  const lists = adaptersChannel({
    adapters: () => adapters,
    ...(pluginIcons === undefined ? {} : { pluginIcons }),
  });
  const wire = servedRecords('ahpd', [lists.channel], {});
  const users = fileUsers({ path: usersFile });
  const host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    channels: wire.channels,
    methods: wire.methods,
    users,
  });
  return { host, users, adapters, close: async () => { await host.close(); } };
}

/** A client signed in as `id`. */
const as = async (host: Host, users: Users, id: string) => {
  const token = await users.mint(id);
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {}, notify: () => {},
  });
  await client.handle({
    method: 'initialize', params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => ({ code: error.code, message: error.message }),
  );
  /** Every row a subscribe to the adapters channel answered, by id. */
  const rows = async (): Promise<Record<string, Bag>> => {
    const answer = await call('subscribe', { channel: URI }) as Bag;
    if (answer['result'] === undefined) throw new Error(`subscribe refused: ${JSON.stringify(answer)}`);
    const records = (answer['result'] as Bag)['snapshot'].state.records as { id: string; record: Bag }[];
    return Object.fromEntries(records.map((one) => [one.id, one.record]));
  };
  return { call, rows, close: () => { client.close(); } };
};

it('lists every adapter by name with connector:list, before any connector exists', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(Object.keys(rows)).toEqual(['mail', 'webhook']);
  expect(rows['webhook']).toEqual({
    name: 'webhook',
    title: 'Webhook',
    description: 'A URL that talks to a bot or fires an automation.',
    schema: WEBHOOK.schema,
    capabilities: WEBHOOK.capabilities,
    plugin: 'webhook',
  });
  await close();
});

it('sends a receive capability with its path, and leaves the key out where it has none', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const [receive, command] = (await ana.rows())['webhook']?.['capabilities'] as Bag[];
  expect(receive).toMatchObject({ type: 'receive', path: '/plugins/webhook/{id}' });
  // A path is where calls arrive, and a command receives none.
  expect(command).not.toHaveProperty('path');
  await close();
});

it('refuses an adapter with a path on a capability that is not a receive', () => {
  const { host } = pluginHost('webhook', CONTEXT);
  const adapter: Adapter = {
    ...WEBHOOK,
    capabilities: [{ type: 'command', name: 'deploy', title: 'Deploy', description: 'Runs a deploy.', path: '/plugins/webhook/{id}' }],
  };

  expect(() => host.registerAdapter(adapter)).toThrow('path');
});

it('refuses a path that does not start with /', () => {
  const { host } = pluginHost('webhook', CONTEXT);
  const adapter: Adapter = {
    ...WEBHOOK,
    capabilities: [{ type: 'receive', name: 'calls', title: 'Receives calls', description: 'Answers a POST.', path: 'plugins/webhook/{id}' }],
  };

  expect(() => host.registerAdapter(adapter)).toThrow('path');
});

it('sends an adapter its icons, and leaves the key out where it has none', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(rows['mail']?.['icons']).toEqual([
    { src: 'https://example.com/mail.svg', contentType: 'image/svg+xml', sizes: ['any'], theme: 'light' },
  ]);
  // An adapter with no icon carries no key rather than an empty list.
  expect(rows['webhook']).not.toHaveProperty('icons');
  await close();
});

it('sends an adapter with no icon the icons of its plugin', async () => {
  const pluginIcons: Icon[] = [
    { src: 'data:image/svg+xml;base64,PHN2Zy8+', contentType: 'image/svg+xml', sizes: ['any'] },
  ];
  const { host, users, close } = await served((name) => (name === 'webhook' ? pluginIcons : undefined));
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(rows['webhook']?.['icons']).toEqual(pluginIcons);
  // An adapter's own icon wins over its plugin's.
  expect(rows['mail']?.['icons']).toEqual(MAIL.icons);
  await close();
});

it('sends no icons for an adapter whose plugin has none', async () => {
  const { host, users, close } = await served(() => undefined);
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(rows['webhook']).not.toHaveProperty('icons');
  await close();
});

it('accepts an icon of the AHP shape, and a list of them', () => {
  const { host } = pluginHost('webhook', CONTEXT);
  const adapter: Adapter = {
    ...WEBHOOK,
    icons: [
      { src: './icon.svg', contentType: 'image/svg+xml', sizes: ['any'], theme: 'dark' },
      { src: 'data:image/png;base64,AAAA' },
    ],
  };

  expect(() => host.registerAdapter(adapter)).not.toThrow();
});

it('refuses an icon with no src', () => {
  const { host } = pluginHost('webhook', CONTEXT);
  const adapter = { ...WEBHOOK, icons: [{ contentType: 'image/svg+xml' }] } as unknown as Adapter;

  expect(() => host.registerAdapter(adapter)).toThrow('src');
});

it('refuses an icon whose theme is neither light nor dark', () => {
  const { host } = pluginHost('webhook', CONTEXT);
  const adapter = { ...WEBHOOK, icons: [{ src: './icon.svg', theme: 'sepia' }] } as unknown as Adapter;

  expect(() => host.registerAdapter(adapter)).toThrow('theme');
});

it('refuses an icons member that is not a list', () => {
  const { host } = pluginHost('webhook', CONTEXT);
  const adapter = { ...WEBHOOK, icons: './icon.svg' } as unknown as Adapter;

  expect(() => host.registerAdapter(adapter)).toThrow('icons');
});

it('refuses a role without connector:list, config:read included', async () => {
  const { host, users, close } = await served();
  const bo = await as(host, users, 'bo');
  expect(await bo.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });

  const fa = await as(host, users, 'fa');
  expect(await fa.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });
  await close();
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { enginesChannel } from '../src/agents/engines.js';
import { createHost } from '../src/host.js';
import { fileUsers } from '../src/access/users.js';
import { fileResources } from '../src/resources/resources.js';
import { servedRecords } from '../src/resources/recordschannel.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Icon } from '@microsoft/agent-host-protocol';
import type { ServedEngine } from '../src/types/agents.js';
import type { Users } from '../src/types/users.js';

/*
 * The engines channel over a fold that holds two engines.
 *
 * The channel is read-only and needs `agent:list`; it lists what the plugins
 * registered before any record exists, keyed by the engine's name.
 */

const URI = 'x-ahpd-engines://';
const ROOT = 'ahp-root://';

type Bag = Record<string, any>;

/** An engine's backend is never built here: the channel sends the engine and no agent. */
const unopened = (() => { throw new Error('the engines channel does not open an engine'); }) as unknown as ServedEngine['open'];

const CLAUDE: ServedEngine = {
  name: 'claude',
  title: 'Claude',
  description: 'An agent on Claude Code.',
  by: 'agent-claude',
  schema: { type: 'object', properties: { mode: { type: 'string' } }, additionalProperties: false },
  icons: [{ src: 'https://example.com/claude.svg', contentType: 'image/svg+xml', sizes: ['any'], theme: 'light' }],
  templates: [
    {
      name: 'Claude Code',
      description: 'The stock harness.',
      icon: { src: 'data:image/png;base64,AAAA' },
      model: 'sonnet',
      config: { mode: 'default' },
    },
  ],
  hostOnly: ['mode'],
  keyVariables: ['ANTHROPIC_API_KEY'],
  capabilities: [
    {
      type: 'ui',
      name: 'usage',
      title: 'Plan usage',
      description: 'What the account\'s plan has left.',
      ui: {
        root: 'usage',
        components: { usage: { id: 'usage', component: 'Text', text: { path: '/usage/summary' } } },
      },
    },
  ],
  open: unopened,
};

const PI: ServedEngine = {
  name: 'pi',
  title: 'Pi',
  description: 'An agent on pi.',
  by: 'agent-pi',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  open: unopened,
};

let home: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-engines-'));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: {
      lister: ['agent:list'],
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

/** A host serving the engines channel over two engines, and no record. */
async function served(pluginIcons?: Record<string, Icon[]>) {
  const engines: Record<string, ServedEngine> = { claude: CLAUDE, pi: PI };
  const lists = enginesChannel({
    engines: () => engines,
    ...(pluginIcons === undefined ? {} : { pluginIcons: (name: string) => pluginIcons[name] }),
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
  return { host, users, engines, close: async () => { await host.close(); } };
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
  /** Every row a subscribe to the engines channel answered, by id. */
  const rows = async (): Promise<Record<string, Bag>> => {
    const answer = await call('subscribe', { channel: URI }) as Bag;
    if (answer['result'] === undefined) throw new Error(`subscribe refused: ${JSON.stringify(answer)}`);
    const records = (answer['result'] as Bag)['snapshot'].state.records as { id: string; record: Bag }[];
    return Object.fromEntries(records.map((one) => [one.id, one.record]));
  };
  return { call, rows, close: () => { client.close(); } };
};

it('lists every engine by name with agent:list, before any record exists', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(Object.keys(rows)).toEqual(['claude', 'pi']);
  expect(rows['claude']).toEqual({
    name: 'claude',
    title: 'Claude',
    description: 'An agent on Claude Code.',
    schema: CLAUDE.schema,
    plugin: 'agent-claude',
    icons: CLAUDE.icons,
    templates: CLAUDE.templates,
    hostOnly: ['mode'],
    keyVariables: ['ANTHROPIC_API_KEY'],
    capabilities: CLAUDE.capabilities,
  });
  await close();
});

it('sends an engine its templates and icons, and leaves the lists out where it has none', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(rows['claude']?.['templates']).toEqual([
    {
      name: 'Claude Code',
      description: 'The stock harness.',
      icon: { src: 'data:image/png;base64,AAAA' },
      model: 'sonnet',
      config: { mode: 'default' },
    },
  ]);
  // An engine with none of the lists carries no key rather than an empty one.
  expect(rows['pi']).not.toHaveProperty('icons');
  expect(rows['pi']).not.toHaveProperty('templates');
  expect(rows['pi']).not.toHaveProperty('hostOnly');
  expect(rows['pi']).not.toHaveProperty('keyVariables');
  expect(rows['pi']).not.toHaveProperty('capabilities');
  await close();
});

it('sends the plugin icons for an engine with none, and the engine icons over them', async () => {
  const plugin: Icon[] = [{ src: 'data:image/svg+xml;base64,PHN2Zy8+', contentType: 'image/svg+xml' }];
  const { host, users, close } = await served({ 'agent-pi': plugin, 'agent-claude': plugin });
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(rows['pi']?.['icons']).toEqual(plugin);
  expect(rows['claude']?.['icons']).toEqual(CLAUDE.icons);
  await close();
});

it('sends no icons for an engine with none from a plugin with none', async () => {
  const { host, users, close } = await served({});
  const ana = await as(host, users, 'ana');

  expect((await ana.rows())['pi']).not.toHaveProperty('icons');
  await close();
});

it('sends no open field, which is a function and does not serialize', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(rows['claude']).not.toHaveProperty('open');
  expect(rows['pi']).not.toHaveProperty('open');
  await close();
});

it('refuses a role without agent:list, config:read included', async () => {
  const { host, users, close } = await served();
  const bo = await as(host, users, 'bo');
  expect(await bo.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });

  const fa = await as(host, users, 'fa');
  expect(await fa.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });
  await close();
});

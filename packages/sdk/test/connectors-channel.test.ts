import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectorsChannel } from '../src/connectors/channel.js';
import { createHost } from '../src/host.js';
import { fileUsers } from '../src/access/users.js';
import { fileResources } from '../src/resources/resources.js';
import { memoryRecords } from '../src/resources/records.js';
import { servedRecords } from '../src/resources/recordschannel.js';
import { echo } from '../../../examples/echo/agent.js';
import type { CheckResult, Connector, ServedAdapter } from '../src/types/connectors.js';
import type { RecordCollection } from '../src/types/records.js';
import type { Principal, Users } from '../src/types/users.js';
import type { Vault } from '../src/types/vault.js';

/*
 * The connectors channel over a store in memory and a vault that is a map.
 *
 * The host is in this process, over a real users file, so the grant a caller
 * holds is the one the daemon would see: `connector:list` opens the channel and
 * reads the caller's own connectors, their teams' and the host's,
 * `connector:all` reads every one, and `connector:put` and `connector:remove`
 * make and remove a connector of any owner beside that owner's own rule.
 */

const URI = 'x-ahpd-connectors://';
const FILTERED = `${URI}?owner=me`;
const ROOT = 'ahp-root://';

type Bag = Record<string, any>;

/** The adapter's schema: one string a person fills in, one secret and one choice. */
const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    secret: { type: 'string', writeOnly: true },
    reply: { type: 'string' },
  },
  required: ['target'],
};

/**
 * The subset of JSON Schema this adapter's form uses, as the daemon's checker
 * reads it: a value of the named type, the required fields, and no field the
 * schema does not describe.
 */
const check = (value: unknown, schema: Bag, label: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const given = value as Bag;
  const properties = (schema['properties'] ?? {}) as Bag;
  for (const name of (schema['required'] ?? []) as string[]) {
    if (given[name] === undefined) throw new Error(`${label}.${name} is required`);
  }
  for (const [name, one] of Object.entries(properties) as [string, Bag][]) {
    if (given[name] === undefined) continue;
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

let home: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-connectors-'));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    teams: [{ id: 'backend' }],
    roles: {
      lister: ['connector:list'],
      all: ['connector:all'],
      writer: ['connector:list', 'connector:put', 'connector:remove'],
      teamer: ['connector:list', 'connector:put', 'connector:remove'],
      'host-maker': ['connector:put', 'connector:host'],
      'host-writer': ['connector:put', 'connector:remove', 'connector:host'],
      'config-reader': ['config:read'],
      'config-writer': ['config:write'],
    },
    users: [
      { id: 'ana', roles: ['lister'] },
      { id: 'bo', roles: [] },
      { id: 'cy', roles: ['writer'] },
      { id: 'di', roles: ['teamer'], memberships: ['backend'] },
      { id: 'el', roles: [], memberships: ['backend'] },
      { id: 'fa', roles: ['config-reader'] },
      { id: 'gi', roles: ['config-writer'] },
      { id: 'ha', roles: ['host-maker'] },
      { id: 'iv', roles: ['all'] },
    ],
  }));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env['AHPD_TEST_CONNECTOR_KEY'];
});

type Host = ReturnType<typeof createHost>;

/** What an adapter was opened with, and what it was closed as. */
interface Opened {
  id: string;
  adapter: string;
  owner: string;
  config: Record<string, unknown>;
}

/** One action an adapter ran, and what it was handed. */
interface Ran {
  id: string;
  action: string;
  input: Record<string, unknown>;
  config: Record<string, unknown>;
}

/** A host serving the connectors channel over one adapter, the `webhook` one. */
async function served(register = true) {
  const collection: RecordCollection = await memoryRecords().collection('connectors', { format: 'json' });
  const opened: Opened[] = [];
  const closed: string[] = [];
  const ran: Ran[] = [];
  const problems: string[] = [];
  const vault = made();
  /** What the adapter's check answers, and the connectors it was asked about. */
  const probe = {
    asked: [] as string[],
    answer: async (): Promise<CheckResult> => ({ result: 'ok' }),
  };
  const adapters: Record<string, ServedAdapter> = register
    ? {
        webhook: {
          name: 'webhook',
          title: 'Webhook',
          description: 'Receives calls at a URL.',
          by: 'webhook',
          schema: SCHEMA,
          capabilities: [
            { type: 'receive', name: 'call', title: 'Receives calls', description: 'Receives calls at a URL.' },
            {
              type: 'action',
              name: 'send',
              title: 'Sends a message',
              description: 'Sends a message to the target.',
              input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            },
          ],
          open: (connector: Connector) => {
            opened.push({ id: connector.id, adapter: connector.adapter, owner: connector.owner, config: connector.config });
            return () => { closed.push(connector.id); };
          },
          check: async (connector: Connector) => {
            probe.asked.push(connector.id);
            return probe.answer();
          },
          run: async (connector: Connector, action: string, input: Record<string, unknown>) => {
            ran.push({ id: connector.id, action, input, config: connector.config });
            return { ran: action, on: connector.id };
          },
        },
      }
    : {};
  const connectors = connectorsChannel({
    collection,
    adapters: () => adapters,
    vault: () => vault,
    check,
    onProblem: (line) => { problems.push(line); },
  });
  const wire = servedRecords('ahpd', [connectors.channel], connectors.methods);
  const users = fileUsers({ path: usersFile });
  const host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    channels: wire.channels,
    methods: wire.methods,
    users,
  });
  return { host, users, collection, connectors, adapters, opened, closed, ran, problems, vault, probe, close: async () => { await host.close(); } };
}

/** A client signed in as `id`, whose channel actions are kept. */
const as = async (host: Host, users: Users, id: string) => {
  const token = await users.mint(id);
  const seen: { method: string; params: Bag }[] = [];
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { seen.push({ method, params: params as Bag }); },
  });
  const ready = await client.handle({
    method: 'initialize', params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as Bag;
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => ({ code: error.code, message: error.message }),
  );
  /** Every row a subscribe to `channel` answered, by id. */
  const rows = async (channel = URI): Promise<Record<string, Bag>> => {
    const answer = await call('subscribe', { channel }) as Bag;
    if (answer['result'] === undefined) throw new Error(`subscribe refused: ${JSON.stringify(answer)}`);
    const records = (answer['result'] as Bag)['snapshot'].state.records as { id: string; record: Bag }[];
    return Object.fromEntries(records.map((one) => [one.id, one.record]));
  };
  return { call, rows, ready, seen, close: () => { client.close(); } };
};

/** The person behind an id, as a call through the channel is handed one. */
const readerOf = async (users: Users, id: string): Promise<Principal> => {
  const held = await users.verify(await users.mint(id));
  if (held === undefined) throw new Error(`${id} could not sign in`);
  return held;
};

it('holds no adapter row, and a connector row names its adapter', async () => {
  const { host, users, close } = await served();
  const ha = await as(host, users, 'ha');
  const iv = await as(host, users, 'iv');

  expect(await ha.call('x-ahpd/connectors/put', {
    id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a' },
  })).toMatchObject({ result: { state: 'ready' } });

  const rows = await iv.rows();
  expect(Object.keys(rows)).toEqual(['shared']);
  expect(rows['shared']).toMatchObject({ id: 'shared', adapter: 'webhook', owner: 'host' });
  // An adapter's own fields stay on `x-ahpd-adapters`.
  expect(rows['shared']).not.toHaveProperty('name');
  expect(rows['shared']).not.toHaveProperty('plugin');
  expect(rows['shared']).not.toHaveProperty('capabilities');
  await close();
});

it('makes two connectors of one adapter, and opens each with its own config', async () => {
  const { host, users, opened, close } = await served();
  const cy = await as(host, users, 'cy');

  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'webhook', owner: 'user:cy', title: 'CI', config: { target: 'bot://motion' },
  })).toMatchObject({ result: { id: 'ci', adapter: 'webhook', owner: 'user:cy', title: 'CI', state: 'ready' } });
  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'deploys', adapter: 'webhook', owner: 'user:cy', config: { target: 'automation' },
  })).toMatchObject({ result: { id: 'deploys', state: 'ready' } });

  expect(opened).toEqual([
    { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'bot://motion' } },
    { id: 'deploys', adapter: 'webhook', owner: 'user:cy', config: { target: 'automation' } },
  ]);
  const rows = await cy.rows();
  expect(Object.keys(rows)).toEqual(['ci', 'deploys']);
  expect(rows['ci']).toMatchObject({ id: 'ci', adapter: 'webhook', owner: 'user:cy', state: 'ready' });
  expect(rows['deploys']).toMatchObject({ state: 'ready' });
  await close();
});

it('keeps a writeOnly value in the vault, and in no record and no snapshot', async () => {
  const { host, users, collection, opened, vault, close } = await served();
  const cy = await as(host, users, 'cy');

  await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'bot://motion', secret: 'sk-live-1' },
  });

  // The vault holds it under the owner's scope, under the connector and the field.
  expect(await vault.get('user:cy/connector/ci/secret')).toBe('sk-live-1');
  // The adapter is given the value back, because that is what it answers calls with.
  expect(opened[0]?.config['secret']).toBe('sk-live-1');

  const stored = await collection.get('ci');
  expect(stored?.['config']).toEqual({ target: 'bot://motion', secret: { $secret: 'user:cy/connector/ci/secret' } });
  expect(JSON.stringify(stored)).not.toContain('sk-live-1');
  expect(JSON.stringify(await cy.rows())).not.toContain('sk-live-1');
  await close();
});

it('keeps the stored secret when a put sends the writeOnly field empty', async () => {
  const { host, users, collection, opened, vault, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'bot://motion', secret: 'sk-live-1' },
  });

  // A client never sees the value, so it sends the field empty rather than leaving it out.
  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'bot://other', secret: '' },
  })).toMatchObject({ result: { state: 'ready' } });

  expect(await vault.get('user:cy/connector/ci/secret')).toBe('sk-live-1');
  expect((await collection.get('ci'))?.['config']).toEqual({
    target: 'bot://other',
    secret: { $secret: 'user:cy/connector/ci/secret' },
  });
  // Closed for the rewrite and opened again with the secret read back.
  expect(opened).toHaveLength(2);
  expect(opened[1]?.config).toEqual({ target: 'bot://other', secret: 'sk-live-1' });
  await close();
});

it('opens a host connector with a variable from the daemon\'s environment, and keeps only its name', async () => {
  process.env['AHPD_TEST_CONNECTOR_KEY'] = 'env-value';
  const { host, users, collection, opened, vault, close } = await served();
  const ha = await as(host, users, 'ha');
  const iv = await as(host, users, 'iv');

  expect(await ha.call('x-ahpd/connectors/put', {
    id: 'shared',
    adapter: 'webhook',
    owner: 'host',
    config: { target: 'bot://motion', secret: { fromEnv: 'AHPD_TEST_CONNECTOR_KEY' } },
  })).toMatchObject({
    result: { id: 'shared', state: 'ready', config: { secret: { fromEnv: 'AHPD_TEST_CONNECTOR_KEY' } } },
  });

  // The adapter is given the value, and the daemon keeps nothing in the vault.
  expect(opened[0]?.config['secret']).toBe('env-value');
  expect([...vault.held.keys()]).toEqual([]);
  // The record and every row carry the name, which is not a secret.
  expect((await collection.get('shared'))?.['config'])
    .toEqual({ target: 'bot://motion', secret: { fromEnv: 'AHPD_TEST_CONNECTOR_KEY' } });
  expect(JSON.stringify(await iv.rows())).not.toContain('env-value');
  await close();
});

it('takes the old vault secret out when a host field changes to an environment reference', async () => {
  process.env['AHPD_TEST_CONNECTOR_KEY'] = 'env-value';
  const { host, users, vault, close } = await served();
  const ha = await as(host, users, 'ha');

  await ha.call('x-ahpd/connectors/put', {
    id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a', secret: 'sk-live-1' },
  });
  expect([...vault.held.keys()]).toEqual(['host:connector/shared/secret']);

  await ha.call('x-ahpd/connectors/put', {
    id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_CONNECTOR_KEY' } },
  });
  expect([...vault.held.keys()]).toEqual([]);
  await close();
});

it('shows a host connector whose variable is not set as invalid', async () => {
  const { host, users, connectors, opened, close } = await served();
  const ha = await as(host, users, 'ha');
  const iv = await as(host, users, 'iv');

  // The put is refused because the connector cannot open, and it stays stored.
  expect(await ha.call('x-ahpd/connectors/put', {
    id: 'shared',
    adapter: 'webhook',
    owner: 'host',
    config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_CONNECTOR_KEY' } },
  })).toMatchObject({ code: -32603, message: expect.stringContaining('the environment holds no AHPD_TEST_CONNECTOR_KEY') });
  expect(opened).toEqual([]);
  expect((await iv.rows())['shared']).toMatchObject({ state: 'invalid' });
  // A start does not throw for it either, and leaves it invalid.
  await connectors.openAll();
  expect((await iv.rows())['shared']).toMatchObject({ state: 'invalid' });
  await close();
});

it('refuses an environment reference on a team\'s connector or a person\'s', async () => {
  const { host, users, collection, opened, close } = await served();
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');

  // The daemon's environment is nobody's own, so only a host connector names one.
  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'mine', adapter: 'webhook', owner: 'user:cy', config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_CONNECTOR_KEY' } },
  })).toMatchObject({ code: -32602, message: expect.stringContaining('only for a host connector') });
  expect(await di.call('x-ahpd/connectors/put', {
    id: 'team', adapter: 'webhook', owner: 'team:backend', config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_CONNECTOR_KEY' } },
  })).toMatchObject({ code: -32602, message: expect.stringContaining('only for a host connector') });
  expect(await collection.list()).toEqual([]);
  expect(opened).toEqual([]);
  await close();
});

it('leaves a person\'s record that names a variable invalid at open, without reading the variable', async () => {
  const { host, users, collection, opened, connectors, problems, close } = await served();
  // Written straight into the collection, so no put asked the owner's rule.
  await collection.put({
    id: 'mine', adapter: 'webhook', owner: 'user:cy', config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_CONNECTOR_KEY' } },
  });
  expect(process.env['AHPD_TEST_CONNECTOR_KEY']).toBeUndefined();
  await connectors.openAll();
  const cy = await as(host, users, 'cy');

  // A read would answer `the environment holds no ...`; the owner's rule runs first.
  expect(problems).toEqual([expect.stringContaining('may read the daemon\'s environment only for a host connector')]);
  expect(opened).toEqual([]);
  expect((await cy.rows())['mine']).toMatchObject({ state: 'invalid' });
  await close();
});

it('serves a connector of an adapter nobody registers as unavailable, and does not open it', async () => {
  const { host, users, collection, opened, connectors, close } = await served(false);
  await collection.put({ id: 'lost', adapter: 'webhook', owner: 'host', config: { target: 'bot://motion' } });
  await connectors.openAll();
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(rows['lost']).toMatchObject({ id: 'lost', adapter: 'webhook', owner: 'host', state: 'unavailable' });
  expect(opened).toEqual([]);
  await close();
});

it('serves a connector whose config no longer fits its adapter as invalid, and opens none', async () => {
  const { host, users, collection, opened, connectors, close } = await served();
  await collection.put({ id: 'lost', adapter: 'webhook', owner: 'host', config: { reply: 'none' } });
  await connectors.openAll();
  const ana = await as(host, users, 'ana');

  expect((await ana.rows())['lost']).toMatchObject({ state: 'invalid' });
  expect(opened).toEqual([]);
  await close();
});

it('opens a stored connector of a registered adapter when the daemon starts', async () => {
  const { host, users, collection, opened, connectors, vault, close } = await served();
  await vault.set('host:connector/ci/secret', 'right-token');
  await collection.put({
    id: 'ci', adapter: 'webhook', owner: 'host', config: { target: 'bot://motion', secret: { $secret: 'host:connector/ci/secret' } },
  });
  await connectors.openAll();
  const ana = await as(host, users, 'ana');

  expect(opened).toEqual([
    { id: 'ci', adapter: 'webhook', owner: 'host', config: { target: 'bot://motion', secret: 'right-token' } },
  ]);
  expect((await ana.rows())['ci']).toMatchObject({ state: 'ready' });
  await close();
});

it('reads the caller\'s own, their team\'s and the host\'s connectors with connector:list', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');
  const ana = await as(host, users, 'ana');
  const ha = await as(host, users, 'ha');
  await cy.call('x-ahpd/connectors/put', { id: 'mine', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  await ha.call('x-ahpd/connectors/put', { id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'b' } });
  await di.call('x-ahpd/connectors/put', { id: 'theirs', adapter: 'webhook', owner: 'user:di', config: { target: 'c' } });
  await di.call('x-ahpd/connectors/put', { id: 'team', adapter: 'webhook', owner: 'team:backend', config: { target: 'd' } });

  // The caller's own, the host's, and no other person's.
  expect(Object.keys(await cy.rows())).toEqual(['mine', 'shared']);
  // A person's own, their team's and the host's.
  expect(Object.keys(await di.rows())).toEqual(['shared', 'team', 'theirs']);
  // `?owner=me` narrows to the caller's own.
  expect(Object.keys(await cy.rows(FILTERED))).toEqual(['mine']);
  expect(Object.keys(await di.rows(FILTERED))).toEqual(['theirs']);
  // A lister in no team and with no connector of their own reads the host's only.
  expect(Object.keys(await ana.rows())).toEqual(['shared']);
  await close();
});

it('reads an empty list with connector:list before any connector exists', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');
  const iv = await as(host, users, 'iv');

  // The gate admits a lister with no row to read, and the snapshot is empty.
  expect(await ana.rows()).toEqual({});
  // A role with connector:all and no connector:list is let in by authorize, and reads none either.
  expect(await iv.rows()).toEqual({});
  expect(await iv.rows(FILTERED)).toEqual({});
  await close();
});

it('reads every connector with connector:all', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');
  const iv = await as(host, users, 'iv');
  const ha = await as(host, users, 'ha');
  await cy.call('x-ahpd/connectors/put', { id: 'mine', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  await ha.call('x-ahpd/connectors/put', { id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'b' } });
  await di.call('x-ahpd/connectors/put', { id: 'theirs', adapter: 'webhook', owner: 'user:di', config: { target: 'c' } });

  expect(Object.keys(await iv.rows())).toEqual(['mine', 'shared', 'theirs']);
  expect(Object.keys(await iv.rows(FILTERED))).toEqual([]);
  await close();
});

it('refuses a caller with no grant, to read and to change what is not theirs', async () => {
  const { host, users, close } = await served();
  const bo = await as(host, users, 'bo');
  const ha = await as(host, users, 'ha');
  await ha.call('x-ahpd/connectors/put', { id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a' } });

  // A reader with no `connector:` grant is answered no row at all, and the
  // refusal names the grant that opens the channel.
  expect(await bo.call('subscribe', { channel: URI })).toMatchObject({
    code: -32009,
    message: expect.stringContaining('connector:list'),
  });
  // A host connector takes connector:put and connector:host.
  expect(await bo.call('x-ahpd/connectors/put', {
    id: 'other', adapter: 'webhook', owner: 'host', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });
  // A team's takes connector:put and a membership, and a person's takes being them.
  expect(await bo.call('x-ahpd/connectors/put', {
    id: 'other', adapter: 'webhook', owner: 'team:backend', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });
  expect(await bo.call('x-ahpd/connectors/put', {
    id: 'other', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });
  expect(await bo.call('x-ahpd/connectors/remove', { id: 'shared' })).toMatchObject({ code: -32009 });
  await close();
});

it('refuses a person without connector:put their own connector', async () => {
  const { host, users, closed, close } = await served();
  const bo = await as(host, users, 'bo');

  expect(await bo.call('x-ahpd/connectors/put', {
    id: 'mine', adapter: 'webhook', owner: 'user:bo', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });
  // Nothing of theirs is stored, and the channel is not theirs to read.
  expect(await bo.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });
  expect(closed).toEqual([]);
  await close();
});

it('does not let a connector grant reach a team\'s connector or a person\'s', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');
  await di.call('x-ahpd/connectors/put', { id: 'theirs', adapter: 'webhook', owner: 'user:di', config: { target: 'a' } });
  await di.call('x-ahpd/connectors/put', { id: 'team', adapter: 'webhook', owner: 'team:backend', config: { target: 'b' } });

  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'theirs', adapter: 'webhook', owner: 'user:di', config: { target: 'c' },
  })).toMatchObject({ code: -32009 });
  expect(await cy.call('x-ahpd/connectors/remove', { id: 'team' })).toMatchObject({ code: -32009 });
  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'team', adapter: 'webhook', owner: 'team:backend', config: { target: 'c' },
  })).toMatchObject({ code: -32009 });
  await close();
});

it('does not let a put with another owner take a connector its caller may not change', async () => {
  const { host, users, opened, close } = await served();
  const bo = await as(host, users, 'bo');
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');
  await di.call('x-ahpd/connectors/put', { id: 'theirs', adapter: 'webhook', owner: 'user:di', config: { target: 'a' } });
  await di.call('x-ahpd/connectors/put', { id: 'team', adapter: 'webhook', owner: 'team:backend', config: { target: 'b' } });

  expect(await bo.call('x-ahpd/connectors/put', {
    id: 'theirs', adapter: 'webhook', owner: 'user:bo', config: { target: 'c' },
  })).toMatchObject({ code: -32009 });
  // Moving the team's connector to the host leaves the team, and takes its remove rule.
  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'team', adapter: 'webhook', owner: 'host', config: { target: 'c' },
  })).toMatchObject({ code: -32009 });
  expect(opened.map((one) => [one.id, one.owner])).toEqual([['theirs', 'user:di'], ['team', 'team:backend']]);
  await close();
});

it('takes the old owner\'s secrets out of the vault when a connector changes hands', async () => {
  const { host, users, vault, close } = await served();
  const di = await as(host, users, 'di');
  await di.call('x-ahpd/connectors/put', {
    id: 'moved', adapter: 'webhook', owner: 'user:di', config: { target: 'a', secret: 'old-value' },
  });
  expect([...vault.held.keys()]).toEqual(['user:di/connector/moved/secret']);

  expect(await di.call('x-ahpd/connectors/put', {
    id: 'moved', adapter: 'webhook', owner: 'team:backend', config: { target: 'a', secret: 'new-value' },
  })).toMatchObject({ result: { owner: 'team:backend' } });
  expect([...vault.held.keys()]).toEqual(['team:backend/connector/moved/secret']);
  await close();
});

it('makes a team connector with connector:put and a membership, without team:write', async () => {
  const { host, users, close } = await served();
  const di = await as(host, users, 'di');

  expect(await di.call('x-ahpd/connectors/put', {
    id: 'team', adapter: 'webhook', owner: 'team:backend', config: { target: 'a' },
  })).toMatchObject({ result: { state: 'ready' } });
  expect(Object.keys(await di.rows())).toEqual(['team']);
  await close();
});

it('refuses a team connector to a member without connector:put', async () => {
  const { host, users, close } = await served();
  const el = await as(host, users, 'el');

  expect(await el.call('x-ahpd/connectors/put', {
    id: 'team', adapter: 'webhook', owner: 'team:backend', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });
  await close();
});

it('refuses a role holding only config:read, which used to read this channel', async () => {
  const { host, users, close } = await served();
  const ha = await as(host, users, 'ha');
  await ha.call('x-ahpd/connectors/put', { id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a' } });

  const fa = await as(host, users, 'fa');
  expect(await fa.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });
  await close();
});

it('makes a host connector with connector:put and connector:host, and refuses connector:put alone', async () => {
  const { host, users, closed, close } = await served();
  const ha = await as(host, users, 'ha');

  expect(await ha.call('x-ahpd/connectors/put', {
    id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a' },
  })).toMatchObject({ result: { id: 'shared', owner: 'host', state: 'ready' } });
  // Making one is not removing it, which takes its own grant.
  expect(await ha.call('x-ahpd/connectors/remove', { id: 'shared' })).toMatchObject({ code: -32009 });
  // Moving it to themselves takes it from the host, which is a remove too.
  expect(await ha.call('x-ahpd/connectors/put', {
    id: 'shared', adapter: 'webhook', owner: 'user:ha', config: { target: 'b' },
  })).toMatchObject({ code: -32009 });
  expect(closed).toEqual([]);

  const cy = await as(host, users, 'cy');
  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'other', adapter: 'webhook', owner: 'host', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });

  const gi = await as(host, users, 'gi');
  expect(await gi.call('x-ahpd/connectors/put', {
    id: 'other', adapter: 'webhook', owner: 'host', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });
  await close();
});

it('advertises plugin and connector in the handshake, beside the built-ins', async () => {
  const { host, users, close } = await served();
  const bo = await as(host, users, 'bo');
  const grants = bo.ready['_meta']?.['ahpd.grants'] as Bag;

  expect(grants['plugin']).toEqual({
    title: 'Plugins',
    description: expect.any(String),
    operations: ['list', 'enable', 'disable', 'options'],
    groups: { read: ['list'], write: ['enable', 'disable', 'options'] },
  });
  expect(grants['connector']).toEqual({
    title: 'Connectors',
    description: expect.any(String),
    operations: ['list', 'all', 'put', 'remove', 'host'],
    groups: { read: ['list', 'all'], write: ['put', 'remove', 'host'] },
  });
  await close();
});

it('advertises the connectors channel with connector:list as its gate', async () => {
  const { host, users, close } = await served();
  const bo = await as(host, users, 'bo');
  const channels = bo.ready['_meta']?.['ahpd.channels'] as Bag[];

  // One catalog for every reader, and the grant a subscribe needs is the one
  // a person making their own connector holds.
  expect(channels).toContainEqual({
    scheme: 'x-ahpd-connectors',
    title: 'Connectors',
    description: 'The connectors made from the adapters this host serves.',
    grant: 'connector:list',
  });
  await close();
});

it('refuses a config the adapter\'s schema refuses, and an unregistered adapter', async () => {
  const { host, users, collection, opened, close } = await served();
  const cy = await as(host, users, 'cy');

  expect(await cy.call('x-ahpd/connectors/put', { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: {} }))
    .toMatchObject({ code: -32602, message: 'connector ci.target is required' });
  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a', extra: true },
  })).toMatchObject({ code: -32602 });
  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'ghost', owner: 'user:cy', config: { target: 'a' },
  })).toMatchObject({ code: -32602 });
  expect(await collection.list()).toEqual([]);
  expect(opened).toEqual([]);
  await close();
});

it('runs an action on an open connector, with the config the adapter was opened with', async () => {
  const { host, users, ran, connectors, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'bot://motion', secret: 'sk-live-1' },
  });

  expect(await connectors.run('ci', await readerOf(users, 'cy'), 'send', { text: 'hello' }))
    .toEqual({ ran: 'send', on: 'ci' });
  // The adapter gets the connector as it was opened, its secret read back.
  expect(ran).toEqual([{
    id: 'ci',
    action: 'send',
    input: { text: 'hello' },
    config: { target: 'bot://motion', secret: 'sk-live-1' },
  }]);
  await close();
});

it('refuses an action on a connector that is not open, or never opened', async () => {
  const { host, users, ran, connectors, close } = await served();
  const cy = await as(host, users, 'cy');
  const reader = await readerOf(users, 'cy');
  await cy.call('x-ahpd/connectors/put', { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  await cy.call('x-ahpd/connectors/remove', { id: 'ci' });

  await expect(connectors.run('ci', reader, 'send', { text: 'x' })).rejects.toThrow('ci is not an open connector');
  await expect(connectors.run('never', reader, 'send', { text: 'x' })).rejects.toThrow('never is not an open connector');
  expect(ran).toEqual([]);
  await close();
});

it('refuses an action to a reader with no connector grant, or to another person', async () => {
  const { host, users, ran, connectors, close } = await served();
  const cy = await as(host, users, 'cy');
  const ha = await as(host, users, 'ha');
  await cy.call('x-ahpd/connectors/put', { id: 'mine', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  await ha.call('x-ahpd/connectors/put', { id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'b' } });

  // A person with no connector grant reads none, their own included.
  await expect(connectors.run('mine', await readerOf(users, 'bo'), 'send', { text: 'x' }))
    .rejects.toThrow("mine is not bo's to use");
  // A lister reads the host's connector and not another person's.
  await expect(connectors.run('mine', await readerOf(users, 'ana'), 'send', { text: 'x' }))
    .rejects.toThrow("mine is not ana's to use");
  expect(await connectors.run('shared', await readerOf(users, 'ana'), 'send', { text: 'x' }))
    .toEqual({ ran: 'send', on: 'shared' });
  // connector:all reads every connector, so it runs every one too.
  expect(await connectors.run('mine', await readerOf(users, 'iv'), 'send', { text: 'x' }))
    .toEqual({ ran: 'send', on: 'mine' });
  expect(ran).toHaveLength(2);
  await close();
});

it('refuses an action the adapter does not declare, and an adapter that runs none', async () => {
  const { host, users, ran, connectors, adapters, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/connectors/put', { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  const reader = await readerOf(users, 'cy');

  // A `receive` capability is not an action, and neither is a name no capability has.
  await expect(connectors.run('ci', reader, 'call', { text: 'x' })).rejects.toThrow('webhook has no action named call');
  await expect(connectors.run('ci', reader, 'nope', { text: 'x' })).rejects.toThrow('webhook has no action named nope');
  // An adapter with no `run` is not asked to run one.
  const webhook = adapters['webhook']!;
  adapters['webhook'] = {
    name: webhook.name,
    title: webhook.title,
    description: webhook.description,
    by: webhook.by,
    schema: webhook.schema,
    capabilities: webhook.capabilities,
    open: webhook.open,
  };
  await expect(connectors.run('ci', reader, 'send', { text: 'x' })).rejects.toThrow('webhook runs no action');
  expect(ran).toEqual([]);
  await close();
});

/*
 * Health: the check an adapter gives, and the calls the host keeps.
 *
 * A refresh a call outcome changes waits, so each of these lets a second pass
 * on a fake clock rather than sleeping.
 */

/** Run `work`, then let the coalesced refresh go out, on a fake clock. */
const onFakeClock = async <T>(work: () => Promise<T>): Promise<T> => {
  vi.useFakeTimers();
  try {
    const answer = await work();
    await vi.advanceTimersByTimeAsync(1000);
    return answer;
  } finally {
    vi.useRealTimers();
  }
};

it('answers a put with the check its adapter ran', async () => {
  const { host, users, probe, close } = await served();
  const cy = await as(host, users, 'cy');

  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' },
  })).toMatchObject({
    result: { state: 'ready', health: { check: { result: 'ok', at: expect.any(String) } } },
  });
  expect(probe.asked).toEqual(['ci']);
  await close();
});

it('keeps a check that throws as failed, with the message the adapter gave', async () => {
  const { host, users, probe, close } = await served();
  probe.answer = async () => { throw new Error('the service said no'); };
  const cy = await as(host, users, 'cy');

  expect(await cy.call('x-ahpd/connectors/put', {
    id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' },
  })).toMatchObject({ result: { health: { check: { result: 'failed', message: 'the service said no' } } } });
  await close();
});

it('answers a check that hangs for ten seconds as unreachable', async () => {
  const { host, users, connectors, probe, close } = await served();
  const ha = await as(host, users, 'ha');
  await ha.call('x-ahpd/connectors/put', { id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a' } });
  // A service that never answers.
  probe.answer = () => new Promise<CheckResult>(() => {});

  vi.useFakeTimers();
  try {
    const answer = ha.call('x-ahpd/connectors/check', { id: 'shared' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await answer).toMatchObject({ result: { health: { check: { result: 'unreachable' } } } });
  } finally {
    vi.useRealTimers();
  }
  // The connector is still open, and the check is the only thing that changed.
  expect((await connectors.run('shared', undefined, 'send', { text: 'x' }))).toEqual({ ran: 'send', on: 'shared' });
  await close();
});

it('keeps a failed run as the last call and the last failure', async () => {
  const { host, users, connectors, adapters, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/connectors/put', { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  const webhook = adapters['webhook']!;
  adapters['webhook'] = { ...webhook, run: async () => { throw new Error('no route'); } };
  const reader = await readerOf(users, 'cy');

  await onFakeClock(async () => {
    await expect(connectors.run('ci', reader, 'send', { text: 'x' })).rejects.toThrow('no route');
  });

  const iv = await as(host, users, 'iv');
  expect((await iv.rows())['ci']).toMatchObject({
    health: {
      check: { result: 'ok' },
      lastCall: { ok: false, error: 'no route', at: expect.any(String) },
      lastFailure: { ok: false, error: 'no route', at: expect.any(String) },
    },
  });
  await close();
});

it('keeps a call a host part notes as the last call, and cuts its error to 500 characters', async () => {
  const { host, users, connectors, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/connectors/put', { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  const iv = await as(host, users, 'iv');

  await onFakeClock(async () => { connectors.note('ci', { ok: true, status: 200 }); });
  expect((await iv.rows())['ci']).toMatchObject({
    health: { check: { result: 'ok' }, lastCall: { ok: true, status: 200, at: expect.any(String) } },
  });
  expect((await iv.rows())['ci']?.['health']).not.toHaveProperty('lastFailure');

  await onFakeClock(async () => { connectors.note('ci', { ok: false, error: 'x'.repeat(600) }); });
  const health = (await iv.rows())['ci']?.['health'];
  expect(health).toMatchObject({ lastCall: { ok: false }, lastFailure: { ok: false } });
  expect(health?.['lastFailure']?.['error']).toHaveLength(500);
  await close();
});

it('sends at most one refresh a second for the outcomes note keeps', async () => {
  const { host, users, connectors, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/connectors/put', { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  const iv = await as(host, users, 'iv');
  // A subscribe answers a snapshot; every later send of the row is one refresh.
  await iv.rows();
  const sends = (): number => iv.seen.filter((one) => one.method === 'action' && one.params['channel'] === URI).length;
  const seeded = sends();

  vi.useFakeTimers();
  try {
    // Five calls in one second are one refresh, and the next call is another.
    for (let one = 0; one < 5; one += 1) connectors.note('ci', { ok: true, status: 200 + one });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sends() - seeded).toBe(1);
    connectors.note('ci', { ok: true, status: 300 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sends() - seeded).toBe(2);
  } finally {
    vi.useRealTimers();
  }
  await close();
});

it('checks each connector when the daemon starts, without waiting for it', async () => {
  const { host, users, collection, connectors, probe, close } = await served();
  await collection.put({ id: 'ci', adapter: 'webhook', owner: 'host', config: { target: 'a' } });

  await connectors.openAll();
  // The check is started and not awaited, so one turn is what lets it finish.
  await new Promise((done) => { setTimeout(done, 0); });

  const iv = await as(host, users, 'iv');
  expect((await iv.rows())['ci']).toMatchObject({ state: 'ready', health: { check: { result: 'ok' } } });
  expect(probe.asked).toEqual(['ci']);
  await close();
});

it('refuses a check to a reader that is not the connector\'s owner', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const ha = await as(host, users, 'ha');
  await cy.call('x-ahpd/connectors/put', { id: 'mine', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  await ha.call('x-ahpd/connectors/put', { id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a' } });

  // A person's connector is that person's to check, and a host's takes connector:host.
  expect(await ha.call('x-ahpd/connectors/check', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(await cy.call('x-ahpd/connectors/check', { id: 'shared' })).toMatchObject({ code: -32009 });
  expect(await cy.call('x-ahpd/connectors/check', { id: 'mine' })).toMatchObject({ result: { id: 'mine' } });
  await close();
});

it('refuses a check of a connector that is not open, or of an adapter that has none', async () => {
  const { host, users, collection, adapters, close } = await served();
  const ha = await as(host, users, 'ha');
  await ha.call('x-ahpd/connectors/put', { id: 'shared', adapter: 'webhook', owner: 'host', config: { target: 'a' } });

  // A stored connector the host did not open.
  await collection.put({ id: 'lost', adapter: 'webhook', owner: 'host', config: { target: 'a' } });
  expect(await ha.call('x-ahpd/connectors/check', { id: 'lost' })).toMatchObject({
    code: -32602,
    message: expect.stringContaining('is not an open connector'),
  });

  // An adapter with no check is not asked to make one.
  const webhook = adapters['webhook']!;
  adapters['webhook'] = {
    name: webhook.name,
    title: webhook.title,
    description: webhook.description,
    by: webhook.by,
    schema: webhook.schema,
    capabilities: webhook.capabilities,
    open: webhook.open,
  };
  expect(await ha.call('x-ahpd/connectors/check', { id: 'shared' })).toMatchObject({
    code: -32602,
    message: 'webhook has no check',
  });
  await close();
});

it('drops a connector\'s health when it is removed, and checks it again when it is made', async () => {
  const { host, users, connectors, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/connectors/put', { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });
  await connectors.run('ci', await readerOf(users, 'cy'), 'send', { text: 'x' });

  await cy.call('x-ahpd/connectors/remove', { id: 'ci' });
  await cy.call('x-ahpd/connectors/put', { id: 'ci', adapter: 'webhook', owner: 'user:cy', config: { target: 'a' } });

  const iv = await as(host, users, 'iv');
  const health = (await iv.rows())['ci']?.['health'];
  // The check is the one the new open gave; the call the old one made is gone.
  expect(health).toMatchObject({ check: { result: 'ok' } });
  expect(health).not.toHaveProperty('lastCall');
  expect(health).not.toHaveProperty('lastFailure');
  await close();
});

/** A channel over one adapter that serves models, one that does not, and a provider that can refuse to answer. */
async function providersServed() {
  const collection: RecordCollection = await memoryRecords().collection('connectors', { format: 'json' });
  const problems: string[] = [];
  const vault = made();
  let broken = false;
  const adapters: Record<string, ServedAdapter> = {
    openrouter: {
      name: 'openrouter',
      title: 'OpenRouter',
      description: 'A provider the proxy calls.',
      by: 'host',
      schema: {
        type: 'object',
        properties: {
          endpoint: { type: 'string' },
          key: { type: 'string', writeOnly: true },
        },
        required: ['endpoint', 'key'],
      },
      capabilities: [{ type: 'models', name: 'models', title: 'Serves models', description: 'Serves models through the proxy.' }],
      open: () => undefined,
      provider: (connector: Connector) => {
        if (broken) throw new Error('the endpoint is missing');
        return {
          endpoint: String(connector.config['endpoint']),
          accepts: ['openai-chat'],
          key: String(connector.config['key']),
        };
      },
    },
    webhook: {
      name: 'webhook',
      title: 'Webhook',
      description: 'Receives calls at a URL.',
      by: 'webhook',
      schema: SCHEMA,
      capabilities: [{ type: 'receive', name: 'call', title: 'Receives calls', description: 'Receives calls at a URL.' }],
      open: () => undefined,
    },
  };
  const connectors = connectorsChannel({
    collection,
    adapters: () => adapters,
    vault: () => vault,
    check,
    onProblem: (line) => { problems.push(line); },
  });
  return { collection, connectors, problems, vault, breakProvider: (on: boolean) => { broken = on; } };
}

it('lists each open connector whose adapter serves models, with its resolved key', async () => {
  const { collection, connectors, vault } = await providersServed();
  await vault.set('host:connector/work/key', 'sk-hosts-own');
  await collection.put({
    id: 'work',
    adapter: 'openrouter',
    owner: 'host',
    config: { endpoint: 'https://openrouter.ai/api/v1', key: { $secret: 'host:connector/work/key' } },
  });
  await collection.put({ id: 'hooks', adapter: 'webhook', owner: 'host', config: { target: 'a' } });
  await connectors.openAll();

  expect(connectors.providers()).toEqual([{
    id: 'work',
    adapter: 'openrouter',
    owner: 'host',
    provider: { endpoint: 'https://openrouter.ai/api/v1', accepts: ['openai-chat'], key: 'sk-hosts-own' },
  }]);
});

it('leaves out a provider connector that is not open', async () => {
  const { collection, connectors, vault } = await providersServed();
  await vault.set('host:connector/work/key', 'sk-hosts-own');
  await collection.put({
    id: 'work',
    adapter: 'openrouter',
    owner: 'host',
    config: { endpoint: 'https://openrouter.ai/api/v1', key: { $secret: 'host:connector/work/key' } },
  });

  expect(connectors.providers()).toEqual([]);
});

it('skips a provider that throws, and says the problem once', async () => {
  const { collection, connectors, problems, breakProvider } = await providersServed();
  await collection.put({
    id: 'work',
    adapter: 'openrouter',
    owner: 'host',
    config: { endpoint: 'https://openrouter.ai/api/v1', key: 'sk-hosts-own' },
  });
  await connectors.openAll();

  breakProvider(true);
  expect(connectors.providers()).toEqual([]);
  expect(connectors.providers()).toEqual([]);
  expect(problems).toEqual(['x-ahpd-connectors: work serves no model: the endpoint is missing']);
});

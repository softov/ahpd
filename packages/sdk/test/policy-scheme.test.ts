import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { fileResources } from '../src/resources.js';
import { filePolicies } from '../src/policies.js';
import { policyProviders } from '../src/policy.js';
import { fileUsers } from '../src/users.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { Write } from '../src/types/resources.js';
import type { Policy } from '../src/types/policies.js';
import type { Users } from '../src/types/users.js';

/*
 * The `policy:` scheme, which is a second door onto the `Policies` port.
 *
 * The store is a real file on disk and the provider writes it, so every case
 * says what the store holds afterwards: what is under test is that a client
 * edits policies the way it edits people, and that the port's rules are the
 * scheme's rules rather than a second set.
 */

let root: string;
let file: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-policy-scheme-'));
  file = join(root, 'policies.json');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** The provider over a store in the config folder, and the store itself. */
const served = () => {
  const store = filePolicies({ file });
  return { store, policy: policyProviders(store).policy! };
};

/** One write, as a client sends it. */
const body = (value: unknown, more: Partial<Write> = {}): Write =>
  ({ data: JSON.stringify(value), encoding: 'utf-8', ...more });

const row = (more: Partial<Policy> = {}): Policy => ({
  id: 'M1',
  scope: 'all',
  kind: 'model',
  effect: 'allow',
  match: { model: ['deepseek/*'], proxy: ['local-vllm'] },
  ...more,
});

/** The JSON a read answered with. */
const read = async (id: string): Promise<Policy> => {
  const answer = await served().policy.read(`policy://${id}`) as { data: string; contentType?: string };
  expect(answer.contentType).toBe('application/json');
  return JSON.parse(answer.data) as Policy;
};

it('lists every row and nothing under one', async () => {
  const { policy, store } = served();
  await store.put(row());
  await store.put(row({ id: 'A2', scope: 'team:backend', kind: 'agent', effect: 'allow', match: { agent: ['claude'] } }));

  // The store's own order, which is the order a client draws the screen in.
  expect(await policy.list('policy://')).toEqual([{ name: 'M1', type: 'file' }, { name: 'A2', type: 'file' }]);
  expect(await policy.resolve('policy://')).toMatchObject({ type: 'directory' });

  // A row is a file whose bytes are its JSON: there is no leaf under one.
  await expect(policy.list('policy://M1')).rejects.toMatchObject({ code: -32008 });
  await expect(policy.resolve('policy://M1/anything')).rejects.toMatchObject({ code: -32008 });
  await expect(policy.read('policy://')).rejects.toMatchObject({ code: -32008 });
  await expect(policy.read('policy://nothing')).rejects.toMatchObject({ code: -32008 });
});

it('reads a row as JSON, and measures the body a write would make', async () => {
  const { policy } = served();
  await policy.write('policy://M1', body(row({ limits: [{ amount: 500, measure: 'usd', period: 'week', pool: 'shared' }] })));

  expect(await read('M1')).toMatchObject({
    id: 'M1', scope: 'all', kind: 'model', effect: 'allow', match: { model: ['deepseek/*'], proxy: ['local-vllm'] },
    limits: [{ amount: 500, measure: 'usd', period: 'week', pool: 'shared' }],
  });
  const held = await policy.resolve('policy://M1');
  expect(held.type).toBe('file');
  expect(held.size).toBe(Buffer.byteLength(JSON.stringify(await read('M1'), null, 2), 'utf8'));
  // No etag, as `people.ts` says why.
  expect(held).not.toHaveProperty('etag');
  // A URI naming no row still has the shape of one, which is what a form drawn
  // before the client has asked for anything needs.
  expect(await policy.resolve('policy://new')).toMatchObject({ type: 'file', size: 0 });
});

it('makes a row and a second write edits it', async () => {
  const { policy, store } = served();
  await policy.write('policy://A2', body(row({
    id: 'ignored', scope: 'team:backend', kind: 'agent', effect: 'allow', match: { agent: ['claude'] },
  })));

  // The URI is the id, so a body naming one is a body saying two things and one
  // of them is the address.
  expect(await read('A2')).toMatchObject({ id: 'A2', scope: 'team:backend', kind: 'agent' });
  await policy.write('policy://A2', body({ effect: 'deny' }));
  expect(await read('A2')).toMatchObject({ scope: 'team:backend', effect: 'deny' });

  // And the second daemon over the same file reads the same row.
  expect(await filePolicies({ file }).get('A2')).toMatchObject({ id: 'A2', effect: 'deny' });
  expect(await store.list()).toHaveLength(1);
});

it('keeps what a body does not name, so a read and a write back changes nothing', async () => {
  const { policy } = served();
  await policy.write('policy://M1', body(row({ limits: [{ amount: 500, measure: 'usd', period: 'week', pool: 'shared' }] })));

  // A form that sends back only what it changed.
  await policy.write('policy://M1', body({ from: '2026-10-22' }));
  const held = await read('M1');
  expect(held).toMatchObject({
    effect: 'allow', match: { model: ['deepseek/*'], proxy: ['local-vllm'] },
    limits: [{ amount: 500, measure: 'usd', period: 'week', pool: 'shared' }],
    from: '2026-10-22T00:00:00.000Z',
  });

  // And the whole row back is the same row.
  const round = await read('M1');
  await policy.write('policy://M1', body(round));
  expect(await read('M1')).toEqual(round);
});

it('refuses a body that is not a row, with the sentence the port would give', async () => {
  const { policy, store } = served();
  for (const text of ['not json', '[]', '"a policy"']) {
    await expect(policy.write('policy://M1', { data: text, encoding: 'utf-8' })).rejects.toMatchObject({ code: -32602 });
  }
  // The port's own rules, not a second set: a `model` row naming an agent is
  // the refusal `checkPolicy` writes, word for word.
  await expect(policy.write('policy://M1', body(row({ match: { model: ['*'], agent: ['claude'] } }))))
    .rejects.toMatchObject({ code: -32602, message: expect.stringContaining('match') });
  await expect(policy.write('policy://M1', body(row({ limits: [{ amount: 1, measure: 'hours', period: 'day', pool: 'each' }] }))))
    .rejects.toMatchObject({ code: -32602, message: expect.stringContaining('measure') });
  // Nothing was written by any of them.
  expect(await store.list()).toEqual([]);
});

it('refuses a write to the root and to anything under a row', async () => {
  const { policy } = served();
  await expect(policy.write('policy://', body(row()))).rejects.toMatchObject({ code: -32602 });
  await expect(policy.write('policy://M1/limits', body(row()))).rejects.toMatchObject({ code: -32602 });
  await expect(policy.remove('policy://')).rejects.toMatchObject({ code: -32602 });
});

it('refuses a createOnly onto an id that is there', async () => {
  const { policy } = served();
  await policy.write('policy://M1', body(row()));
  await expect(policy.write('policy://M1', body(row({ effect: 'deny' }), { createOnly: true })))
    .rejects.toMatchObject({ code: -32010 });
  // The refusal wrote nothing.
  expect(await read('M1')).toMatchObject({ effect: 'allow' });
});

it('takes a row out, and refuses an id nothing holds', async () => {
  const { policy, store } = served();
  await policy.write('policy://M1', body(row()));

  await policy.remove('policy://M1');
  expect(await store.list()).toEqual([]);
  await expect(policy.remove('policy://M1')).rejects.toMatchObject({ code: -32008 });
});

it('refuses a URI in another scheme\'s name', async () => {
  const { policy } = served();
  await expect(policy.read('user://ana')).rejects.toMatchObject({ code: -32609 });
  await expect(policy.list('usage://team:backend')).rejects.toMatchObject({ code: -32609 });
});

it('advertises the manifest a client draws the form from', async () => {
  const { policy } = served();
  const described = policy.describe();
  expect(described).toMatchObject({ title: 'Policies' });
  // The id is the address, so the description is where a client is told so.
  expect(described.description).toContain('policy://<id>');

  const properties = described.manifest?.['properties'] as Record<string, Record<string, unknown>>;
  expect(Object.keys(properties)).toEqual(['scope', 'kind', 'effect', 'match', 'limits', 'pool', 'cap', 'from', 'until']);
  expect(properties['match']?.['type']).toBe('object');
  expect(Object.keys(properties['match']?.['properties'] as object)).toEqual(['model', 'proxy', 'agent', 'computer']);
  expect((properties['limits']?.['items'] as Record<string, unknown>)['type']).toBe('object');
});

/*
 * What the host makes of it, which is about the host rather than about the
 * provider: that `policy` is advertised with what it implements, and that the
 * grant asked for one is the grant whose subject is its name.
 */

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

/** A host with the people schemes and the policy scheme over one store. */
const host = (users: Users) => {
  const store = filePolicies({ file });
  return createHost({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    users,
    policies: store,
    resourceProviders: { ...policyProviders(store) },
  });
};

const signedIn = async (made: ReturnType<typeof host>, directory: Users, as: string) => {
  const secret = await directory.mint(as);
  const client = made.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: 'ahpd://users', token: secret } });
  return client;
};

const call = async (client: Awaited<ReturnType<typeof signedIn>>, method: string, params: Record<string, unknown>) =>
  client.handle({ method, params }).then((result) => ({ result }), (error: { code: number; message: string }) => error);

const directory = (): Users => fileUsers({ path: join(root, 'users.json') });

it('advertises policy on the handshake, with the operations it implements', async () => {
  const client = host(directory()).accept(peer());
  const ready = await client.handle({
    method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as { _meta?: Record<string, Record<string, Record<string, unknown>>> };

  const entry = ready._meta?.['ahpd.resourceProviders']?.['policy'];
  expect(entry).toMatchObject({ title: 'Policies', root: 'policy://', operations: ['get', 'list', 'resolve', 'put', 'delete'] });
  expect(Object.keys(entry?.['manifest'] as object)).toContain('properties');
});

it('lets a role holding policy:read read and refuses the write with nothing written', async () => {
  const users = directory();
  await users.addRole('watcher', ['policy:read']);
  await users.add('ana', ['watcher']);
  const client = await signedIn(host(users), users, 'ana');

  const write = body(row());
  expect(await call(client, 'resourceWrite', { channel: ROOT, uri: 'policy://M1', data: write.data, encoding: 'utf-8' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('policy:put') });

  // The refusal wrote nothing, and a role that may read sees the empty store.
  expect(await filePolicies({ file }).list()).toEqual([]);
  expect(await call(client, 'resourceList', { channel: ROOT, uri: 'policy://' })).toMatchObject({ result: { entries: [] } });
});

it('lets a role holding policy:write write and read it back', async () => {
  const users = directory();
  await users.addRole('keeper', ['policy:read', 'policy:write']);
  await users.add('ana', ['keeper']);
  const client = await signedIn(host(users), users, 'ana');

  const write = body(row());
  expect(await call(client, 'resourceWrite', { channel: ROOT, uri: 'policy://M1', data: write.data, encoding: 'utf-8' }))
    .toMatchObject({ result: {} });
  expect(await call(client, 'resourceRead', { channel: ROOT, uri: 'policy://M1' }))
    .toMatchObject({ result: { data: expect.stringContaining('"id": "M1"') } });
  expect(await filePolicies({ file }).get('M1')).toMatchObject({ id: 'M1', effect: 'allow' });
});

it('refuses a role holding neither, on both', async () => {
  const users = directory();
  await users.add('ana', ['guest']);
  const client = await signedIn(host(users), users, 'ana');

  for (const [method, params, subject] of [
    ['resourceList', { uri: 'policy://' }, 'policy:list'],
    ['resourceRead', { uri: 'policy://M1' }, 'policy:get'],
    ['resourceWrite', { uri: 'policy://M1', data: JSON.stringify(row()), encoding: 'utf-8' }, 'policy:put'],
  ] as const) {
    expect(await call(client, method, { channel: ROOT, ...params }))
      .toMatchObject({ code: -32009, message: expect.stringContaining(subject) });
  }
});
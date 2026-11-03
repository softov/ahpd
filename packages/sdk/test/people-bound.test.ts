/*
 * No one gives a grant they do not hold.
 *
 * Two doors reach the users file over AHP: the `x-ahpd/<domain>/put` and
 * `remove` commands, and a resource write or delete on `user://` and `role://`.
 * Both are asked here, over a real users file, because the rule is the
 * directory's - a case that only tested one door would pass while the other
 * stayed open.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { fileUsers } from '../src/access/users.js';
import { peopleChannels } from '../src/access/people.js';
import { servedRecords } from '../src/resources/recordschannel.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Users } from '../src/types/users.js';

type Bag = Record<string, any>;

/*
 * `mo` may edit people and roles, and the two delete grants are held too.
 *
 * Without them a removal would be refused by the gate before the record's own
 * bound was asked, which is exactly the case that proves nothing.
 */
const MANAGER = ['user:read', 'user:put', 'user:delete', 'role:read', 'role:put', 'role:delete'];

let home: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-people-bound-'));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: { manager: MANAGER, admin: ['*:*'] },
    users: [{ id: 'mo', roles: ['manager'] }, { id: 'ad', roles: ['admin'] }],
  }));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** A host serving the people channels and commands over the file in `home`. */
const served = () => {
  const users = fileUsers({ path: usersFile });
  const lists = peopleChannels(users);
  const records = servedRecords('ahpd', lists.channels, lists.methods);
  const host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resourceProviders: lists.providers,
    channels: records.channels,
    methods: records.methods,
    users,
  });
  return { host, users, close: async () => { lists.close(); await host.close(); } };
};

type Host = ReturnType<typeof createHost>;

const peer = () => ({
  send: () => {}, request: async () => ({}), answered: () => {}, close: () => {}, notify: () => {},
});

type Client = { call(method: string, params: Bag): Promise<Bag>; close(): void };

/** One connection, answering each call with its result or its refusal. */
const clientOf = (host: Host, clientId: string): Client => {
  const client = host.accept(peer());
  const call = async (method: string, params: Bag): Promise<Bag> => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => error as Bag,
  );
  const started = client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  return { call: async (method, params) => { await started; return call(method, params); }, close: () => { client.close(); } };
};

/** A client signed in as `id`. The client id is not the person's, or `user://<id>` would read as that client's own resource and be relayed to it. */
const as = async (host: Host, users: Users, id: string): Promise<Client> => {
  const token = await users.mint(id);
  const client = clientOf(host, `${id}-client`);
  const answer = await client.call('authenticate', { channel: ROOT, resource: users.resource.resource, token });
  expect(answer).toEqual({ result: {} });
  return client;
};

/** The root connection, which holds every grant and hands no reader to a record. */
const root = (host: Host): Client => {
  const client = host.accept(peer(), undefined, true);
  const call = async (method: string, params: Bag): Promise<Bag> => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => error as Bag,
  );
  const started = client.handle({ method: 'initialize', params: { clientId: 'root', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  return { call: async (method, params) => { await started; return call(method, params); }, close: () => { client.close(); } };
};

/** One resource write, as a client sends it. */
const write = (at: Client, uri: string, value: unknown): Promise<Bag> =>
  at.call('resourceWrite', { channel: ROOT, uri, data: JSON.stringify(value), encoding: 'utf-8' });

/** One resource delete, as a client sends it. */
const drop = (at: Client, uri: string): Promise<Bag> =>
  at.call('resourceDelete', { channel: ROOT, uri });

it('refuses a role carrying a grant the caller does not hold, at both doors', async () => {
  const { host, users, close } = served();
  const mo = await as(host, users, 'mo');

  expect(await mo.call('x-ahpd/roles/put', { id: 'boss', record: { grants: ['*:*'] } }))
    .toMatchObject({ code: -32009, message: 'mo may not *:* here' });
  expect(await write(mo, 'role://boss', { grants: ['*:*'] })).toMatchObject({ code: -32009 });

  expect((await users.roles()).map((one) => one.id)).not.toContain('boss');
  await close();
});

it('refuses a caller editing its own role up to everything', async () => {
  const { host, users, close } = served();
  const mo = await as(host, users, 'mo');

  expect(await mo.call('x-ahpd/roles/put', { id: 'manager', record: { grants: ['*:*'] } }))
    .toMatchObject({ code: -32009 });
  expect(await write(mo, 'role://manager', { grants: ['*:*'] })).toMatchObject({ code: -32009 });

  // The role the caller holds is the role it was, not the one it tried to write.
  expect((await users.roles()).find((one) => one.id === 'manager')?.grants).toEqual(MANAGER);
  await close();
});

it('refuses a person the caller would raise above itself, at both doors', async () => {
  const { host, users, close } = served();
  const mo = await as(host, users, 'mo');

  expect(await mo.call('x-ahpd/users/put', { id: 'mo', record: { roles: ['admin'] } }))
    .toMatchObject({ code: -32009, message: 'mo may not *:* here' });
  expect(await write(mo, 'user://mo', { roles: ['admin'] })).toMatchObject({ code: -32009 });

  expect((await users.list()).find((one) => one.id === 'mo')?.roles).toEqual(['manager']);
  await close();
});

it('counts guest as given to a new person whose body names no roles, at both doors', async () => {
  const { host, users, close } = served();
  const mo = await as(host, users, 'mo');

  // A new person given no roles is made `guest`, which holds `session:read`; `mo` does not hold it.
  expect(await mo.call('x-ahpd/users/put', { id: 'cy', record: {} }))
    .toMatchObject({ code: -32009, message: 'mo may not session:read here' });
  expect(await write(mo, 'user://cy', {})).toMatchObject({ code: -32009 });

  expect((await users.list()).some((one) => one.id === 'cy')).toBe(false);
  await close();
});

it('refuses editing or removing a person who holds more than the caller', async () => {
  const { host, users, close } = served();
  const mo = await as(host, users, 'mo');

  expect(await mo.call('x-ahpd/users/put', { id: 'ad', record: { roles: ['admin'] } }))
    .toMatchObject({ code: -32009 });
  expect(await write(mo, 'user://ad', { roles: ['admin'] })).toMatchObject({ code: -32009 });
  expect(await mo.call('x-ahpd/users/remove', { id: 'ad' })).toMatchObject({ code: -32009 });
  expect(await drop(mo, 'user://ad')).toMatchObject({ code: -32009 });

  expect((await users.list()).map((one) => one.id)).toContain('ad');
  await close();
});

it('refuses removing a role that holds more than the caller', async () => {
  const { host, users, close } = served();
  const mo = await as(host, users, 'mo');

  expect(await mo.call('x-ahpd/roles/remove', { id: 'admin' })).toMatchObject({ code: -32009 });
  expect(await drop(mo, 'role://admin')).toMatchObject({ code: -32009 });

  expect((await users.roles()).map((one) => one.id)).toContain('admin');
  await close();
});

it('lets a caller write a role, and give it, out of grants it holds', async () => {
  const { host, users, close } = served();
  const mo = await as(host, users, 'mo');

  expect(await mo.call('x-ahpd/roles/put', { id: 'viewer', record: { grants: ['user:read'] } }))
    .toEqual({ result: {} });
  expect(await mo.call('x-ahpd/users/put', { id: 've', record: { roles: ['viewer'] } }))
    .toEqual({ result: {} });

  // The other door keeps the same rule rather than a looser one.
  expect(await write(mo, 'role://watcher', { grants: ['user:read'] })).toEqual({ result: {} });
  expect(await write(mo, 'user://wa', { roles: ['watcher'] })).toEqual({ result: {} });

  expect((await users.roles()).find((one) => one.id === 'manager')?.grants).toEqual(MANAGER);
  expect(await users.roles()).toEqual(expect.arrayContaining([
    { id: 'viewer', grants: ['user:read'] },
    { id: 'watcher', grants: ['user:read'] },
  ]));
  expect((await users.list()).filter((one) => one.id === 've' || one.id === 'wa').map((one) => one.roles))
    .toEqual([['viewer'], ['watcher']]);
  await close();
});

it('lets an admin and the root connection write any role and any person', async () => {
  const { host, users, close } = served();
  const ad = await as(host, users, 'ad');
  const asRoot = root(host);

  expect(await ad.call('x-ahpd/roles/put', { id: 'power', record: { grants: ['*:*'] } }))
    .toEqual({ result: {} });
  expect(await ad.call('x-ahpd/users/put', { id: 'pe', record: { roles: ['admin'] } }))
    .toEqual({ result: {} });

  // The root connection has no reader to hand, and is bounded by nothing.
  expect(await write(asRoot, 'role://rootrole', { grants: ['*:*'] })).toEqual({ result: {} });
  expect(await write(asRoot, 'user://rp', { roles: ['admin'] })).toEqual({ result: {} });
  expect(await drop(asRoot, 'role://rootrole')).toEqual({ result: {} });

  expect(await users.roles()).toEqual(expect.arrayContaining([{ id: 'power', grants: ['*:*'] }]));
  expect(await users.grantsOfPerson('pe')).toEqual(['*:*']);
  expect(await users.grantsOfPerson('rp')).toEqual(['*:*']);
  await close();
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { peopleProviders } from '../src/people.js';
import { fileResources } from '../src/resources.js';
import { fileUsers } from '../src/users.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { Write } from '../src/types/resources.js';
import type { Users } from '../src/types/users.js';

/*
 * People, teams, projects and roles, as four resource schemes.
 *
 * The directory is a real file on disk and the providers read and write it, so
 * every case says what the file should hold afterwards and the next call reads
 * it again: what is under test is a second door onto the same directory, not a
 * copy of it.
 */

let root: string;
let path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-people-'));
  path = join(root, 'users.json');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const open = () => fileUsers({ path });

/** The four providers over one directory, and the directory itself. */
const served = () => {
  const directory = open();
  return { directory, schemes: peopleProviders(directory) };
};

/** One write, as a client sends it. */
const body = (value: unknown, more: Partial<Write> = {}): Write =>
  ({ data: JSON.stringify(value), encoding: 'utf-8', ...more });

/** The JSON a read answered with. */
const read = async (scheme: string, id: string): Promise<Record<string, unknown>> => {
  const answer = await served().schemes[scheme]!.read(`${scheme}://${id}`) as { data: string; contentType?: string };
  expect(answer.contentType).toBe('application/json');
  return JSON.parse(answer.data) as Record<string, unknown>;
};

it('lists what the directory holds, under each of the four schemes', async () => {
  writeFileSync(path, JSON.stringify({
    roles: { keeper: ['team:read'] },
    teams: [{ id: 'backend' }],
    projects: [{ id: 'ahpd' }],
    users: [{ id: 'ana', roles: ['keeper'], token: '' }],
  }));
  const { schemes } = served();

  for (const [scheme, expected] of [['user', 'ana'], ['team', 'backend'], ['project', 'ahpd'], ['role', 'keeper']] as const) {
    expect(await schemes[scheme]!.list(`${scheme}://`), scheme).toEqual([{ name: expected, type: 'file' }]);
    // The root is a directory and nothing is under a record: there is no leaf
    // in a file whose bytes are its JSON.
    expect(await schemes[scheme]!.resolve(`${scheme}://`), scheme).toMatchObject({ type: 'directory' });
    await expect(schemes[scheme]!.list(`${scheme}://${expected}`), scheme).rejects.toMatchObject({ code: -32008 });
    await expect(schemes[scheme]!.resolve(`${scheme}://${expected}/anything`), scheme).rejects.toMatchObject({ code: -32008 });
  }
  // The root lists what it holds and nothing below it.
  await expect(schemes.user!.read('user://')).rejects.toMatchObject({ code: -32008 });
  // And a record that is not there is absent, whichever scheme names it.
  await expect(schemes.team!.read('team://nobody')).rejects.toMatchObject({ code: -32008 });
  // A URI in another scheme's name is not this provider's to answer, and a
  // URI it cannot read is a bad parameter rather than a refusal: the grant
  // was never the question.
  await expect(schemes.team!.read('project://ahpd')).rejects.toMatchObject({ code: -32602 });
});

it('creates and edits a person, and a body naming no field keeps what was there', async () => {
  const { directory, schemes } = served();
  await directory.addTeam('backend');
  await schemes.user!.write('user://ana', body({ roles: ['member'], memberships: ['backend'] }));

  expect(await read('user', 'ana')).toMatchObject({ id: 'ana', roles: ['member'], memberships: ['backend'], trusted: false });

  // A body naming only a primary leaves the roles and the memberships alone,
  // and a `null` takes the primary away.
  await schemes.user!.write('user://ana', body({ primary: 'backend' }));
  expect(await read('user', 'ana')).toMatchObject({ roles: ['member'], memberships: ['backend'], primary: 'backend' });
  await schemes.user!.write('user://ana', body({ primary: null }));
  const after = await read('user', 'ana');
  expect(after).toMatchObject({ roles: ['member'], memberships: ['backend'] });
  expect(after).not.toHaveProperty('primary');

  // Reading it and writing the same JSON back changes nothing.
  const round = await read('user', 'ana');
  await schemes.user!.write('user://ana', body(round));
  expect(await read('user', 'ana')).toEqual(round);

  // Somebody with no body at all is a guest, which is what `user add` makes of
  // one given no role.
  await schemes.user!.write('user://sam', body({}));
  expect(await read('user', 'sam')).toMatchObject({ roles: ['guest'] });

  // A role the file does not define is the directory's refusal, not a second
  // set of rules: the scheme is another door onto the same file.
  await expect(schemes.user!.write('user://eve', body({ roles: ['nobody'] })))
    .rejects.toMatchObject({ code: -32602 });
  expect(await directory.list()).not.toContainEqual(expect.objectContaining({ id: 'eve' }));
});

it('takes an issuer and a roles-from away when a body says null', async () => {
  const { schemes } = served();
  await schemes.user!.write('user://ana', body({ issuer: 'github', rolesFrom: 'groups' }));
  expect(await read('user', 'ana')).toMatchObject({ issuer: 'github', rolesFrom: 'groups' });

  // A `null` takes one away and leaves the other, which a body naming neither
  // keeps.
  await schemes.user!.write('user://ana', body({ issuer: null }));
  const withoutIssuer = await read('user', 'ana');
  expect(withoutIssuer).not.toHaveProperty('issuer');
  expect(withoutIssuer).toMatchObject({ rolesFrom: 'groups' });
  await schemes.user!.write('user://ana', body({ rolesFrom: null }));
  const without = await read('user', 'ana');
  expect(without).not.toHaveProperty('rolesFrom');
  expect(without).not.toHaveProperty('issuer');

  // A blank string is not named, so it is the one the record already had.
  await schemes.user!.write('user://ana', body({ issuer: 'github', rolesFrom: 'groups' }));
  await schemes.user!.write('user://ana', body({ issuer: '', rolesFrom: '' }));
  expect(await read('user', 'ana')).toMatchObject({ issuer: 'github', rolesFrom: 'groups' });
  await schemes.user!.write('user://ana', body({ roles: ['guest'] }));
  expect(await read('user', 'ana')).toMatchObject({ issuer: 'github', rolesFrom: 'groups', roles: ['guest'] });

  // Somebody made with a `null` holds neither.
  await schemes.user!.write('user://sam', body({ issuer: null, rolesFrom: null }));
  const made = await read('user', 'sam');
  expect(made).not.toHaveProperty('issuer');
  expect(made).not.toHaveProperty('rolesFrom');
});

it('creates and edits a team and a project from their own title', async () => {
  const { directory, schemes } = served();
  await schemes.team!.write('team://backend', body({ title: 'Backend' }));
  await schemes.project!.write('project://ahpd', body({}));

  expect(await schemes.team!.read('team://backend')).toMatchObject({ data: JSON.stringify({ id: 'backend', title: 'Backend' }, null, 2) });
  expect(await directory.teams()).toEqual([{ id: 'backend', title: 'Backend' }]);
  expect(await directory.projects()).toEqual([{ id: 'ahpd' }]);

  // Naming one that is already there sets its title and moves nothing.
  await schemes.team!.write('team://backend', body({ title: 'The backend' }));
  expect(await directory.teams()).toEqual([{ id: 'backend', title: 'The backend' }]);
  await schemes.project!.write('project://ahpd', body({ title: 'ahpd' }));
  expect(await directory.projects()).toEqual([{ id: 'ahpd', title: 'ahpd' }]);
});

it('creates and edits a role from its grants, and refuses one that confers nothing', async () => {
  const { directory, schemes } = served();
  await schemes.role!.write('role://keeper', body({ grants: ['team:read'] }));
  expect(await read('role', 'keeper')).toEqual({ id: 'keeper', grants: ['team:read'] });
  expect(await directory.roles()).toEqual([{ id: 'keeper', grants: ['team:read'] }]);

  // An edit is the whole of the role: the name is the URI and the grants are
  // what is in the body.
  await schemes.role!.write('role://keeper', body({ grants: ['team:read', 'team:write'] }));
  expect(await directory.roles()).toEqual([{ id: 'keeper', grants: ['team:read', 'team:write'] }]);

  // A role that confers nothing holds nothing, and a body naming no grants is
  // said rather than written.
  await expect(schemes.role!.write('role://empty', body({}))).rejects.toMatchObject({ code: -32602 });
  // And an operation no subject this host decides has is refused rather than
  // stored, with the operations it does have named in the refusal.
  await expect(schemes.role!.write('role://broken', body({ grants: ['session:edit'] })))
    .rejects.toMatchObject({ code: -32602, message: expect.stringContaining('create, dispose, rename') });
  // A grant on a scheme this host does not decide is the scheme's own to say
  // what its operations are, so any word is kept - decision
  // `a-grant-names-an-operation-and-read-and-write-are-its-groups`.
  await schemes.role!.write('role://plugin', body({ grants: ['team:edit'] }));
  expect(await read('role', 'plugin')).toEqual({ id: 'plugin', grants: ['team:edit'] });
  expect(await directory.roles()).toEqual([
    { id: 'keeper', grants: ['team:read', 'team:write'] },
    { id: 'plugin', grants: ['team:edit'] },
  ]);
});

it('writes a role of operations, beside one of groups', async () => {
  const { directory, schemes } = served();

  // The two halves a client draws a role editor from, held together: an
  // operation of a subject, and the group that contains another.
  await schemes.role!.write('role://senders', body({ grants: ['session:read', 'chat:send'] }));
  expect(await read('role', 'senders')).toEqual({ id: 'senders', grants: ['session:read', 'chat:send'] });
  expect(await directory.roles()).toEqual([{ id: 'senders', grants: ['session:read', 'chat:send'] }]);

  // And one record of a scheme, which is `get` rather than the `read` group it
  // is in: a person let see one account is not thereby let list them all.
  await schemes.role!.write('role://readers', body({ grants: ['user:get', 'file:read'] }));
  expect(await read('role', 'readers')).toEqual({ id: 'readers', grants: ['user:get', 'file:read'] });
  expect(await directory.roles()).toContainEqual({ id: 'readers', grants: ['user:get', 'file:read'] });
});

it('refuses an operation the subject does not have, naming the ones it does', async () => {
  const { directory, schemes } = served();
  // The refusal is the whole of what lets somebody fix a typo: it lists the
  // subject's operations and the two groups, in the subject's own order.
  const refused = await schemes.role!.write('role://launchers', body({ grants: ['session:launch'] }))
    .then(() => undefined, (error: { code: number; message: string }) => error);
  expect(refused).toMatchObject({ code: -32602 });
  for (const operation of ['dispose', 'list', 'state', 'changes']) {
    expect(refused?.message, operation).toContain(operation);
  }
  // An operation that is another subject's is refused the same way, rather
  // than kept as though this subject had it.
  await expect(schemes.role!.write('role://chatty', body({ grants: ['chat:write', 'session:output'] })))
    .rejects.toMatchObject({ code: -32602, message: expect.stringContaining("is not one of session's operations") });

  // And nothing any of them refused was written.
  expect(await directory.roles()).toEqual([]);
});

it('refuses a body that is not a JSON object, and a write to nothing in particular', async () => {
  const { schemes } = served();
  for (const text of ['not json', '[]', '"a string"']) {
    await expect(schemes.team!.write('team://x', { data: text, encoding: 'utf-8' })).rejects.toMatchObject({ code: -32602 });
  }
  // The URI is the name, so a write to the root names nothing.
  await expect(schemes.team!.write('team://', body({}))).rejects.toMatchObject({ code: -32602 });
  // And there is no leaf under a record.
  await expect(schemes.team!.write('team://backend/title', body({}))).rejects.toMatchObject({ code: -32602 });
  // `createOnly` is the protocol's own word for refusing one that is there.
  await schemes.team!.write('team://backend', body({ title: 'Backend' }));
  await expect(schemes.team!.write('team://backend', body({ title: 'Other' }, { createOnly: true })))
    .rejects.toMatchObject({ code: -32010 });
});

it('takes each kind of record out, and refuses one something still names', async () => {
  const { directory, schemes } = served();
  await schemes.team!.write('team://backend', body({ title: 'Backend' }));
  await schemes.role!.write('role://keeper', body({ grants: ['team:read'] }));
  await schemes.user!.write('user://ana', body({ roles: ['keeper'], memberships: ['backend'] }));

  // A team a membership still names is refused, and it says who: a membership
  // naming a team the file no longer holds is dropped on every read.
  const held = await schemes.team!.remove('team://backend').catch((error: Error) => error);
  expect(held).toMatchObject({
    code: -32602,
    message: 'backend is still a team of ana; take them out of it first',
  });
  expect(await directory.teams()).toEqual([{ id: 'backend', title: 'Backend' }]);

  // The same for a role a record still holds.
  await expect(schemes.role!.remove('role://keeper')).rejects.toMatchObject({ code: -32602 });
  expect(await directory.roles()).toEqual([{ id: 'keeper', grants: ['team:read'] }]);

  // And a person is taken out whatever they hold.
  await schemes.user!.remove('user://ana');
  await schemes.role!.remove('role://keeper');
  await schemes.team!.remove('team://backend');
  expect(await schemes.user!.list('user://')).toEqual([]);
  expect(await schemes.role!.list('role://')).toEqual([]);
  expect(await schemes.team!.list('team://')).toEqual([]);
  // What was refused above is what is gone: the person is out, so the team and
  // the role nobody names are free.
  expect(await directory.list()).toEqual([]);
});

it('answers no credential on any scheme', async () => {
  const { directory, schemes } = served();
  await directory.add('ana', ['admin']);
  // A real secret, so the hash below is a real one to be kept out of an answer.
  expect((await directory.mint('ana')).length).toBeGreaterThan(0);

  expect(await schemes.user!.list('user://')).toEqual([{ name: 'ana', type: 'file' }]);
  const person = await read('user', 'ana');
  expect(person).toMatchObject({ id: 'ana', grants: ['*:*'] });
  expect(person).not.toHaveProperty('token');
  // The metadata says how big the record is and nothing about what is in it.
  expect(JSON.stringify(await schemes.user!.resolve('user://ana'))).not.toMatch(/sha256/);
});

/*
 * What the host makes of the four, which is about the host rather than about
 * the providers: that they are advertised with what each one implements, and
 * that the grant asked for one is the grant whose subject is its name.
 */

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

/** A host with the four schemes and the directory behind them. */
const host = (directory: Users) => createHost({
  path: root,
  agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
  resources: fileResources(),
  users: directory,
  resourceProviders: peopleProviders(directory),
});

/** A client signed in as `as`, over the directory the host was given. */
const signedIn = async (made: ReturnType<typeof host>, directory: Users, as: string) => {
  const secret = await directory.mint(as);
  const client = made.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: 'ahpd://users', token: secret } });
  return client;
};

/** The refusal, or the result, whichever the host answered with. */
const call = async (client: Awaited<ReturnType<typeof signedIn>>, method: string, params: Record<string, unknown>) =>
  client.handle({ method, params }).then((result) => ({ result }), (error: { code: number; message: string }) => error);

it('advertises the four on the handshake, with the operations each implements', async () => {
  const client = host(open()).accept(peer());
  const ready = await client.handle({
    method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as { _meta?: Record<string, Record<string, unknown>> };

  // Every one is the same shape as `computer:`, so a client draws the screen
  // the same way for each - decision `people-are-resource-schemes-with-a-grant-each`.
  for (const [scheme, title] of [['user', 'People'], ['team', 'Teams'], ['project', 'Projects'], ['role', 'Roles']] as const) {
    const entry = ready._meta?.['ahpd.resourceProviders']?.[scheme] as Record<string, unknown> | undefined;
    expect(entry, scheme).toMatchObject({ title, root: `${scheme}://`, operations: ['get', 'list', 'resolve', 'put', 'delete'] });
    // And the create form it draws a body from.
    expect(Object.keys(entry?.['manifest'] as object), scheme).toContain('properties');
  }
});

it('asks each scheme for the subject that is its name', async () => {
  const { directory } = served();
  await directory.addRole('teams', ['team:read', 'team:write']);
  await directory.add('ana', ['teams']);
  const made = host(directory);
  const client = await signedIn(made, directory, 'ana');

  // Teams are named and made, and the other three are somebody else's grant.
  expect(await call(client, 'resourceList', { channel: ROOT, uri: 'team://' })).toMatchObject({ result: { entries: [] } });
  expect(await call(client, 'resourceWrite', { channel: ROOT, uri: 'team://backend', data: '{"title":"Backend"}', encoding: 'utf-8' })).toMatchObject({ result: {} });
  expect(await call(client, 'resourceDelete', { channel: ROOT, uri: 'team://backend' })).toMatchObject({ result: {} });
  for (const [method, params, subject] of [
    ['resourceList', { uri: 'project://' }, 'project:list'],
    ['resourceList', { uri: 'user://' }, 'user:list'],
    ['resourceList', { uri: 'role://' }, 'role:list'],
    ['resourceWrite', { uri: 'user://eve', data: '{}', encoding: 'utf-8' }, 'user:put'],
  ] as const) {
    const refused = await call(client, method, { channel: ROOT, ...params });
    expect(refused, subject).toMatchObject({ code: -32009, message: expect.stringContaining(subject) });
  }
  // And nothing any of those were refused for was written.
  expect(await directory.teams()).toEqual([]);
  expect(await directory.roles()).toEqual([{ id: 'teams', grants: ['team:read', 'team:write'] }]);
});

it('answers a signed-in person their own record, and refuses them another\'s', async () => {
  const { directory } = served();
  // No `user:read` at all, which is what `guest` is.
  await directory.add('ana', ['guest']);
  await directory.add('bob', ['guest']);
  const made = host(directory);
  const client = await signedIn(made, directory, 'ana');

  // Their own, which a client showing somebody their account has to be able to
  // read; one record is `user:get` and the listing of people is `user:list`.
  const mine = await call(client, 'resourceRead', { channel: ROOT, uri: 'user://ana' });
  expect(mine).toMatchObject({ result: { data: expect.stringContaining('"id": "ana"') } });
  expect(await call(client, 'resourceRead', { channel: ROOT, uri: 'user://bob' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('user:get') });
  expect(await call(client, 'resourceList', { channel: ROOT, uri: 'user://' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('user:list') });
  // And their own is still nobody else's: a write to it is `user:put`, own or
  // not, because a person's own record is not something they edit for
  // themselves.
  expect(await call(client, 'resourceWrite', { channel: ROOT, uri: 'user://ana', data: '{}', encoding: 'utf-8' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('user:put') });
});


import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { foldHostOptions, pluginHost } from '../../sdk/src/plugins.js';
import { fileResources } from '../../sdk/src/resources.js';
import { memorySessions } from '../../sdk/src/sessions.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { holds } from '../../sdk/src/users.js';
import { echo } from '../../../examples/echo/agent.js';
import { apply } from '../src/plugin.js';
import { BOT_BODIES, BOT_COLORS } from '../src/record.js';
import type { Agent, Start } from '../../sdk/src/types/agent.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginContext } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Chosen, MessageFrom, Session } from '../../sdk/src/types/session.js';
import type { Grant, Principal, Users } from '../../sdk/src/types/users.js';

/*
 * The scheme the bot plugin serves.
 *
 * A bot is a record a person makes, edits and deletes through the same four
 * commands every resource has: a write to `bot://<slug>` is a bot, a read is
 * its record, a list is the bots a reader may see, and a delete leaves a
 * tombstone behind. What is checked here is the whole of that seam - the gate
 * the host already has, the provider behind it, and the files it keeps.
 */

/** A temporary directory removed after the test that made it. */
let loose: string[] = [];
beforeEach(() => { loose = []; });
afterEach(() => {
  for (const dir of loose) rmSync(dir, { recursive: true, force: true });
  loose = [];
});

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/**
 * A directory whose tokens are decided by hand.
 *
 * A grant is held the way a role holds one - exactly, by a wildcard in either
 * position, or through the group its operation is in - so `bot:*` is every
 * operation of the scheme and `bot:write` is each of the four that write.
 *
 * `members` is what each person belongs to, which is what a write naming a
 * `team:` or `project:` owner is checked against.
 */
const directory = (tokens: Record<string, Grant[]>, members: Record<string, string[]> = {}): Users => ({
  resource: RECORD,
  verify: async (token) => {
    const held = tokens[token];
    if (held === undefined) return undefined;
    const belongs = members[token];
    const person: Principal = {
      id: token,
      roles: ['r'],
      can: (one) => holds(new Set<string>(held), one),
      ...(belongs === undefined ? {} : { memberships: belongs }),
    };
    return person;
  },
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => '',
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/**
 * A host with the bot plugin on it, folded in the way the loader folds it.
 *
 * `people` is false for the host with no users directory, where no connection
 * is anybody: the one host whose writer and reader are both absent.
 */
function made(
  tokens: Record<string, Grant[]> = {},
  members: Record<string, string[]> = {},
  over: Partial<HostOptions> = {},
  people = true,
  extra: Agent[] = [],
) {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bot-'));
  loose.push(root);
  /** Where a bot's own folder goes, which is the plugin's `root` option. */
  const bots = join(root, 'bots');
  const context: PluginContext = {
    path: root,
    paths: [root],
    version: sdkVersion(),
    hostName: 'test',
    configDir: join(root, 'config'),
    log: () => {},
    say: () => {},
  };
  // The sessions this host keeps, which is where a link is checked against:
  // read live off the host rather than held by the plugin, so the two are the
  // same store a running daemon would hand it.
  const sessions = memorySessions();
  const { host: plugin, contribution } = pluginHost('bot', context, { sessions: () => sessions });
  apply(plugin, { root: bots });

  const base: HostOptions = {
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }, ...extra],
    resources: fileResources(),
    sessions,
    ...(people ? { users: directory(tokens, members) } : {}),
    ...over,
  };
  const { options, problems } = foldHostOptions(base, [contribution]);
  return { host: createHost(options), bots, root, problems, sessions };
}

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** A client signed in as `token`, which is what the gate reads a grant off. */
async function as(host: ReturnType<typeof createHost>, token: string): Promise<Client> {
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: token, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token } });
  return client;
}

/**
 * The host's own key: signed in as nobody, and answerable to no grant.
 *
 * A root connection is what the deployment's token gets, and it is the one
 * writer that may name an owner it has no membership for.
 */
async function door(host: ReturnType<typeof createHost>): Promise<Client> {
  const client = host.accept(peer(), undefined, true);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'root', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  return client;
}

/** The result, or the refusal, whichever the host answered with. */
const call = async (client: Client, method: string, params: Bag) => client.handle({ method, params }).then(
  (result) => ({ result: result as Bag }),
  (error: { code: number; message: string; data?: unknown }) => error,
);

const write = (client: Client, uri: string, body: unknown, extra: Bag = {}) =>
  call(client, 'resourceWrite', { uri, data: JSON.stringify(body), ...extra });

/** The result of an answer the test expects to be one, or the refusal it named. */
const got = (answer: Awaited<ReturnType<typeof call>>): Bag => {
  if (!('result' in answer)) throw new Error(`refused: ${answer.code} ${answer.message}`);
  return answer.result;
};

const listing = async (client: Client, uri: string): Promise<string[]> => {
  const answer = got(await call(client, 'resourceList', { uri }));
  const entries = answer['entries'] as { name: string }[] | undefined;
  return (entries ?? []).map((one) => one.name);
};

/** One bot's record as a client reads it, which is what these cases assert on. */
const record = async (client: Client, uri: string): Promise<Bag> => {
  const answer = got(await call(client, 'resourceRead', { uri }));
  expect(answer['encoding']).toBe('utf-8');
  return JSON.parse(String(answer['data'])) as Bag;
};

it('makes a bot from a name alone', async () => {
  const { host, bots } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true })).toEqual({ result: {} });

  const bot = await record(soft, 'bot://motion');
  expect(bot).toMatchObject({
    id: 'motion',
    name: 'Motion',
    labels: [],
    // The maker owns it, and its folder is its own until the session that runs
    // in it makes one.
    owner: 'user:soft',
    workspace: join(bots, 'motion'),
  });
  expect(BOT_BODIES).toContain(bot['body']);
  expect(BOT_COLORS).toContain(bot['color']);
  expect(Date.parse(String(bot['createdAt']))).not.toBeNaN();
  expect(bot['updatedAt']).toBe(bot['createdAt']);
});

it('refuses a second bot on a slug that is taken', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  const again = await write(soft, 'bot://motion', { name: 'Another' }, { createOnly: true });

  expect(again).toMatchObject({ code: -32010 });
  expect((await record(soft, 'bot://motion'))['name']).toBe('Motion');
});

it('refuses a slug that is not one', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  // An upper-case letter, a slash and a name that starts with a digit are all
  // the same refusal: the slug is the URI path, so there is nowhere else for it
  // to be written and nothing for a bad one to fall back to.
  expect(await write(soft, 'bot://Motion', { name: 'Motion' }, { createOnly: true })).toMatchObject({ code: -32602 });
  expect(await write(soft, 'bot://mo/tion', { name: 'Motion' }, { createOnly: true })).toMatchObject({ code: -32602 });
  expect(await write(soft, 'bot://2motion', { name: 'Motion' }, { createOnly: true })).toMatchObject({ code: -32602 });
});

it('offers in the make form every field a write takes, the session among them', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as { _meta?: Record<string, Record<string, unknown>> };

  // The form a client draws a make from, which has to offer what the check
  // takes: a field the check accepts and the form does not offer is one no
  // client can give, and a field the form offers and the check refuses is a
  // form that lies.
  const entry = ready._meta?.['ahpd.resourceProviders']?.['bot'] as Bag | undefined;
  expect(entry).toMatchObject({ title: 'Bot', root: 'bot://' });
  const properties = ((entry?.['manifest'] as Bag)?.['properties'] ?? {}) as Bag;
  expect(Object.keys(properties)).toEqual(expect.arrayContaining([
    'name', 'labels', 'description', 'body', 'color', 'instructions', 'harness', 'model', 'preset',
    'workspace', 'computer', 'session', 'owner',
  ]));
});

it('refuses a body or a colour outside the lists', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', body: 'dragon' }, { createOnly: true }))
    .toMatchObject({ code: -32602 });
  expect(await write(soft, 'bot://motion', { name: 'Motion', color: 'chartreuse' }, { createOnly: true }))
    .toMatchObject({ code: -32602 });
  // And neither of them was made, which is the half a refusal has to mean.
  expect(await call(soft, 'resourceRead', { uri: 'bot://motion' })).toMatchObject({ code: -32008 });
});

it('gives a bot its own folder, and refuses one another bot has', async () => {
  const { host, bots } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  expect((await record(soft, 'bot://motion'))['workspace']).toBe(join(bots, 'motion'));

  // Two bots in one folder would be two sessions working in the same tree,
  // which is the one thing the folder is for.
  const taken = await write(soft, 'bot://other', { name: 'Other', workspace: join(bots, 'motion') }, { createOnly: true });
  expect(taken).toMatchObject({ code: -32602 });

  // And a bot whose folder somebody named keeps it.
  await write(soft, 'bot://other', { name: 'Other', workspace: join(bots, 'elsewhere') }, { createOnly: true });
  expect((await record(soft, 'bot://other'))['workspace']).toBe(join(bots, 'elsewhere'));

  // A named folder is one under the plugin's root, never one beside it.
  for (const outside of [join(bots, '..', 'escaped'), bots, '/tmp/anywhere']) {
    const refused = await write(soft, 'bot://third', { name: 'Third', workspace: outside }, { createOnly: true });
    expect(refused).toMatchObject({ code: -32602 });
  }
});

it('edits a bot, keeping the slug it was made with', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  const before = await record(soft, 'bot://motion');

  // The way a client edits: read the record, read the validator with it, and
  // write both back - so a second writer who got there first is a conflict
  // rather than a lost update.
  const at = got(await call(soft, 'resourceResolve', { uri: 'bot://motion' }));
  expect(await write(soft, 'bot://motion', { name: 'Moved' }, { ifMatch: String(at['etag']) }))
    .toEqual({ result: {} });

  const after = await record(soft, 'bot://motion');
  expect(after).toMatchObject({ id: 'motion', name: 'Moved', owner: 'user:soft', createdAt: before['createdAt'] });

  // A write against a validator that is not the bot's own is refused, and the
  // bot is left as it was.
  expect(await write(soft, 'bot://motion', { name: 'Stale' }, { ifMatch: 'not-this-one' }))
    .toMatchObject({ code: -32011 });
  expect((await record(soft, 'bot://motion'))['name']).toBe('Moved');

  // And an edit may not name another bot, or another owner: both are the slug
  // and the maker, which a write is not a way to change.
  expect(await write(soft, 'bot://motion', { name: 'Moved', id: 'other' })).toMatchObject({ code: -32602 });
  expect(await write(soft, 'bot://motion', { name: 'Moved', owner: 'user:ana' })).toMatchObject({ code: -32602 });
});

it('leaves a tombstone where a bot was deleted', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  expect(await call(soft, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });

  // Gone from the listing, gone to a read, and never made again: the slug is
  // what a client had the address of, so a different bot under it would be a
  // different bot answering to a name somebody already knows.
  expect(await listing(soft, 'bot://')).toEqual([]);
  expect(await call(soft, 'resourceRead', { uri: 'bot://motion' })).toMatchObject({ code: -32008 });
  expect(await write(soft, 'bot://motion', { name: 'Again' }, { createOnly: true })).toMatchObject({ code: -32010 });
});

/*
 * The session a bot is linked to.
 *
 * A bot is talked to in its session, so `session` is a link to one this host
 * already has - and only to one that belongs to the bot's own owner. A bot
 * whose record pointed at somebody else's conversation would be work put into
 * a place its writer has no business being.
 */
it('keeps a link to a session of the bot\'s owner, and a read gives it back', async () => {
  const { host, sessions } = made({ soft: ['bot:*', 'session:create'] });
  // The host opened this one for soft, which is what a link is checked against.
  sessions.setOwner('one', 'user:soft');
  const soft = await as(host, 'soft');

  const answer = await write(soft, 'bot://motion', { name: 'Motion', session: 'claude:/one' }, { createOnly: true });
  expect(answer).toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['session']).toBe('claude:/one');
});

it('refuses a link to a session of another person', async () => {
  const { host, sessions } = made({ soft: ['bot:*', 'session:create'] });
  sessions.setOwner('one', 'user:ana');
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', session: 'claude:/one' }, { createOnly: true }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('claude:/one') });
  // And nothing was made, which is the half a refusal has to mean.
  expect(await listing(soft, 'bot://')).toEqual([]);
});

it('refuses a link to a session that is not there', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', session: 'claude:/nowhere' }, { createOnly: true }))
    .toMatchObject({ code: -32602, message: expect.stringContaining('claude:/nowhere') });
  expect(await listing(soft, 'bot://')).toEqual([]);
});

it('takes the link away when an edit sets the session to null', async () => {
  const { host, sessions } = made({ soft: ['bot:*', 'session:create'] });
  sessions.setOwner('one', 'user:soft');
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion', session: 'claude:/one' }, { createOnly: true });

  // `null` is the link taken away, and it is a different body from one that
  // leaves the key out: an edit of the name is not an edit of this.
  expect(await write(soft, 'bot://motion', { name: 'Moved', session: null })).toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['session']).toBeUndefined();
});

it('leaves the link alone when an edit says nothing about it', async () => {
  const { host, sessions } = made({ soft: ['bot:*', 'session:create'] });
  sessions.setOwner('one', 'user:soft');
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion', session: 'claude:/one' }, { createOnly: true });

  // The session is gone from this host and the link stays: a write that did
  // not mention it is not a write that moved it.
  sessions.forget('one');
  expect(await write(soft, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['session']).toBe('claude:/one');
});

it('shows a bot to its owner, to their team, and to whoever holds the grant', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], ana: ['bot:write', 'session:create'], rob: ['bot:get', 'bot:list'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // Not hers, and nothing of this scheme held: refused, and not in a listing
  // either - a list that showed a bot a read would refuse is a list of names
  // its reader cannot open.
  const ana = await as(host, 'ana');
  expect(await call(ana, 'resourceRead', { uri: 'bot://motion' })).toMatchObject({ code: -32009 });
  expect(await listing(ana, 'bot://')).toEqual([]);

  // `bot:write` alone is enough to make one of her own, and hers is what she is
  // shown.
  expect(await write(ana, 'bot://hers', { name: 'Hers' }, { createOnly: true })).toEqual({ result: {} });
  expect(await listing(ana, 'bot://')).toEqual(['hers']);

  // And the grant is the other way in: whoever may read every bot reads this
  // one, which is what makes a scheme the host's own rather than each maker's.
  const rob = await as(host, 'rob');
  expect((await record(rob, 'bot://motion'))['name']).toBe('Motion');
  expect(await listing(rob, 'bot://')).toEqual(['hers', 'motion']);
});

/*
 * Who a bot may be made for.
 *
 * A bot belongs to a person, or to a team or a project they are part of, and
 * the last two are the writer's to name only where they are the writer's own.
 * The rule is the read road's, so what a write may make is what its maker may
 * then read.
 */
it('lets a member of a team make a bot the team owns', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] }, { soft: ['backend'] });
  const soft = await as(host, 'soft');

  const answer = await write(soft, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true });
  expect(answer).toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['owner']).toBe('team:backend');
});

it('refuses a bot for a team the writer is not in', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] }, { soft: ['frontend'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true }))
    .toMatchObject({ code: -32009 });
  // And nothing was made: a refused write leaves no bot behind it.
  expect(await listing(soft, 'bot://')).toEqual([]);
});

it('lets a member of a project make a bot the project owns', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] }, { soft: ['shop:website'] });
  const soft = await as(host, 'soft');

  const answer = await write(soft, 'bot://storefront', { name: 'Storefront', owner: 'project:shop:website' }, { createOnly: true });
  expect(answer).toEqual({ result: {} });
  expect((await record(soft, 'bot://storefront'))['owner']).toBe('project:shop:website');
});

it('refuses a bot for a project the writer is not in', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] }, { soft: ['shop:billing'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://storefront', { name: 'Storefront', owner: 'project:shop:website' }, { createOnly: true }))
    .toMatchObject({ code: -32009 });
  expect(await listing(soft, 'bot://')).toEqual([]);
});

/*
 * Who may change a bot that is already there.
 *
 * Making one is any holder of the grant a write asks for. Changing one is the
 * four ways in: its owner, a member of the team or project it belongs to, an
 * admin, and this host. The instructions on a bot are run in a session owned by
 * whoever it belongs to, so the grant that makes one may not reach into
 * somebody else's - and neither may a read of every bot.
 */
it('refuses an edit and a delete to a bot whose writer it is not', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], ana: ['bot:write'], rob: ['bot:*'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion', instructions: 'Be calm' }, { createOnly: true });

  // `bot:write` is the group a write and a delete both ask the host for, so the
  // gate lets all four of these through and the bot is what refuses them.
  const ana = await as(host, 'ana');
  expect(await write(ana, 'bot://motion', { name: 'Ana was here' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('motion') });
  expect(await call(ana, 'resourceDelete', { uri: 'bot://motion' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('motion') });

  // And every operation on this scheme is not the grant that is every grant: a
  // holder of `bot:*` may make a bot of their own and change no other.
  const rob = await as(host, 'rob');
  expect(await write(rob, 'bot://motion', { name: 'Rob was here' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('motion') });
  expect(await call(rob, 'resourceDelete', { uri: 'bot://motion' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('motion') });

  // Both of them left it exactly as it was.
  expect(await record(soft, 'bot://motion')).toMatchObject({ name: 'Motion', instructions: 'Be calm' });
});

it('lets the owner edit and delete their own bot', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  expect(await write(soft, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['name']).toBe('Moved');
  expect(await call(soft, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
  expect(await listing(soft, 'bot://')).toEqual([]);
});

it('lets a member of the team a bot belongs to change it', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], ana: ['bot:write'] }, { soft: ['backend'], ana: ['backend'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true });

  const ana = await as(host, 'ana');
  expect(await write(ana, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect((await record(ana, 'bot://motion'))['name']).toBe('Moved');
  expect(await call(ana, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
});

it('lets an admin change a bot that is not theirs', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], ana: ['*:*'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  const ana = await as(host, 'ana');
  expect(await write(ana, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect((await record(ana, 'bot://motion'))['name']).toBe('Moved');
  expect(await call(ana, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
});

it('lets the host change any bot', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // The root connection is the host's own key, and it is not a person whose
  // membership of anything could be asked.
  const root = await door(host);
  expect(await write(root, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect(await call(root, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
});

it('lets a host with no users directory change any bot', async () => {
  // No directory means no principal means nobody to ask, so this host is
  // exactly as open as it was before there was an owner to check.
  const { host } = made({}, {}, {}, false);
  const anyone = host.accept(peer());
  await anyone.handle({
    method: 'initialize',
    params: { clientId: 'anyone', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });

  await write(anyone, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  expect(String((await record(anyone, 'bot://motion'))['owner'])).toMatch(/^root:/);
  expect(await write(anyone, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect(await call(anyone, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
});

it('lets the host make a bot for a team it holds no membership of', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const root = await door(host);

  expect(await write(root, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect((await record(root, 'bot://motion'))['owner']).toBe('team:backend');
});

/*
 * The session a bot made with none is given.
 *
 * A bot is talked to in its session, so a bot made with no `session` is one the
 * host opens for it: it runs the bot's preset, or its harness and model, in the
 * bot's own folder, and it opens with the bot's instructions. The session is the
 * bot's owner's, because it is the same session that person could have made.
 */

/** An echo backend under a name, saying what each turn was asked to run on. */
const speaking = (provider: string, seen: Bag[] = []): Agent => {
  const agent = echo({ path: tmpdir(), pace: 0 });
  return {
    ...agent,
    provider,
    displayName: provider,
    create: (start: Start): Session => {
      const session = agent.create(start);
      return {
        ...session,
        begin: (turnId: string, text: string, model?: Chosen, from?: MessageFrom) => {
          seen.push({ text, model: model as Bag | undefined });
          session.begin(turnId, text, model, from);
        },
      };
    },
  };
};

/** The row a client reads for one session, or the failure of it not being there. */
const row = async (client: Client, uri: string): Promise<Bag> => {
  const answer = got(await call(client, 'listSessions', { channel: ROOT }));
  const items = (answer['items'] ?? []) as Bag[];
  const found = items.find((one) => one['resource'] === uri);
  if (found === undefined) throw new Error(`${uri} is in no listing`);
  return found;
};

it('starts a preset session for a bot, even when it also names a harness', async () => {
  const { host } = made({ soft: ['bot:*', 'session:*'] }, {}, {}, true, [
    speaking('loud'),
    speaking('whisper'),
  ]);
  const soft = await as(host, 'soft');

  // A preset is a whole harness of its own, so it wins: `base` is not what runs.
  await write(soft, 'bot://motion', { name: 'Motion', preset: 'loud', harness: 'whisper' }, { createOnly: true });
  const bot = await record(soft, 'bot://motion');
  expect(String(bot['session'])).toMatch(/^loud:\//);
});

it('starts a bot on its harness, with the model it asked for', async () => {
  const seen: Bag[] = [];
  const { host } = made({ soft: ['bot:*', 'session:*'] }, {}, {}, true, [speaking('whisper', seen)]);
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', {
    name: 'Motion', harness: 'whisper', model: 'the-big-one', instructions: 'Be calm',
  }, { createOnly: true });

  const bot = await record(soft, 'bot://motion');
  expect(String(bot['session'])).toMatch(/^whisper:\//);
  // The model rides on the first turn, which is the only place a session has
  // one - the host's own words for it.
  expect(seen.at(-1)).toMatchObject({ text: 'Be calm', model: { id: 'the-big-one' } });
});

it('starts a bot on the host\'s own harness when it names neither', async () => {
  const { host } = made({ soft: ['bot:*', 'session:*'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  expect(String((await record(soft, 'bot://motion'))['session'])).toMatch(/^base:\//);
});

it('runs a bot in its own folder, and makes the folder first', async () => {
  const { host, bots } = made({ soft: ['bot:*', 'session:*'] });
  const soft = await as(host, 'soft');

  const workspace = join(bots, 'motion');
  expect(existsSync(workspace)).toBe(false);
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // The folder is there for the session to work in, and the session says it is
  // where it works: `workspace` is what a make with no folder of its own gets.
  expect(existsSync(workspace)).toBe(true);
  const uri = String((await record(soft, 'bot://motion'))['session']);
  expect((await row(soft, uri))['workingDirectories']).toEqual([`file://${workspace}`]);
});

it('starts a bot with a computer in that computer, in the same path', async () => {
  const { host, bots, sessions } = made({ soft: ['bot:*', 'session:*'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', {
    name: 'Motion', computer: 'computer://box',
  }, { createOnly: true });

  const uri = String((await record(soft, 'bot://motion'))['session']);
  const id = uri.slice(uri.indexOf(':') + 1).replace(/^\/+/, '');
  expect(sessions.config(id)).toMatchObject({ computer: 'computer://box' });
  // And the machine works in the bot's folder, which is the same path on this
  // host: the folder rides along as the session's working directory.
  expect((await row(soft, uri))['workingDirectories']).toEqual([`file://${join(bots, 'motion')}`]);
});

it('opens a bot\'s session with its instructions, and says nothing when it has none', async () => {
  const seen: Bag[] = [];
  const { host } = made({ soft: ['bot:*', 'session:*'] }, {}, {}, true, [speaking('whisper', seen)]);
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion', harness: 'whisper', instructions: 'Be calm' }, { createOnly: true });
  expect(seen.map((one) => one['text'])).toEqual(['Be calm']);

  // A bot with nothing to say asks for a session that opens silent, and a turn
  // with no text in it is an empty bubble rather than no turn.
  await write(soft, 'bot://quiet', { name: 'Quiet', harness: 'whisper' }, { createOnly: true });
  expect(seen.map((one) => one['text'])).toEqual(['Be calm']);
});

it('leaves no bot behind when the owner may not start the session', async () => {
  // `session:create` is the owner's own grant, asked of them by the host before
  // the session is opened - so a bot whose session cannot start is a make that
  // does not happen, rather than a record claiming a session it has not got.
  const { host } = made({ soft: ['bot:*'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true }))
    .toMatchObject({ code: -32009, message: 'soft may not session:create here' });
  expect(await listing(soft, 'bot://')).toEqual([]);
  expect(await call(soft, 'resourceRead', { uri: 'bot://motion' })).toMatchObject({ code: -32008 });
});

/*
 * The writes `docs/BOTS.md` prints, sent as the file prints them.
 *
 * The examples in that file are bodies a client may copy, so they are bodies
 * this host has to answer. A change on either side the other did not follow is
 * a doc that has stopped being true.
 */
it('answers the writes docs/BOTS.md shows', async () => {
  const { host, sessions } = made({ soft: ['bot:*', 'session:*'] }, {}, {}, true, [speaking('claude')]);
  // The session the file's link example names, which the host has for soft.
  sessions.setOwner('6f1c0b6e-2a5a-4a1e-9a4a-0f0e0b1c0d0e', 'user:soft');
  const soft = await as(host, 'soft');

  // A make from a name alone.
  expect(await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true })).toEqual({ result: {} });

  // A bot on a harness of its own, with a body and a colour of its choosing.
  expect(await write(soft, 'bot://reader', {
    name: 'Motion',
    labels: ['review', 'ci'],
    description: 'Reads pull requests and says what would break.',
    body: 'robot',
    color: 'teal',
    instructions: 'You review pull requests. Say what would break, in one paragraph.',
    harness: 'claude',
    model: 'claude-sonnet-5',
  }, { createOnly: true })).toEqual({ result: {} });
  expect(await record(soft, 'bot://reader')).toMatchObject({
    body: 'robot', color: 'teal', harness: 'claude', model: 'claude-sonnet-5',
  });

  // A link to a session its owner already has, and the link taken away.
  expect(await write(soft, 'bot://reader', { session: 'claude:/6f1c0b6e-2a5a-4a1e-9a4a-0f0e0b1c0d0e' }))
    .toEqual({ result: {} });
  expect((await record(soft, 'bot://reader'))['session']).toBe('claude:/6f1c0b6e-2a5a-4a1e-9a4a-0f0e0b1c0d0e');

  expect(await write(soft, 'bot://reader', { session: null })).toEqual({ result: {} });
  expect((await record(soft, 'bot://reader'))['session']).toBeUndefined();
});

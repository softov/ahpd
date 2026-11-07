import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parseYaml, stringifyYaml } from '@cofold/yaml';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { foldHostOptions, pluginHost } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { holds } from '../../sdk/src/access/users.js';
import { echo } from '../../../examples/echo/agent.js';
import { backSessions, chatsOf, named, rowId, sessionsOf, userOf, whose } from '../src/names.js';
import { apply } from '../src/plugin.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Grant, Principal, Users } from '../../sdk/src/types/users.js';

/*
 * The names a bot's chats are addressed by.
 *
 * `bot://<slug>` is the bot, `bot://<slug>/<user>` is one person's main chat
 * with it, and `bot://<slug>/<user>/<name>` is a back session of that chat. What
 * is checked here is the whole of that: the parse of a path, the read that
 * answers one, the listing of the names, and who is refused - because a chat is
 * one person's conversation with a bot, and the bot's record being readable by
 * somebody is not permission to read their conversations.
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

/** A directory whose tokens are decided by hand, as `bot-provider.test.ts` makes one. */
const directory = (tokens: Record<string, Grant[]>): Users => ({
  resource: RECORD,
  verify: async (token) => {
    const held = tokens[token];
    if (held === undefined) return undefined;
    const person: Principal = { id: token, roles: ['r'], can: (one) => holds(new Set<string>(held), one) };
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
 * A host with the bot plugin on it.
 *
 * `people` is false for the host with no users directory, where no connection
 * is anybody: the one host whose reader is this host itself, and so the only
 * one where a path names a machine rather than a person.
 */
function made(tokens: Record<string, Grant[]> = {}, people = true) {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bot-names-'));
  loose.push(root);
  const bots = join(root, 'bots');
  const context: LoaderContext = {
    path: root,
    paths: [root],
    version: sdkVersion(),
    hostName: 'test',
    configDir: join(root, 'config'),
    log: () => {},
    say: () => {},
    // The host's YAML, which a bot's `AGENTS.md` is read and written with.
    parseYaml,
    stringifyYaml,
  };
  const sessions = memorySessions();
  const records = memoryRecords();
  const { host: plugin, contribution } = pluginHost('bot', context, {
    sessions: () => sessions,
    records: () => records,
    alert: () => {},
  });
  apply(plugin, { root: bots });

  const base: HostOptions = {
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    sessions,
    records,
    ...(people ? { users: directory(tokens) } : {}),
  };
  const { options } = foldHostOptions(base, [contribution]);
  return { host: createHost(options), root, bots, records };
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

/** The result, or the refusal, whichever the host answered with. */
const call = async (client: Client, method: string, params: Bag) => client.handle({ method, params }).then(
  (result) => ({ result: result as Bag }),
  (error: { code: number; message: string; data?: unknown }) => error,
);

const got = (answer: Awaited<ReturnType<typeof call>>): Bag => {
  if (!('result' in answer)) throw new Error(`refused: ${answer.code} ${answer.message}`);
  return answer.result;
};

/** One bot's record as a client reads it, which is what a case makes one from. */
const record = async (client: Client, uri: string): Promise<Bag> => {
  const answer = got(await call(client, 'resourceRead', { uri }));
  return JSON.parse(String(answer['data'])) as Bag;
};

/** The names a client is shown for `bot://<slug>/<user>/`. */
const listing = async (client: Client, uri: string): Promise<string[]> => {
  const answer = got(await call(client, 'resourceList', { uri }));
  return ((answer['entries'] ?? []) as Bag[]).map((one) => String(one['name']));
};

/** What that URI resolves to, or the refusal it is owed. */
const resolving = async (client: Client, uri: string) => call(client, 'resourceResolve', { uri });

/** The grants a case needs: read a bot, chat with it, and open the session that is its chat. */
const CHATTER: Grant[] = ['bot:get', 'bot:chat', 'session:create', 'session:read'];

it('names the host itself where a reader is nobody', () => {
  expect(userOf('user:ana')).toBe('ana');
  expect(userOf('root:test')).toBe('test');
  // And back again: the host's own name is the one path that is not a person.
  expect(whose('ana', 'test')).toBe('user:ana');
  expect(whose('test', 'test')).toBe('root:test');
});

it('reads a path under a bot as a chat, a name, or the names', () => {
  // A bot's own address has no path: that is the record, and the read road
  // answers it without asking this.
  expect(named('')).toBeUndefined();
  expect(named('ana')).toEqual({ at: 'chat', user: 'ana' });
  expect(named('ana/')).toEqual({ at: 'sessions', user: 'ana' });
  expect(named('ana/work')).toEqual({ at: 'back', user: 'ana', name: 'work' });
  // Nothing deeper is a place under a bot, and an empty segment is not a name.
  expect(named('ana/work/one')).toBeUndefined();
  expect(named('/ana')).toBeUndefined();
  expect(named('ana/work/')).toBeUndefined();
});

it('makes a row id of the words that name a back session', () => {
  const id = rowId(['motion', 'ana', 'work']);
  expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  expect(id).toBe(rowId(['motion', 'ana', 'work']));
  // Two names whose readable parts meet still get an id each.
  expect(rowId(['motion', 'ana', 'work'])).not.toBe(rowId(['motion', 'ana-work', '']));
  expect(rowId(['motion', 'ana', 'work']).length).toBeLessThanOrEqual(40);
});

it('answers a read of a main chat with the session a read of the bot gives', async () => {
  const { host, records } = made({ soft: ['bot:*', ...CHATTER], ana: CHATTER });
  const soft = await as(host, 'soft');
  got(await call(soft, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));

  const ana = await as(host, 'ana');
  const hers = String((await record(ana, 'bot://motion'))['chat']);
  // The same conversation, named: what a read of the bot hands her is what the
  // path under it answers.
  expect(String((await record(ana, 'bot://motion/ana'))['chat'])).toBe(hers);

  // And it is a session this host holds, of the plugin's own provider, in the
  // chat rows of the bot's own folder.
  const rows = await (await records.collection(chatsOf('motion'))).find({ owner: 'user:ana' });
  expect(rows.map((row) => row['chat'])).toEqual([hers]);
});

it('refuses a main chat to anybody but that person, the bot\'s owner and this host', async () => {
  const { host } = made({
    soft: ['bot:*', ...CHATTER],
    ana: CHATTER,
    rob: ['bot:get', 'bot:chat', 'session:create'],
  });
  const soft = await as(host, 'soft');
  got(await call(soft, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));

  // She signs in before anything is said to her: a session the host opens for
  // somebody is charged to them, and an account this host has never met is
  // refused. What is read here is her chat, which belongs to her.
  await as(host, 'ana');

  // The bot's owner: what is said to a bot is said to a bot of hers.
  expect(await record(soft, 'bot://motion/ana')).toHaveProperty('chat');

  // The host itself, which needs no grant and is nobody.
  const root = host.accept(peer(), undefined, true);
  await root.handle({ method: 'initialize', params: { clientId: 'root', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  expect(await record(root, 'bot://motion/ana')).toHaveProperty('chat');

  // And rob may read the bot, which is not permission to read her conversation
  // with it - nor to see that she has one.
  expect(await call(await as(host, 'rob'), 'resourceRead', { uri: 'bot://motion/ana' }))
    .toMatchObject({ code: -32009 });
});

it('refuses a main chat to its person without the grant to chat', async () => {
  const { host } = made({ soft: ['bot:*', ...CHATTER], ana: ['bot:get', 'session:create', 'session:read'] });
  const soft = await as(host, 'soft');
  got(await call(soft, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));
  // A read of the bot gives her no chat, so the path under it gives her none either.
  const ana = await as(host, 'ana');
  expect(await record(ana, 'bot://motion')).not.toHaveProperty('chat');
  expect(await call(ana, 'resourceRead', { uri: 'bot://motion/ana' })).toMatchObject({ code: -32009 });
});

it('answers a back session by its name, and lists the names', async () => {
  const { host, records } = made({ soft: ['bot:*', ...CHATTER], ana: CHATTER });
  const soft = await as(host, 'soft');
  got(await call(soft, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));

  // A name is what task 03 writes down when a message wakes a session, and
  // nothing else has put one there yet. One collection per bot: the rows of
  // `other` are in the folder of `other`, which is nobody's here to be shown.
  const own = await records.collection(sessionsOf('motion'));
  const elsewhere = await records.collection(sessionsOf('other'));
  const backs = backSessions((bot) => (bot === 'other' ? elsewhere : own));
  await backs.put('motion', 'ana', 'work', 'ahp-session:/woken');
  await backs.put('motion', 'ana', 'reviews', 'ahp-session:/second');
  // Another person's, and another bot's, which are neither hers to be shown.
  await backs.put('motion', 'rob', 'theirs', 'ahp-session:/theirs');
  await backs.put('other', 'ana', 'elsewhere', 'ahp-session:/elsewhere');

  const ana = await as(host, 'ana');
  expect(JSON.parse(String(got(await call(ana, 'resourceRead', { uri: 'bot://motion/ana/work' }))['data'])))
    .toEqual({ session: 'ahp-session:/woken' });
  expect(await listing(ana, 'bot://motion/ana/')).toEqual(['reviews', 'work']);

  // A name no row has is a back session that is not there.
  expect(await call(ana, 'resourceRead', { uri: 'bot://motion/ana/nope' })).toMatchObject({ code: -32008 });
  // And the names of another person's chats with the same bot are not hers to
  // be shown, though she may read the bot they are chats with.
  expect(await call(ana, 'resourceList', { uri: 'bot://motion/rob/' })).toMatchObject({ code: -32009 });
  // And a path that is not one: a bot has nothing under a back session.
  expect(await call(ana, 'resourceRead', { uri: 'bot://motion/ana/work/turn' })).toMatchObject({ code: -32008 });
});

it('keeps a bot\'s own read, and its record, where it was', async () => {
  const { host } = made({ soft: ['bot:*', ...CHATTER] });
  const soft = await as(host, 'soft');
  got(await call(soft, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));

  const bot = await record(soft, 'bot://motion');
  expect(bot).toMatchObject({ id: 'motion', name: 'Motion' });
  expect(String(bot['chat'])).toMatch(/^ahp-session:\//);

  // What is at each of the three places under it, which is what a client
  // checks before opening one.
  expect(await resolving(soft, 'bot://motion')).toMatchObject({ result: { type: 'file' } });
  expect(await resolving(soft, 'bot://motion/soft')).toMatchObject({ result: { type: 'file' } });
  expect(await resolving(soft, 'bot://motion/soft/')).toMatchObject({ result: { type: 'directory' } });
  expect(await resolving(soft, 'bot://motion/soft/nope')).toMatchObject({ code: -32008 });
});

it('names the host\'s own main chat where no connection is anybody', async () => {
  // A host with no users directory: every reader is this host, so the `<user>`
  // of a path is the machine's own name and the main chat is the one a read of
  // the bot answers.
  const { host } = made({}, false);
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'anyone', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  got(await call(client, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));

  const chat = String((await record(client, 'bot://motion'))['chat']);
  expect(String((await record(client, 'bot://motion/test'))['chat'])).toBe(chat);
});

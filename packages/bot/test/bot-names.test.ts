import { loggerOf } from '@ahpd/sdk';
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
import { CHAT_PROVIDER } from '../src/chat.js';
import { backSessions, backTitle, rowId, sessionsOf, userOf } from '../src/names.js';
import { apply } from '../src/plugin.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Grant, Principal, Users } from '../../sdk/src/types/users.js';
import { CONTRACTS } from './manifest.js';

/*
 * The names a bot and its back sessions are kept by.
 *
 * `bot://<slug>` is the bot, whose read is its record and starts nothing, as
 * VS Code's reads answer content. A chat with it is a session a client makes
 * with `createSession`, addressed by the URI the client names, and the back
 * sessions behind it are kept by their names in the bot's own rows. What is
 * checked here is that: the read, the nothing under a bot, the chat a create
 * makes, and the rows.
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

/** A host with the bot plugin on it, and a users directory. */
function made(tokens: Record<string, Grant[]> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bot-names-'));
  loose.push(root);
  const bots = join(root, 'bots');
  const context: LoaderContext = {
    path: root,
    paths: [root],
    version: sdkVersion(),
    hostName: 'test',
    configDir: join(root, 'config'),
    log: loggerOf(() => {}),
    say: () => {},
    // The host's YAML, which a bot's `AGENTS.md` is read and written with.
    parseYaml,
    stringifyYaml,
  };
  const sessions = memorySessions();
  const records = memoryRecords();
  const { host: plugin, contribution } = pluginHost('bot', context, {
    contracts: CONTRACTS,
    sessions: () => sessions,
    records: () => records,
    alert: () => {},
    // A talk runs in the bot's folder, trusted, which the daemon's entry for
    // this plugin allows.
    grants: ['session:trust'],
  });
  apply(plugin, { root: bots });

  const base: HostOptions = {
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    sessions,
    records,
    users: directory(tokens),
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

/** The grants a case needs: read a bot, and make and read the session that is a chat with it. */
const CHATTER: Grant[] = ['bot:get', 'session:create', 'session:read', 'session:write'];

it('names a person by the id after the kind', () => {
  expect(userOf('user:ana')).toBe('ana');
  expect(userOf('root:test')).toBe('test');
});

it('makes a row id of the words that name a back session', () => {
  const id = rowId(['motion', 'ana', 'work']);
  expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  expect(id).toBe(rowId(['motion', 'ana', 'work']));
  // Two names whose readable parts meet still get an id each.
  expect(rowId(['motion', 'ana', 'work'])).not.toBe(rowId(['motion', 'ana-work', '']));
  expect(rowId(['motion', 'ana', 'work']).length).toBeLessThanOrEqual(40);
});

/*
 * A read of a bot is its record and starts nothing, as VS Code's reads answer
 * content (types/common/commands.ts L610-L611 at spec v1.0.0): no chat is named
 * on it and no session is made for the reader.
 */
it('reads a bot as its record alone, and starts nothing', async () => {
  const { host } = made({ soft: ['bot:*', ...CHATTER] });
  const soft = await as(host, 'soft');
  got(await call(soft, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));

  const bot = await record(soft, 'bot://motion');
  expect(bot).toMatchObject({ id: 'motion', name: 'Motion' });
  expect(bot).not.toHaveProperty('chat');
  const listed = got(await call(soft, 'listSessions', {}));
  expect(listed['items'] ?? []).toEqual([]);
});

/*
 * A bot's address is its authority, so nothing is under one and a path-form
 * URI names nothing, as a URL reads the two apart.
 */
it('answers nothing under a bot, and nothing at a path-form address', async () => {
  const { host } = made({ soft: ['bot:*', ...CHATTER] });
  const soft = await as(host, 'soft');
  got(await call(soft, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));

  expect(await call(soft, 'resourceResolve', { uri: 'bot://motion' })).toMatchObject({ result: { type: 'file' } });
  for (const uri of ['bot://motion/soft', 'bot://motion/soft/work', 'bot:/motion']) {
    expect(await call(soft, 'resourceRead', { uri })).toMatchObject({ code: -32008 });
    expect(await call(soft, 'resourceResolve', { uri })).toMatchObject({ code: -32008 });
  }
  expect(await call(soft, 'resourceList', { uri: 'bot://motion/soft/' })).toMatchObject({ code: -32008 });
});

/*
 * A chat with a bot is made the way a session of any agent is: a create on the
 * bot's chat provider, naming the bot in its config, under the URI the client
 * names (types/channels-session/commands.ts L50-L52 at spec v1.0.0).
 */
it('opens a chat with a bot by a create that names the bot', async () => {
  const { host } = made({ soft: ['bot:*', ...CHATTER] });
  const soft = await as(host, 'soft');
  got(await call(soft, 'resourceWrite', {
    uri: 'bot://motion', data: JSON.stringify({ name: 'Motion' }), createOnly: true,
  }));

  got(await call(soft, 'createSession', { channel: 'ahp-session:/talk', provider: CHAT_PROVIDER, config: { bot: 'motion' } }));
  const opened = got(await call(soft, 'subscribe', { channel: 'ahp-session:/talk' }));
  const state = (opened['snapshot'] as Bag)['state'] as Bag;
  expect(state['_meta']).toMatchObject({ 'ahpd.bot': { id: 'motion', name: 'Motion' } });
});

it('keeps a back session by its name, one collection per bot', async () => {
  const records = memoryRecords();
  const own = await records.collection(sessionsOf('motion'));
  const elsewhere = await records.collection(sessionsOf('other'));
  const backs = backSessions((bot) => (bot === 'other' ? elsewhere : own));
  await backs.put('motion', 'ana', 'work', 'ahp-session:/woken');
  await backs.put('motion', 'ana', 'reviews', 'ahp-session:/second');
  await backs.put('other', 'ana', 'elsewhere', 'ahp-session:/elsewhere');

  expect(await backs.get('motion', 'ana', 'work')).toBe('ahp-session:/woken');
  expect(await backs.get('motion', 'ana', 'nope')).toBeUndefined();
  expect((await backs.sessions('motion')).sort()).toEqual(['ahp-session:/second', 'ahp-session:/woken']);
  expect(await backs.sessions('other')).toEqual(['ahp-session:/elsewhere']);
});

it('titles a Back chat @main/<bot>/<person>, with the root and no owner as root', () => {
  expect(backTitle('telly', 'user:softov')).toBe('@main/telly/softov');
  expect(backTitle('telly', 'root:soft-sandbox')).toBe('@main/telly/root');
  expect(backTitle('telly', undefined)).toBe('@main/telly/root');
});

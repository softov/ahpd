import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
import { botChatAgent } from '../src/chat.js';
import { BOTS_DIR } from '../src/names.js';
import { apply } from '../src/plugin.js';
import { botStore } from '../src/store.js';
import type { BotRecord } from '../src/record.js';
import type { LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Grant, Principal, Users } from '../../sdk/src/types/users.js';

/*
 * The `x-ahpd-bots://` catalogue the bot plugin serves.
 *
 * Two people and a team. Each subscribes, and each case asks what each was
 * sent: a snapshot of the bots they may read, then `added`, `changed` and
 * `removed` as bots are made, edited and deleted, and as memberships change.
 */

const CATALOGUE = 'x-ahpd-bots://';

/** A frame as the test reads it, any key at any depth. */
type Bag = Record<string, any>;

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
 * Every grant a person here holds: a bot of their own, and its session.
 *
 * Not `bot:read`, whose `bot:get` reads every bot: a person here subscribes
 * through the channel's `authorize`, as the owner of a bot.
 */
const PERSON: Grant[] = ['bot:write', 'session:create'];

/**
 * A directory whose tokens are decided by hand, and whose memberships a case
 * changes in place. `changed()` is what the users file's watch would say.
 */
const directory = (tokens: Record<string, Grant[]>, members: Record<string, string[]>) => {
  let heard: (() => void) | undefined;
  const users: Users = {
    resource: RECORD,
    verify: async (token) => {
      const held = tokens[token];
      if (held === undefined) return undefined;
      const person: Principal = {
        id: token,
        roles: ['r'],
        can: (one) => holds(new Set<string>(held), one),
        get memberships() { return members[token] ?? []; },
      };
      return person;
    },
    watch: (onChange) => {
      heard = onChange;
      return { close: () => { heard = undefined; } };
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
  };
  return { users, changed: () => { heard?.(); } };
};

/** A host with the bot plugin on it, folded in the way the loader folds it. */
function made(tokens: Record<string, Grant[]>, members: Record<string, string[]> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bot-catalogue-'));
  loose.push(root);
  const context: LoaderContext = {
    path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: join(root, 'config'), log: () => {}, say: () => {},
    // The host's YAML, which a bot's `AGENTS.md` is read and written with.
    parseYaml, stringifyYaml,
  };
  const sessions = memorySessions();
  const records = memoryRecords();
  const { host: plugin, contribution } = pluginHost('bot', context, { sessions: () => sessions, records: () => records });
  const bots = join(root, 'bots');
  apply(plugin, { root: bots });
  const { users, changed } = directory(tokens, members);
  const { options, problems } = foldHostOptions({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    sessions,
    records,
    users,
  }, [contribution]);
  expect(problems).toEqual([]);
  return { host: createHost(options), changed, users, records, bots, root, configDir: join(root, 'config') };
}

type Host = ReturnType<typeof createHost>;

/** What a client was sent on the catalogue, as `type id` lines. */
interface Reader {
  client: ReturnType<Host['accept']>;
  ready: Bag;
  /** Each catalogue action, as `added motion`, `changed motion` or `removed motion`. */
  heard(): string[];
}

/** A client signed in as `token`, under the client id `id`, whose catalogue actions are kept. */
async function as(host: Host, token: string, id = token): Promise<Reader> {
  const seen: { method: string; params: Bag }[] = [];
  const peer: Peer = {
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { seen.push({ method, params: params as Bag }); },
  };
  const client = host.accept(peer);
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as Bag;
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token } });
  const heard = () => seen
    .filter((one) => one.method === 'action' && one.params.channel === CATALOGUE)
    .map((one) => {
      const action = one.params.action as Bag;
      return `${String(action.type).slice('x-ahpd-bots/'.length)} ${String(action.bot?.id ?? action.id)}`;
    });
  return { client, ready, heard };
}

/**
 * Yield until `reader` has heard `line`.
 *
 * A membership change is sent to every reader in one pass, so once one line of
 * it has arrived, whatever else that change sent has arrived too.
 */
const hears = async (reader: Reader, line: string, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (reader.heard().includes(line)) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`never heard ${line}, heard: ${JSON.stringify(reader.heard())}`);
};

const call = async (reader: Reader, method: string, params: Bag) => reader.client.handle({ method, params }).then(
  (result) => ({ result: result as Bag }),
  (error: { code: number; message: string }) => error,
);

/** The bots a subscribe answered, by id. */
const subscribe = async (reader: Reader): Promise<string[]> => {
  const answer = await call(reader, 'subscribe', { channel: CATALOGUE });
  if (!('result' in answer)) throw new Error(`refused: ${answer.code} ${answer.message}`);
  return (answer.result.snapshot.state.bots as Bag[]).map((one) => String(one.id));
};

const write = async (reader: Reader, slug: string, body: Bag): Promise<void> => {
  const answer = await call(reader, 'resourceWrite', { uri: `bot://${slug}`, data: JSON.stringify(body) });
  if (!('result' in answer)) throw new Error(`refused: ${answer.code} ${answer.message}`);
};

it('answers a subscribe that arrives before any bot has been read', async () => {
  const { host, records, bots } = made({ ana: PERSON }, { ana: ['crew'] });
  // A bot a daemon starts with: in the collection, and read by nobody yet. A
  // catalogue answered from a cache that is not loaded would show nothing, and
  // nothing would ever publish what was there all along. Its persona is in its
  // record, which is the copy a load moves into the `AGENTS.md` it makes.
  const collection = await records.collection('bots');
  await collection.put({
    id: 'motion', name: 'Motion', labels: [], body: 'robot', color: 'red',
    workspace: join(bots, 'motion'), owner: 'user:ana',
    createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z',
  });
  const ana = await as(host, 'ana');

  expect(await subscribe(ana)).toEqual(['motion']);
});

it('answers each reader the bots it may read, each as a read of it answers', async () => {
  const { host } = made({ ana: PERSON, bo: PERSON }, { ana: ['crew'], bo: [] });
  const ana = await as(host, 'ana');
  const bo = await as(host, 'bo');
  await write(ana, 'mine', { name: 'Mine' });
  await write(ana, 'crews', { name: 'Crews', owner: 'team:crew' });
  await write(bo, 'his', { name: 'His' });

  expect(await subscribe(ana)).toEqual(['crews', 'mine']);
  expect(await subscribe(bo)).toEqual(['his']);

  const answer = await call(ana, 'subscribe', { channel: CATALOGUE });
  const read = await call(ana, 'resourceRead', { uri: 'bot://mine' });
  if (!('result' in answer) || !('result' in read)) throw new Error('refused');
  const record = (answer.result.snapshot.state.bots as Bag[]).find((one) => one.id === 'mine');
  // The entry is the bot, and a read answers it with `chat` beside it: the chat
  // is the reader's own, opened by the read, so the catalogue holds a bot and
  // not a conversation with one.
  const bot = JSON.parse(String(read.result.data)) as Bag;
  delete bot['chat'];
  expect(record).toEqual(bot);
});

it('sends a make, an edit and a delete to the readers each concerns', async () => {
  const members: Record<string, string[]> = { ana: ['crew'], bo: [] };
  const { host } = made({ ana: PERSON, bo: PERSON }, members);
  const ana = await as(host, 'ana');
  const bo = await as(host, 'bo');
  await write(ana, 'hers', { name: 'Hers' });
  await write(bo, 'his', { name: 'His' });
  await subscribe(ana);
  await subscribe(bo);

  await write(ana, 'motion', { name: 'Motion', owner: 'team:crew' });
  await write(ana, 'motion', { name: 'Motion two' });
  // bo joins the team, and the edit comes before the users file says so:
  // the bot is new to him.
  members.bo = ['crew'];
  await write(ana, 'motion', { name: 'Motion three' });
  await write(ana, 'motion', { name: 'Motion four' });
  // He leaves it: the bot is gone for him.
  members.bo = [];
  await write(ana, 'motion', { name: 'Motion five' });
  await write(ana, 'hers', { name: 'Hers two' });
  members.bo = ['crew'];
  await write(ana, 'motion', { name: 'Motion six' });
  expect(await call(ana, 'resourceDelete', { uri: 'bot://motion' })).toHaveProperty('result');

  expect(ana.heard()).toEqual([
    'added motion', 'changed motion', 'changed motion', 'changed motion', 'changed motion', 'changed hers', 'changed motion', 'removed motion',
  ]);
  expect(bo.heard()).toEqual(['added motion', 'changed motion', 'removed motion', 'added motion', 'removed motion']);
});

it('sends the bots a membership change gives and takes, to that reader alone', async () => {
  const members: Record<string, string[]> = { ana: ['crew'], bo: [] };
  const { host, changed } = made({ ana: PERSON, bo: PERSON }, members);
  const ana = await as(host, 'ana');
  const bo = await as(host, 'bo');
  await write(ana, 'crews', { name: 'Crews', owner: 'team:crew' });
  await write(bo, 'his', { name: 'His' });
  await subscribe(ana);
  expect(await subscribe(bo)).toEqual(['his']);

  members.bo = ['crew'];
  changed();
  await hears(bo, 'added crews');
  // A second word about the same change finds nothing more to send, and the
  // removal after it is what says it was sent nothing.
  changed();
  members.bo = [];
  changed();
  await hears(bo, 'removed crews');

  expect(bo.heard()).toEqual(['added crews', 'removed crews']);
  expect(ana.heard()).toEqual([]);
});

it('sends a membership change only to the person it concerns on a shared client id', async () => {
  const members: Record<string, string[]> = { ana: ['crew'], bo: [] };
  const { host, changed } = made({ ana: PERSON, bo: PERSON }, members);
  const ana = await as(host, 'ana', 'anonymous');
  const bo = await as(host, 'bo', 'anonymous');
  await write(ana, 'crews', { name: 'Crews', owner: 'team:crew' });
  await write(bo, 'his', { name: 'His' });
  await write(ana, 'hers', { name: 'Hers' });
  expect(await subscribe(bo)).toEqual(['his']);
  expect(await subscribe(ana)).toEqual(['crews', 'hers']);

  // Ana leaves the team: only she is sent the removal, and Bo's set stays his.
  members.ana = [];
  changed();
  await hears(ana, 'removed crews');
  members.bo = ['crew'];
  changed();
  await hears(bo, 'added crews');

  expect(ana.heard()).toEqual(['removed crews']);
  expect(bo.heard()).toEqual(['added crews']);
});

it('replays to a reader only what it may read', async () => {
  const { host, users } = made({ ana: PERSON, bo: PERSON }, { ana: [], bo: [] });
  const ana = await as(host, 'ana');
  const bo = await as(host, 'bo');
  await write(bo, 'his', { name: 'His' });
  await write(bo, 'old', { name: 'Old' });
  const answer = await call(bo, 'subscribe', { channel: CATALOGUE });
  if (!('result' in answer)) throw new Error('refused');
  const from = answer.result.snapshot.fromSeq as number;
  bo.client.close();

  await write(ana, 'hers', { name: 'Hers' });
  await write(ana, 'hers', { name: 'Hers again' });
  const desk = await as(host, 'bo', 'bo-desk');
  await write(desk, 'new', { name: 'New' });
  await write(desk, 'his', { name: 'His again' });
  expect(await call(desk, 'resourceDelete', { uri: 'bot://old' })).toHaveProperty('result');

  // Back on a socket that resolved to bo, the way a personal token admits one.
  const person = await users.verify('bo');
  const back = host.accept({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} }, person);
  const replay = await back.handle({
    method: 'reconnect',
    params: { clientId: 'bo', lastSeenServerSeq: from, subscriptions: [CATALOGUE] },
  }) as Bag;
  expect(replay.type).toBe('replay');
  const seen = (replay.actions as Bag[])
    .filter((one) => one.channel === CATALOGUE)
    .map((one) => `${String(one.action.type)} ${String(one.action.bot?.id ?? one.action.id)}`);
  expect(seen).toEqual(['x-ahpd-bots/added new', 'x-ahpd-bots/changed his', 'x-ahpd-bots/removed old']);
});

it('lets in a reader with no bot:read who may read a bot, and refuses one who may read none', async () => {
  const { host } = made({ ana: PERSON, bo: PERSON }, {});
  const ana = await as(host, 'ana');
  const bo = await as(host, 'bo');
  await write(ana, 'mine', { name: 'Mine' });
  expect(await subscribe(ana)).toEqual(['mine']);
  expect(await call(bo, 'subscribe', { channel: CATALOGUE })).toMatchObject({ code: -32009 });
});

it('advertises the catalogue on initialize', async () => {
  const { host } = made({ ana: PERSON });
  const ana = await as(host, 'ana');
  expect(ana.ready._meta?.['ahpd.channels']).toEqual([
    { scheme: 'x-ahpd-bots', title: 'Bots', description: 'Every bot the reader may read, kept current.', grant: 'bot:read' },
  ]);
});

/*
 * The mark a chat's row carries.
 *
 * A chat's log is named by a session id, so the mark on its lines is the only
 * thing in the folder that says which bot it is with. A chat nothing runs is
 * listed from that log, and a client that draws the row without opening it
 * needs the mark there - the same `_meta` a running chat's state carries.
 */

const STAMP = '2026-10-25T00:00:00.000Z';

/** The mark `markOf` sends for a bot, as a log line carries it: under `ahpd.bot`, as VS Code namespaces its keys. */
const mark = (slug: string, name: string, color: string): Bag => ({
  'ahpd.bot': { id: slug, name, color, labels: [], body: 'robot', kind: 'direct' },
});

/** One line in a chat's log, in the folder of the bot it is with. */
const logged = (configDir: string, slug: string, id: string, meta?: Bag): void => {
  const dir = join(configDir, BOTS_DIR, slug, 'logs');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${encodeURIComponent(id)}.jsonl`), `${JSON.stringify({
    id: 't1',
    startedAt: STAMP,
    message: { text: 'Hello', origin: { kind: 'user' } },
    responseParts: [],
    ...(meta === undefined ? {} : { _meta: meta }),
  })}\n`, 'utf8');
};

/** One bot as the store keeps it, with the folder left alone. */
const kept = (patch: Partial<BotRecord> = {}): BotRecord => ({
  id: 'motion', name: 'Motion', labels: [], body: 'robot', color: 'red',
  session: 'work', workspace: join('/', 'tmp', 'work'), owner: 'user:ana',
  createdAt: STAMP, updatedAt: STAMP, ...patch,
});

/** The chat backend over a folder, holding the bots a case made. */
async function backend(configDir: string, bots: BotRecord[] = []) {
  const records = memoryRecords();
  const store = botStore(await records.collection('bots'), await records.collection('bots-gone'), () => {});
  await store.ready();
  for (const bot of bots) await store.put(bot);
  return { agent: botChatAgent(configDir, store), store };
}

/** A folder of this case's own, thrown away after it. */
const folder = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-bot-chat-row-'));
  loose.push(dir);
  return dir;
};

it("lists a chat as the bot is now, not as the log's mark has it", async () => {
  const configDir = folder();
  // A log from before the bot was renamed and recoloured.
  logged(configDir, 'motion', 'one', mark('motion', 'Old name', 'blue'));
  const { agent } = await backend(configDir, [kept({ name: 'Motion', color: 'red' })]);

  const rows = await agent.list!();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: 'one', title: 'Motion' });
  expect(rows[0]?._meta).toEqual({
    'ahpd.bot': { id: 'motion', name: 'Motion', color: 'red', labels: [], body: 'robot', kind: 'direct' },
  });
});

it('reads no bot off a mark written with its keys bare', async () => {
  const configDir = folder();
  logged(configDir, 'motion', 'one', { bot: 'motion', name: 'Motion', color: 'red', labels: [], body: 'robot', kind: 'direct' });
  const { agent, store } = await backend(configDir, [kept({ name: 'Motion', color: 'red' })]);
  await store.remove('motion');

  const rows = await agent.list!();

  expect(rows[0]).toMatchObject({ id: 'one', title: 'one' });
});

it('lists a chat of a deleted bot with the mark its log carries', async () => {
  const configDir = folder();
  logged(configDir, 'motion', 'one', mark('motion', 'Last name', 'blue'));
  const { agent, store } = await backend(configDir, [kept({ name: 'Motion', color: 'red' })]);
  await store.remove('motion');

  const rows = await agent.list!();

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: 'one', title: 'Last name' });
  expect(rows[0]?._meta).toMatchObject({ 'ahpd.bot': { id: 'motion', name: 'Last name', color: 'blue' } });
});

it('finds a chat with the same mark its listing carries', async () => {
  const configDir = folder();
  logged(configDir, 'motion', 'one', mark('motion', 'Motion', 'red'));
  const { agent } = await backend(configDir, [kept()]);

  const rows = await agent.list!();
  const row = await agent.find!('one');

  expect(row).toEqual(rows[0]);
  expect(row?._meta).toEqual(rows[0]?._meta);
});

it('lists a chat whose log carries no mark without a `_meta`', async () => {
  const configDir = folder();
  logged(configDir, 'motion', 'one');
  const { agent } = await backend(configDir);

  const rows = await agent.list!();

  expect(rows).toHaveLength(1);
  expect(rows[0]).not.toHaveProperty('_meta');
});

it('lists a chat that is not running as the bot it is with', async () => {
  const { host, configDir } = made({ ana: [...PERSON, 'session:list'] });
  const ana = await as(host, 'ana');
  // A log a daemon left behind, so the chat is a row and nothing runs it.
  logged(configDir, 'motion', 'one', mark('motion', 'Motion', 'red'));
  await write(ana, 'motion', { name: 'Motion', color: 'red' });

  const answer = await call(ana, 'listSessions', { channel: ROOT });
  if (!('result' in answer)) throw new Error(`refused: ${answer.code} ${answer.message}`);
  const row = (answer.result.items as Bag[]).find((one) => one.resource === 'ahp-session:/one');

  expect(row).toBeDefined();
  expect(row?._meta).toMatchObject({ 'ahpd.bot': { id: 'motion', name: 'Motion', color: 'red' } });
});

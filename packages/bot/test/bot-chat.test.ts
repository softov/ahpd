import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parseYaml, stringifyYaml } from '@cofold/yaml';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { Status } from '../../sdk/src/sessions/catalog.js';
import { foldHostOptions, pluginHost } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { botChatAgent, CHAT_PROVIDER, turns } from '../src/chat.js';
import { BOTS_DIR } from '../src/names.js';
import { apply } from '../src/plugin.js';
import { botStore } from '../src/store.js';
import type { ChatMessage } from '../src/chat.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { Start } from '../../sdk/src/types/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { undeclaredIn } from '../../sdk/test/support/wire.js';
import { callsIn, openedFrom, replayed } from '../../sdk/test/support/replay.js';

/*
 * A chat with a bot is a session with no harness.
 *
 * A person says something to a bot, and what they said has to be kept somewhere
 * the bot can read and answer into. That is this: a session of the `bot-chat`
 * provider, one JSON line per turn in a log under the daemon's own
 * configuration, and nothing running behind it.
 *
 * What is checked here is the two things the log decides - a turn is a line,
 * and a line is what a restarted daemon answers `list`, `find` and `transcript`
 * from - the refusal a chat with a bot that is not there gets, and the turn a
 * chat now holds open: nothing answers this chat by itself, so a turn it begins
 * is over only when the handle over it says so.
 */

/** A temporary directory removed after the test that made it. */
let loose: string[] = [];
beforeEach(() => { loose = []; });
afterEach(() => {
  for (const dir of loose) rmSync(dir, { recursive: true, force: true });
  loose = [];
});

/** What one connection was told, in the order it was told it. */
type Notes = { method: string; params: unknown }[];

const peer = (notes: Notes): Peer => ({
  send: () => {},
  notify: (method, params) => { notes.push({ method, params }); },
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

/** The actions one connection was told about one channel. */
const actions = (notes: Notes, channel: string): Bag[] => notes
  .filter((note) => note.method === 'action')
  .map((note) => note.params as { channel: string; action: Bag })
  .filter((one) => one.channel === channel)
  .map((one) => one.action);

/**
 * A host with the bot plugin on it, and no users directory.
 *
 * No directory is the one host where no connection is anybody, which is what
 * this file wants: who may read a bot, and so who may start a chat with one, is
 * the provider's business and is checked there. Nothing below is a question
 * about a grant.
 */
function made() {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bot-chat-'));
  loose.push(root);
  /** Where a bot's own folder goes, which is the plugin's `root` option. */
  const bots = join(root, 'bots');
  /** The daemon's own configuration, which is where the chats are kept. */
  const configDir = join(root, 'config');
  const context: LoaderContext = {
    path: root,
    paths: [root],
    version: sdkVersion(),
    hostName: 'test',
    configDir,
    log: () => {},
    say: () => {},
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
    // One agent, because a bot that names no harness is started on the host's
    // first one: a host with no agent at all could not answer a write of a bot.
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    sessions,
    records,
  };
  const { options } = foldHostOptions(base, [contribution]);
  return { host: createHost(options), root, bots, configDir, records };
}

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/**
 * A client of this host, signed in as nobody, which is everybody here.
 *
 * `notes` is where what it is told lands, for a test that has to watch an
 * action arrive rather than read the state it left behind.
 */
async function anyone(host: ReturnType<typeof createHost>, notes: Notes = []): Promise<Client> {
  const client = host.accept(peer(notes));
  await client.handle({
    method: 'initialize',
    params: { clientId: 'anyone', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  return client;
}

/** The session every test below works in, as the client that starts it names it. */
const SESSION = 'ahp-session:/one';
/**
 * The same session as this host holds it: the URI the client sent.
 *
 * A session created on `ahp-session:` keeps that name, and the URI a backend is
 * started with is the only one `turns` knows a chat by.
 */
const HELD = SESSION;
const CHAT = 'ahp-chat:/one';

/** A bot, a chat with it, and a client watching that chat. */
async function talkTo(client: Client): Promise<void> {
  await client.handle({
    method: 'resourceWrite',
    params: { uri: 'bot://backer', data: JSON.stringify({ name: 'Backer' }), createOnly: true },
  });
  await client.handle({
    method: 'createSession',
    params: { channel: SESSION, provider: CHAT_PROVIDER, config: { bot: 'backer' } },
  });
  await client.handle({ method: 'subscribe', params: { channel: CHAT } });
}

/** A client says something in the chat. */
const said = (client: Client, turnId: string, text: string): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: CHAT, action: { type: 'chat/turnStarted', turnId, message: { text } } },
});

/** A client holds a message for later. */
const queued = (client: Client, id: string, text: string): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text } } },
});

/** A client takes one back. */
const taken = (client: Client, id: string): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: CHAT, action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id } },
});

/** What the chat's state is, as a client subscribing to it now is told. */
const stateOf = async (client: Client): Promise<Bag> => {
  const opened = await client.handle({ method: 'subscribe', params: { channel: CHAT } }) as {
    snapshot: { state: Bag };
  };
  return opened.snapshot.state;
};

/**
 * The backend over one daemon's folder, and the bots it reads.
 *
 * The agent a restarted daemon has: a restart is nothing in memory and
 * everything on the disk, so this is the whole of what it leaves behind for the
 * chats to be read back from.
 *
 * And the only way to reach a road a client's message never arrives on. A
 * `begin` while a turn is open is refused by the host rather than handed to a
 * backend, so the guard behind that refusal is a method only this can call.
 */
async function backend(configDir: string, records: ReturnType<typeof memoryRecords>, heard?: Parameters<typeof botChatAgent>[2]) {
  // With the host's YAML, so the name a chat is titled with comes from the bot's
  // own `AGENTS.md`, which is where a bot's persona lives.
  const store = botStore(
    await records.collection('bots'),
    await records.collection('bots-gone'),
    () => {},
    { yaml: { parseYaml, stringifyYaml } },
  );
  // A chat is started by a read of `bot://`, which is what loads the store by
  // the time a `create` asks it for a bot. A test asking it directly waits.
  await store.ready();
  return botChatAgent(configDir, store, heard);
}

/** What the call was refused with, or a case that fails because it was allowed. */
const refusalOf = async (run: Promise<unknown>): Promise<{ code?: number; message: string }> =>
  run.then(() => { throw new Error('the call was allowed'); }, (error: { code?: number; message: string }) => error);

/** One line of a chat's log, as it was written, in the folder of the bot it is with. */
const lines = (configDir: string, id: string, bot = 'backer'): Bag[] => readFileSync(join(configDir, BOTS_DIR, bot, 'logs', `${id}.jsonl`), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as Bag);

it('keeps a chat in a log, and answers it again after a restart', async () => {
  const { host, configDir, records } = made();
  const client = await anyone(host);

  await talkTo(client);
  /*
   * Nobody answers this chat here, and saying so is answering it with nothing:
   * the plugin puts its wake on every chat it starts, and a chat whose bot it
   * cannot find is one it ends the turn of at once. That is the state this test
   * is about - it checks the log a chat leaves, not what a message wakes.
   */
  turns(HELD).onMessage = () => { turns(HELD).end(); };
  for (const [turnId, text] of [['t1', 'hello'], ['t2', 'again']] as const) await said(client, turnId, text);

  /*
   * Two turns, and two lines each: the one a turn begins with, which says what
   * was said and nothing about how it went, and the one it ends with. Nobody
   * answers this chat, so each turn is over in the call it began in.
   */
  const kept = lines(configDir, 'one');
  expect(kept.map((one) => one['id'])).toEqual(['t1', 't1', 't2', 't2']);
  expect(kept[0]).toMatchObject({
    message: { text: 'hello', origin: { kind: 'user' } },
    responseParts: [],
    // The bot is on the line so that a listing knows which chat this is, and
    // not on the turn a client is served.
    _meta: { bot: 'backer', name: 'Backer', kind: 'direct' },
  });
  // A turn that has not ended has no ending, which is the whole difference
  // between the line above and the one below.
  expect(kept[0]).not.toHaveProperty('state');
  expect(kept[1]).toMatchObject({ id: 't1', state: 'complete', responseParts: [] });

  // A daemon that restarts has nothing in memory. What it has is the folder.
  const fresh = await backend(configDir, records);

  expect(await fresh.list?.()).toMatchObject([{ id: 'one', title: 'Backer' }]);
  expect(await fresh.find?.('one')).toMatchObject({ id: 'one', title: 'Backer' });

  // Two turns, and not four: the lines are folded back into the turns they are
  // the beginning and the end of.
  const read = await fresh.transcript?.('one');
  expect(read?.map((turn) => turn.message.text)).toEqual(['hello', 'again']);
  // A turn served to a client is the turn: no `_meta`, and no response part -
  // nothing has answered this chat yet.
  expect(read?.[0]).not.toHaveProperty('_meta');
  expect(read?.[0]?.responseParts).toEqual([]);
  expect(read?.[0]?.message.origin).toEqual({ kind: 'user' });
  // A chat this host has no log for is not a chat, which is not the same
  // answer as a chat nothing has been said to.
  expect(await fresh.transcript?.('two')).toBeUndefined();
  expect(await fresh.find?.('two')).toBeUndefined();
});

it('holds a turn open until the handle answers it', async () => {
  const { host, configDir, records } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  const heard: ChatMessage[] = [];
  chat.onMessage = (message) => { heard.push(message); };

  await said(client, 't1', 'hello');

  /*
   * Open: the chat is working, the turn is its `activeTurn`, and the log has
   * the line the turn began with and not one it ended with. Nothing has ended
   * it, and nothing here would - this chat runs no model.
   */
  const running = await stateOf(client);
  expect(running['status']).toBe(Status.InProgress);
  expect(running['activeTurn']).toMatchObject({ id: 't1', message: { text: 'hello' }, responseParts: [] });
  expect(running['turns']).toEqual([]);
  expect(lines(configDir, 'one')).toHaveLength(1);
  expect(actions(notes, CHAT).map((one) => one['type'])).not.toContain('chat/turnComplete');
  // And whoever answers this chat was told what was said, and in which turn.
  expect(heard).toEqual([{ session: HELD, turnId: 't1', text: 'hello' }]);

  chat.reply('hello yourself');

  // Over: the answer is the turn's one part, and the turn is the transcript's.
  const idle = await stateOf(client);
  expect(idle['status']).toBe(Status.Idle);
  expect(idle['activeTurn']).toBeUndefined();
  expect(idle['turns']).toMatchObject([{
    id: 't1',
    state: 'complete',
    responseParts: [{ id: 't1:reply', kind: 'markdown', content: 'hello yourself' }],
  }]);
  // A part, then the turn it belongs to: a part after the end is a part of a
  // turn nobody is holding any more.
  const answered = actions(notes, CHAT).map((one) => one['type']);
  expect(answered.slice(answered.indexOf('chat/responsePart'))).toEqual(['chat/responsePart', 'chat/turnComplete']);

  // The second line is the turn as it ended, and it is what a restart reads.
  const kept = lines(configDir, 'one');
  expect(kept).toHaveLength(2);
  expect(kept[1]).toMatchObject({
    id: 't1',
    state: 'complete',
    responseParts: [{ id: 't1:reply', kind: 'markdown', content: 'hello yourself' }],
  });

  const fresh = await backend(configDir, records);
  const read = await fresh.transcript?.('one');
  expect(read?.[0]?.responseParts).toEqual([{ id: 't1:reply', kind: 'markdown', content: 'hello yourself' }]);
  expect(read?.[0]?.state).toBe('complete');
});

it('ends a turn with a notice, and with a cancellation', async () => {
  const { host, configDir } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  // Somebody answers this chat, and says nothing here: a turn with a listener
  // stays open, which is what leaves the endings below something to end.
  chat.onMessage = () => {};

  await said(client, 't1', 'hello');
  chat.notice('Backer finished without a reply');
  expect((await stateOf(client))['turns']).toMatchObject([{
    id: 't1',
    state: 'complete',
    responseParts: [{ kind: 'systemNotification', content: 'Backer finished without a reply' }],
  }]);

  /*
   * A stop, along the road a client's stop takes: the host reads the turn this
   * chat has open, hands it to `cancel`, and the turn is ended as cancelled -
   * which is what the client that asked is told.
   */
  await said(client, 't2', 'again');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/turnCancelled', turnId: 't2' } },
  });
  expect(actions(notes, CHAT).map((one) => one['type'])).toContain('chat/turnCancelled');
  const state = await stateOf(client);
  expect(state['status']).toBe(Status.Idle);
  expect(state['activeTurn']).toBeUndefined();
  expect(state['turns']).toMatchObject([{ id: 't1' }, { id: 't2', state: 'cancelled', responseParts: [] }]);
  expect(lines(configDir, 'one').at(-1)).toMatchObject({ id: 't2', state: 'cancelled', responseParts: [] });
});

it('turns a steer into a turn of its own', async () => {
  const { host, configDir, records } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  const heard: ChatMessage[] = [];
  chat.onMessage = (message) => { heard.push(message); };

  await said(client, 't1', 'hello');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that' } } },
  });

  /*
   * The open turn ends, and the steered text begins the next one: what a client
   * watching is told is one ending and then a turn of its own, rather than a
   * message folded into a turn it cannot see.
   */
  const life = actions(notes, CHAT).filter((one) => String(one['type']).startsWith('chat/turn'));
  expect(life.map((one) => one['type'])).toEqual(['chat/turnStarted', 'chat/turnComplete', 'chat/turnStarted']);
  const steered = life[2] as Bag;
  expect(steered).toMatchObject({ type: 'chat/turnStarted', message: { text: 'stop that', origin: { kind: 'user' } } });

  // What was steered reaches whoever answers as the new turn rather than after
  // the entry the client held it as.
  expect(heard).toHaveLength(2);
  expect(heard[0]).toEqual({ session: HELD, turnId: 't1', text: 'hello' });
  expect(heard[1]).toMatchObject({ session: HELD, text: 'stop that' });
  expect(typeof heard[1]?.turnId).toBe('string');
  expect(heard[1]?.turnId).not.toBe('t1');
  const steeredId = heard[1]?.turnId as string;

  // The log says the same: the first turn ended complete with no reply, and
  // the steered turn is the one open.
  const kept = lines(configDir, 'one');
  expect(kept.map((one) => one['id'])).toEqual(['t1', 't1', steeredId]);
  expect(kept[1]).toMatchObject({ id: 't1', state: 'complete', responseParts: [] });
  expect(kept[2]).toMatchObject({ id: steeredId, message: { text: 'stop that' } });
  expect(kept[2]).not.toHaveProperty('state');

  chat.reply('done');
  const fresh = await backend(configDir, records);
  const read = await fresh.transcript?.('one');
  expect(read?.map((turn) => turn.message.text)).toEqual(['hello', 'stop that']);
  // The first turn keeps what it held, and the reply is the steered turn's.
  expect(read?.[0]).toMatchObject({ id: 't1', state: 'complete', responseParts: [] });
  expect(read?.[1]?.responseParts).toEqual([{ id: `${steeredId}:reply`, kind: 'markdown', content: 'done' }]);
});

it('answers a steer to the client that sent it, and names it on the turn that takes it in', async () => {
  const { host } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  turns(HELD);

  await said(client, 't1', 'hello');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, clientSeq: 9, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that' } } },
  });

  // The client holds its message until an action with its own origin answers it.
  const answers = notes
    .filter((note) => note.method === 'action')
    .map((note) => note.params as { action: Bag; origin?: { clientSeq: number } })
    .filter((one) => one.origin?.clientSeq === 9);
  expect(answers.map((one) => one.action)).toEqual([
    expect.objectContaining({ type: 'chat/pendingMessageSet', kind: 'steering', id: 's1' }),
  ]);
  // And the turn that takes it in names it, which takes it out of every
  // client's state.
  const started = actions(notes, CHAT).filter((one) => one['type'] === 'chat/turnStarted');
  expect(started.at(-1)).toMatchObject({ queuedMessageId: 's1', message: { text: 'stop that' } });
});

it('keeps the sender of a steered message on its turn', async () => {
  const { host } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  chat.onMessage = () => {};
  const outside = { origin: { kind: 'agent' }, _meta: { 'vscode.chat.delegation': 'other-session' } };

  await said(client, 't1', 'hello');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that', ...outside } } },
  });

  /*
   * The steered turn is the message's own, so it says who sent it rather than
   * falling back to the person at the keyboard.
   */
  const started = actions(notes, CHAT).filter((one) => one['type'] === 'chat/turnStarted');
  expect(started[1]).toMatchObject({ message: { text: 'stop that', ...outside } });
  const state = await stateOf(client);
  expect(state['activeTurn']).toMatchObject({ message: { text: 'stop that', ...outside } });
});

it('keeps a queued message behind a steered turn', async () => {
  const { host } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  const heard: ChatMessage[] = [];
  chat.onMessage = (message) => { heard.push(message); };

  await said(client, 't1', 'hello');
  await queued(client, 'q1', 'and then this');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that' } } },
  });

  // A steer is in front of the queue: the steered turn is open, and what was
  // waiting is still waiting rather than started by the ending.
  const steered = await stateOf(client);
  expect(steered['activeTurn']).toMatchObject({ message: { text: 'stop that' } });
  expect(steered['turns']).toMatchObject([{ id: 't1', state: 'complete' }]);
  expect(steered['queuedMessages']).toMatchObject([{ id: 'q1', message: { text: 'and then this' } }]);
  expect(heard.map((one) => one.text)).toEqual(['hello', 'stop that']);

  // It starts when the steered turn ends, and not before.
  chat.reply('done');
  const after = await stateOf(client);
  expect(after['activeTurn']).toMatchObject({ message: { text: 'and then this' } });
  expect(after['queuedMessages']).toEqual([]);
});

it('reads an old steering line as a turn of its own', async () => {
  const { host, configDir, records } = made();
  const client = await anyone(host);
  await talkTo(client);
  const chat = turns(HELD);
  chat.onMessage = () => {};
  await said(client, 't1', 'hello');

  /*
   * A log written before a steer was a turn of its own: the line names the turn
   * it went into and says nothing about how it went. A reader takes it as the
   * turn it now would be - finished, with that message and no reply - rather
   * than folding it into the turn it steered.
   */
  appendFileSync(
    join(configDir, BOTS_DIR, 'backer', 'logs', 'one.jsonl'),
    `${JSON.stringify({ id: 't1', steering: true, message: { text: 'stop that', origin: { kind: 'user' } } })}\n`,
  );

  const fresh = await backend(configDir, records);
  const read = await fresh.transcript?.('one');
  expect(read?.map((turn) => turn.message.text)).toEqual(['hello', 'stop that']);
  expect(read?.[1]).toMatchObject({ state: 'complete', responseParts: [] });
  // A turn of its own needs an id of its own: the old line names the turn it
  // went into, and the two would otherwise fold into one.
  expect(read?.[1]?.id).not.toBe('t1');
});

it('waits a queued message out, and starts it when the turn in front ends', async () => {
  const { host, configDir } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  const heard: ChatMessage[] = [];
  chat.onMessage = (message) => { heard.push(message); };

  await said(client, 't1', 'hello');
  await queued(client, 'q1', 'and then this');

  /*
   * Waiting: the turn somebody is answering is still the one that was started,
   * and what was queued is not a turn and has not been said to anyone. The log
   * says so too: the one line is the beginning of the turn that is open, and a
   * message that has not begun has none.
   */
  const waiting = await stateOf(client);
  expect(waiting['activeTurn']).toMatchObject({ id: 't1', message: { text: 'hello' } });
  expect(waiting['turns']).toEqual([]);
  expect(waiting['queuedMessages']).toMatchObject([{ id: 'q1', message: { text: 'and then this' } }]);
  expect(heard).toEqual([{ session: HELD, turnId: 't1', text: 'hello' }]);
  expect(lines(configDir, 'one')).toHaveLength(1);

  chat.reply('one');

  // Started: the entry left the queue, and its message is the turn that began -
  // under a turn id of the chat's own, with the entry it was named on it.
  const started = await stateOf(client);
  const next = started['activeTurn'] as Bag;
  expect(started['queuedMessages']).toEqual([]);
  expect(started['turns']).toMatchObject([{ id: 't1', state: 'complete' }]);
  expect(next).toMatchObject({ message: { text: 'and then this' } });
  expect(heard).toEqual([
    { session: HELD, turnId: 't1', text: 'hello' },
    { session: HELD, turnId: String(next['id']), text: 'and then this' },
  ]);
  // And the client is told both ways a queued entry ends: taken out of its
  // queue, and named on the turn it became.
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/pendingMessageRemoved'))
    .toMatchObject([{ kind: 'queued', id: 'q1' }]);
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/turnStarted').map((one) => one['queuedMessageId']))
    .toEqual([undefined, 'q1']);

  chat.reply('two');
  // Two turns, and two lines each: the queued one is a turn of the chat's, kept
  // the same way as the one it waited behind.
  expect(lines(configDir, 'one').map((one) => (one['message'] as Bag)['text']))
    .toEqual(['hello', 'hello', 'and then this', 'and then this']);
});

it('starts what waited in the order the queue was left in', async () => {
  const { host, configDir } = made();
  const client = await anyone(host);
  await talkTo(client);
  const chat = turns(HELD);
  chat.onMessage = () => {};

  await said(client, 't1', 'hello');
  await queued(client, 'q1', 'first asked');
  await queued(client, 'q2', 'second asked');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/queuedMessagesReordered', order: ['q2', 'q1'] } },
  });

  // Applied where it was asked for and read back from the state: the order a
  // client sends is the order the chat holds.
  expect((await stateOf(client))['queuedMessages']).toMatchObject([{ id: 'q2' }, { id: 'q1' }]);

  chat.reply('one');
  expect((await stateOf(client))['activeTurn']).toMatchObject({ message: { text: 'second asked' } });
  chat.reply('two');
  // And the one behind that, which is the rest of what the order said - the
  // queue emptying one turn at a time rather than all at once.
  const last = await stateOf(client);
  expect(last['activeTurn']).toMatchObject({ message: { text: 'first asked' } });
  expect(last['queuedMessages']).toEqual([]);
  chat.reply('three');

  expect(lines(configDir, 'one').map((one) => (one['message'] as Bag)['text'])).toEqual([
    'hello', 'hello', 'second asked', 'second asked', 'first asked', 'first asked',
  ]);
});

it('takes a queued message back, and it is never a turn', async () => {
  const { host, configDir } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  chat.onMessage = () => {};

  await said(client, 't1', 'hello');
  await queued(client, 'q1', 'never said');
  await taken(client, 'q1');

  expect((await stateOf(client))['queuedMessages']).toEqual([]);
  chat.reply('one');

  // One turn in it, and nothing started behind it: what was taken back is a
  // message the chat never heard of, rather than one it says later.
  const idle = await stateOf(client);
  expect(idle['activeTurn']).toBeUndefined();
  expect(idle['turns']).toMatchObject([{ id: 't1', state: 'complete' }]);
  expect(lines(configDir, 'one')).toHaveLength(2);
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/turnStarted')).toHaveLength(1);
});

it('refuses a second message while the answer is still coming', async () => {
  const { host } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  chat.onMessage = () => {};

  await said(client, 't1', 'hello');
  await said(client, 't2', 'and this');

  /*
   * The host's own refusal: a client's message never reaches a session with a
   * turn already open, so it is the host that decides what becomes of it - and
   * what it decides is that the client is told rather than queued. Which is why
   * the guard in `begin` is the second line of defence rather than the one a
   * person meets.
   */
  const refused = notes
    .map((note) => note.params as { rejectionReason?: string; action?: Bag })
    .find((one) => one.rejectionReason !== undefined);
  expect(refused?.rejectionReason).toBe('A turn is running in this chat');
  expect(refused?.action).toMatchObject({ type: 'chat/turnStarted', turnId: 't2' });
  // Nothing of it arrived: one turn, still open, and nobody was told of a second.
  expect((await stateOf(client))['activeTurn']).toMatchObject({ id: 't1' });
});

it('holds a begin behind the open turn rather than taking its place', async () => {
  const { host, configDir, records } = made();
  const client = await anyone(host);
  // The bot, written the way a person writes one. No session is started here:
  // what is tested below is a road into a turn no client's message takes.
  await client.handle({
    method: 'resourceWrite',
    params: { uri: 'bot://backer', data: JSON.stringify({ name: 'Backer' }), createOnly: true },
  });

  const agent = await backend(configDir, records);
  const solo = 'bot-chat:/solo';
  const sent: Bag[] = [];
  // What this backend reads off a `Start`, and nothing more: no model, no
  // machine, and a limit on a client call a chat never makes.
  const start: Start = {
    uri: solo,
    chatUri: 'ahp-chat:/solo',
    settings: { bot: 'backer' },
    schema: () => ({}),
    emit: (_channel: string, action: Bag) => { sent.push(action); },
    clientToolTimeoutMs: 0,
  };
  const session = agent.create(start);
  // Somebody answers this chat, which is what leaves the first turn open.
  turns(solo).onMessage = () => {};

  session.begin('t1', 'hello');
  session.begin('t2', 'and then this');

  // Not replaced: the open turn is still the one that began, and the message
  // after it is waiting rather than a turn of its own.
  expect(session.chatState().activeTurn).toMatchObject({ id: 't1', message: { text: 'hello' } });
  expect(session.chatState().turns).toEqual([]);
  expect(session.chatState().queuedMessages).toMatchObject([{ id: 't2', message: { text: 'and then this' } }]);

  // It begins when the turn in front ends, under the id the client named - the
  // whole difference between a message that waited and one that was dropped.
  turns(solo).reply('one');
  const next = session.chatState();
  expect(next.turns).toMatchObject([{ id: 't1', state: 'complete' }]);
  expect(next.activeTurn).toMatchObject({ id: 't2', message: { text: 'and then this' } });
  expect(next.queuedMessages).toEqual([]);
  expect(sent.map((one) => one['type'])).toEqual([
    'chat/turnStarted',
    'chat/pendingMessageSet',
    'chat/responsePart',
    'chat/turnComplete',
    'chat/pendingMessageRemoved',
    'chat/turnStarted',
  ]);
});

it('shows the back session as a subagent call on each turn', async () => {
  const { host, configDir } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const chat = turns(HELD);
  /** The chat of the back session a message wakes, as the wake knows it. */
  const back = `ahp-chat://default/${Buffer.from('bot:/backer/ana/work', 'utf8').toString('base64url')}`;
  /*
   * What the wake does for a message: the turn it leaves open shows the chat it
   * is waiting on. A steer is a turn of its own, so it wakes the same chat and
   * shows a call of its own rather than a second one in the turn it ended.
   */
  chat.onMessage = () => { chat.working?.(back, 'Backer'); };

  await said(client, 't1', 'hello');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'and this' } } },
  });

  /*
   * The interrupted turn is over, and the call it showed with it: completed,
   * with the chat a client opens. The steered turn is open and waiting on the
   * same chat, by a call of its own.
   */
  const running = await stateOf(client);
  const first = (running['turns'] as Bag[])[0] as Bag;
  expect(first).toMatchObject({ id: 't1', state: 'complete' });
  expect((first['responseParts'] as Bag[])[0]).toMatchObject({
    kind: 'toolCall',
    toolCall: {
      status: 'completed',
      success: true,
      content: [{ type: 'subagent', resource: back, title: 'Backer' }],
    },
  });
  const active = running['activeTurn'] as Bag;
  expect(active['message']).toMatchObject({ text: 'and this' });
  expect(active['responseParts']).toMatchObject([{
    kind: 'toolCall',
    toolCall: {
      toolName: 'subagent',
      displayName: 'Backer',
      status: 'running',
      confirmed: 'not-needed',
      content: [{ type: 'subagent', resource: back, title: 'Backer' }],
      _meta: { toolKind: 'subagent', subagentChatUri: back },
    },
  }]);
  const started = actions(notes, CHAT).filter((one) => ['chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallContentChanged'].includes(String(one['type'])));
  expect(started.map((one) => one['type'])).toEqual([
    'chat/toolCallStart',
    'chat/toolCallReady',
    'chat/toolCallContentChanged',
    'chat/toolCallStart',
    'chat/toolCallReady',
    'chat/toolCallContentChanged',
  ]);
  expect(started[2]?.['content']).toEqual([{ type: 'subagent', resource: back, title: 'Backer' }]);
  expect(started[5]?.['content']).toEqual([{ type: 'subagent', resource: back, title: 'Backer' }]);

  chat.reply('done');

  /*
   * Over, and the call is a part of the finished turn: the one its start
   * appended, completed, and not a second part a response could have added.
   */
  const idle = await stateOf(client);
  const turn = (idle['turns'] as Bag[])[1] as Bag;
  const parts = turn['responseParts'] as Bag[];
  expect(parts).toHaveLength(2);
  expect(parts[0]).toMatchObject({
    kind: 'toolCall',
    toolCall: {
      status: 'completed',
      success: true,
      content: [{ type: 'subagent', resource: back, title: 'Backer' }],
    },
  });
  expect(parts[1]).toMatchObject({ kind: 'markdown', content: 'done' });
  const kinds = actions(notes, CHAT).map((one) => one['type']);
  expect(kinds.slice(-3)).toEqual([
    'chat/toolCallComplete',
    'chat/responsePart',
    'chat/turnComplete',
  ]);
  expect(kinds.filter((one) => one === 'chat/responsePart')).toHaveLength(1);
  // And the line a restart reads holds the same two parts.
  expect(lines(configDir, 'one').at(-1)).toMatchObject({ id: turn['id'], state: 'complete', responseParts: parts });
});

it('sends calls as the protocol declares them, and a late client reads them the same way', async () => {
  const { host } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: CHAT } }));
  const chat = turns(HELD);
  const back = `ahp-chat://default/${Buffer.from('bot:/backer/ana/work', 'utf8').toString('base64url')}`;
  chat.onMessage = () => { chat.working?.(back, 'Backer'); };

  // A client's message as the protocol declares one, with its origin.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello', origin: { kind: 'user' } } } },
  });
  chat.reply('done');

  const late = await client.handle({ method: 'subscribe', params: { channel: CHAT } });
  const calls = ((((late as Bag)['snapshot'] as Bag)['state'] as Bag)['turns'] as Bag[])
    .flatMap((turn) => turn['responseParts'] as Bag[])
    .filter((part) => part['kind'] === 'toolCall');
  expect(calls).toHaveLength(1);
  expect(undeclaredIn([...notes, { asked: 'subscribe', params: { channel: CHAT }, result: late }])).toEqual([]);
  expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, notes, CHAT)));
});

it('refuses a chat with a bot that is not there', async () => {
  const { host } = made();
  const client = await anyone(host);

  const refusal = await refusalOf(client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/one', provider: CHAT_PROVIDER, config: { bot: 'nobody' } },
  }));

  // The host's own code for what a backend refused `create` with, and the
  // backend's sentence: `openSession` answers every one of them the same way.
  expect(refusal.code).toBe(-32602);
  expect(refusal.message).toBe('There is no bot nobody.');
});

it('tells a resumed chat\'s messages to the agent\'s listener, as it does a new one\'s', async () => {
  const { host, configDir, records } = made();
  const client = await anyone(host);
  await client.handle({
    method: 'resourceWrite',
    params: { uri: 'bot://backer', data: JSON.stringify({ name: 'Backer' }), createOnly: true },
  });
  const heard: ChatMessage[] = [];
  const agent = await backend(configDir, records, (message) => { heard.push(message); });
  // A chat the host resumes after a restart: no `session_start` is fired for it.
  const session = agent.create({
    uri: 'bot-chat:/again',
    chatUri: 'ahp-chat:/again',
    settings: { bot: 'backer' },
    schema: () => ({}),
    emit: () => {},
    clientToolTimeoutMs: 0,
    resume: 'again',
  } as Start);

  session.begin('t1', 'hello');

  expect(heard).toEqual([{ session: 'bot-chat:/again', turnId: 't1', text: 'hello' }]);
  expect(turns('bot-chat:/again').onMessage).toBeDefined();
});

/*
 * The chat's one setting is a picker of the bots.
 *
 * A person asking for a chat with a bot names it, and the store is the only
 * thing that knows which bots there are - so the answer comes from there rather
 * than from a slug somebody has to spell.
 */
it('offers the bots as the answers to the chat setting', async () => {
  const { host } = made();
  const client = await anyone(host);
  for (const [slug, name] of [['backer', 'Backer'], ['builder', 'Builder']] as const) {
    await client.handle({
      method: 'resourceWrite',
      params: { uri: `bot://${slug}`, data: JSON.stringify({ name }), createOnly: true },
    });
  }

  // Marked so a client asks, and seeded once with the whole list so a chip is
  // labelled before the picker is opened.
  const form = await client.handle({
    method: 'resolveSessionConfig',
    params: { channel: ROOT, provider: CHAT_PROVIDER },
  }) as { schema: { properties: Record<string, Bag> } };
  expect(form.schema.properties.bot).toMatchObject({
    type: 'string',
    enumDynamic: true,
    enum: ['backer', 'builder'],
    enumLabels: ['Backer', 'Builder'],
  });
});

it('keeps the bots a query matches, by name or by slug', async () => {
  const { host } = made();
  const client = await anyone(host);
  for (const [slug, name] of [['backer', 'Backer'], ['builder', 'Builder']] as const) {
    await client.handle({
      method: 'resourceWrite',
      params: { uri: `bot://${slug}`, data: JSON.stringify({ name }), createOnly: true },
    });
  }

  const asked = async (query: string): Promise<unknown> => client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: ROOT, provider: CHAT_PROVIDER, property: 'bot', query },
  });

  // A name matches without regard to case, and a slug matches as itself.
  expect(await asked('BUILD')).toEqual({ items: [{ value: 'builder', label: 'Builder' }] });
  expect(await asked('back')).toEqual({ items: [{ value: 'backer', label: 'Backer' }] });
  expect(await asked('')).toEqual({
    items: [{ value: 'backer', label: 'Backer' }, { value: 'builder', label: 'Builder' }],
  });
});

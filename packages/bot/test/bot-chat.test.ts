import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseYaml, stringifyYaml } from '@cofold/yaml';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { chatUriFor } from '../../sdk/src/host/channels.js';
import { Status, idOf } from '../../sdk/src/sessions/catalog.js';
import { foldHostOptions, pluginHost } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import { shellTerminals } from '../../sdk/src/machines/terminals.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { botChatAgent, CHAT_PROVIDER } from '../src/chat.js';
import { BOTS_DIR, rowId, sessionsOf } from '../src/names.js';
import { apply } from '../src/plugin.js';
import { botStore } from '../src/store.js';
import type { ChatMessage, TurnHandle } from '../src/chat.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { Agent, Start } from '../../sdk/src/types/agent.js';
import type { Session } from '../../sdk/src/types/session.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Principal } from '../../sdk/src/types/users.js';
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

/** What hears a chat in the wake's place: each message with the handle over its turn, and each stop. */
interface Listener {
  heard?: (message: ChatMessage, handle: TurnHandle) => void;
  cancelled?: (session: string, turnId: string) => void;
}

/**
 * A listener that keeps what it heard: each message, each stop, and the handle
 * the messages came with, which is the one the plugin answers the chat through.
 */
const hearing = () => {
  const heard: ChatMessage[] = [];
  const stops: [string, string][] = [];
  let handle: TurnHandle | undefined;
  const listener: Listener = {
    heard: (message, given) => { heard.push(message); handle = given; },
    cancelled: (session, turnId) => { stops.push([session, turnId]); },
  };
  return {
    heard,
    stops,
    listener,
    /** The handle over the chat's turn, which a message has handed over. */
    chat: (): TurnHandle => {
      if (handle === undefined) throw new Error('no message has reached the chat');
      return handle;
    },
  };
};

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
 *
 * `more` is what a case adds to the host, such as the shells a command runs in.
 * `grants` is what the plugin's own entry holds, as the daemon's entry does: a
 * wake starts its back session in the bot's folder, which takes
 * `session:trust`.
 *
 * `listener` is what hears the chat in the wake's place, for a case about the
 * chat rather than the work behind it: the chat agent is built with it, as the
 * plugin builds it with the wake, over a store of the same bots. `null` is a
 * chat nobody listens to.
 */
function made(more: Partial<HostOptions> = {}, grants: `${string}:${string}`[] = [], listener?: Listener | null) {
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
    grants,
  });
  /*
   * The plugin as it is, or the plugin with its chat agent built on the case's
   * listener: the host it is handed is frozen, so the one method is laid over
   * it and everything else is read through.
   */
  const store = botStore(plugin.records(BOTS_DIR, { body: 'instructions', file: 'bot' }), plugin.records('bots-gone'), () => {}, {
    yaml: { parseYaml, stringifyYaml },
  });
  // Read now, so its watch hears the bots the plugin's own store writes.
  void store.ready();
  const given: typeof plugin = listener === undefined ? plugin : Object.create(plugin, {
    registerAgent: {
      value: (agent: Agent) => {
        plugin.registerAgent(agent.provider === CHAT_PROVIDER ? botChatAgent(configDir, store, listener?.heard, listener?.cancelled) : agent);
      },
    },
  }) as typeof plugin;
  apply(given, { root: bots });

  const base: HostOptions = {
    path: root,
    // One agent, because a bot that names no harness is started on the host's
    // first one: a host with no agent at all could not answer a write of a bot.
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    sessions,
    records,
    ...more,
  };
  const { options } = foldHostOptions(base, [contribution]);
  const host = createHost(options);
  // The plugin's own connection, which the daemon binds once the host exists.
  contribution.connects.host = host;
  return { host, root, bots, configDir, records, sessions, contribution };
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
 * A session created on `ahp-session:` keeps that name, which is the URI a
 * backend is started with and a message names its chat's session by.
 */
const HELD = SESSION;
const CHAT = chatUriFor(SESSION);

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
  params: { channel: CHAT, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
});

/** A client holds a message for later. */
const queued = (client: Client, id: string, text: string): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text, origin: { kind: 'user' } } } },
});

/** A client takes one back. */
const taken = (client: Client, id: string): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: CHAT, action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id } },
});

/**
 * Wait for the host to take up the head of the chat's queue: it does once the
 * backend that ended a turn has finished saying so, a moment after the end.
 */
const headTaken = (): Promise<void> => new Promise((done) => { setTimeout(done, 0); });

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
 * chats to be read back from. And the way to a road a client's message never
 * arrives on: a session's own methods, called without a host in between.
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
  /*
   * Nobody answers this chat here, and saying so is answering it with nothing:
   * the listener ends each turn as it hears it. That is the state this test is
   * about - it checks the log a chat leaves, not what a message wakes.
   */
  const { host, configDir, records } = made({}, [], { heard: (_message, handle) => { handle.complete(); } });
  const client = await anyone(host);

  await talkTo(client);
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
    _meta: { 'ahpd.bot': { id: 'backer', name: 'Backer', kind: 'direct' } },
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
  const { heard, listener, chat } = hearing();
  const { host, configDir, records } = made({}, [], listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

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
  expect(heard).toEqual([{ session: HELD, chat: CHAT, bot: 'backer', turnId:'t1', text: 'hello' }]);

  chat().complete('hello yourself');

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
  // turn nobody is holding any more. The end marks the chat unread.
  const answered = actions(notes, CHAT).map((one) => one['type']);
  expect(answered.slice(answered.indexOf('chat/responsePart'))).toEqual(['chat/responsePart', 'chat/turnComplete', 'chat/isReadChanged']);

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

/*
 * Whoever answers the chat is told the words and where they were said: the
 * back session is handed the words alone, as the reference Agents window sends
 * a message into another session, and the model, agent and attachments stay
 * with the message the main chat keeps.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L271-L282
 */
it('tells whoever answers the chat the words and the chat they were said in, and keeps the rest on the turn', async () => {
  const { heard, listener } = hearing();
  const { host } = made({}, [], listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const attachments = [{ type: 'resource', uri: 'file:///tmp/notes.md', label: 'notes.md' }];
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: CHAT,
      action: {
        type: 'chat/turnStarted',
        turnId: 't1',
        startedAt: new Date().toISOString(),
        message: { text: 'read this', origin: { kind: 'user' }, model: { id: 'opus' }, agent: { uri: 'agent:/reviewer' }, attachments },
      },
    },
  });
  expect(heard).toEqual([{ session: HELD, chat: CHAT, bot: 'backer', turnId:'t1', text: 'read this' }]);
  expect((await stateOf(client))['activeTurn']).toMatchObject({ message: { text: 'read this', model: { id: 'opus' }, attachments } });
});

/*
 * A turn whose work failed ends as failed, with its error part, as the
 * reference host ends a failed send with `chat/error` (agentSideEffects.ts
 * L1854-L1860 at a4e689ae) and types the part `sendFailed` (L2564-L2573 at
 * 6b68d3fe), and a read back keeps it failed.
 */
it('ends a turn nothing answers in chat/error, as VS Code ends a turn it has no agent for', async () => {
  // A chat with nobody behind it.
  const { host, configDir } = made({}, [], null);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');

  const failed = actions(notes, CHAT).find((one) => one['type'] === 'chat/error');
  expect(failed).toMatchObject({ turnId: 't1', part: { kind: 'error', error: { errorType: 'noAgent', message: 'No agent found for session' } } });
  expect(actions(notes, CHAT).some((one) => one['type'] === 'chat/turnComplete')).toBe(false);
  expect(lines(configDir, 'one').at(-1)).toMatchObject({ id: 't1', state: 'error' });
});

it('ends a turn as failed, in the words of what failed, typed as VS Code types a failed send', async () => {
  const { listener, chat } = hearing();
  const { host, configDir } = made({}, [], listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  chat().fail?.('the model call failed');

  const failed = actions(notes, CHAT).find((one) => one['type'] === 'chat/error');
  expect(failed).toMatchObject({ turnId: 't1', part: { kind: 'error', error: { errorType: 'sendFailed', message: 'the model call failed' } } });
  expect(actions(notes, CHAT).some((one) => one['type'] === 'chat/turnComplete')).toBe(false);
  const state = await stateOf(client);
  expect(state['turns']).toMatchObject([{ id: 't1', state: 'error' }]);
  expect(lines(configDir, 'one').at(-1)).toMatchObject({ id: 't1', state: 'error' });
});

/*
 * A stop is told to whoever holds the chat, so the work behind the turn stops
 * too, as the reference host cancels a stopped chat's subagent sessions
 * (agentSideEffects.ts L1942, L1470-L1483 at a4e689ae).
 */
it('tells the chat\'s holder which turn a client stopped', async () => {
  const { stops, listener } = hearing();
  const { host } = made({}, [], listener);
  const client = await anyone(host, []);
  await talkTo(client);

  await said(client, 't1', 'hello');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  expect(stops).toEqual([[HELD, 't1']]);
});

/*
 * A `!` command typed into a chat with a bot is the host's local command, as
 * the reference host runs one ahead of its admission whatever agent the chat
 * has: run in a terminal, its call and its turn completed by the host, and
 * whoever answers the chat never told of it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L14-L41
 */
it('runs a command typed into the chat in a terminal, and tells nobody who answers it', async () => {
  const { heard, listener } = hearing();
  const { host } = made({ terminals: shellTerminals() }, [], listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', '!echo from-the-bot-chat');
  const over = (): boolean => actions(notes, CHAT).some((one) => one['type'] === 'chat/turnComplete' && one['turnId'] === 't1');
  for (let i = 0; i < 200 && !over(); i++) await new Promise((resolve) => { setTimeout(resolve, 25); });
  expect(over()).toBe(true);
  const done = actions(notes, CHAT).find((one) => one['type'] === 'chat/toolCallComplete');
  expect(done).toMatchObject({ turnId: 't1', result: { success: true, pastTenseMessage: 'Ran command' } });
  expect(JSON.stringify(done?.['result'])).toContain('from-the-bot-chat');
  expect(heard).toEqual([]);
});

it('ends a turn with a notice, and with a cancellation', async () => {
  // Somebody answers this chat, and says nothing here: a turn with a listener
  // stays open, which is what leaves the endings below something to end.
  const { listener, chat } = hearing();
  const { host, configDir } = made({}, [], listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  chat().notice('Backer finished without a reply');
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
    params: { channel: CHAT, action: { type: 'chat/turnCancelled', turnId: 't2', duration: 0 } },
  });
  expect(actions(notes, CHAT).map((one) => one['type'])).toContain('chat/turnCancelled');
  const state = await stateOf(client);
  expect(state['status']).toBe(Status.Idle);
  expect(state['activeTurn']).toBeUndefined();
  expect(state['turns']).toMatchObject([{ id: 't1' }, { id: 't2', state: 'cancelled', responseParts: [] }]);
  expect(lines(configDir, 'one').at(-1)).toMatchObject({ id: 't2', state: 'cancelled', responseParts: [] });
});

/*
 * A steer goes into the open turn, and the turn goes on.
 *
 * The reference host hands steering into a running turn through its
 * provider, and the turn goes on (queueDrainContribution.ts L171-L208 at
 * a4e689ae). The message is handed to whoever answers as a message into that
 * turn, whose answer lands there, and the log keeps it on a line of its own,
 * so a chat read back after a restart still shows what was said. It stays the
 * chat's steering message until the work behind the turn takes it in, as VS
 * Code's host takes a steer out once its agent reports it consumed
 * (agentSideEffects.ts L775-L782 at 6b68d3fe).
 */
it('steers a message into the open turn, which goes on, and keeps it pending until the work takes it in', async () => {
  const listened = hearing();
  const { heard } = listened;
  const { host, configDir, records } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that', origin: { kind: 'user' } } } },
  });

  const life = actions(notes, CHAT).filter((one) => String(one['type']).startsWith('chat/turn'));
  expect(life.map((one) => one['type'])).toEqual(['chat/turnStarted']);
  expect(heard).toEqual([
    { session: HELD, chat: CHAT, bot: 'backer', turnId:'t1', text: 'hello' },
    { session: HELD, chat: CHAT, bot: 'backer', turnId:'t1', text: 'stop that', steering: 's1' },
  ]);
  const pending = (): unknown[] => actions(notes, CHAT)
    .filter((one) => String(one['type']).startsWith('chat/pendingMessage'))
    .map((one) => [one['type'], one['kind'], one['id']]);
  // Sent on into the open turn, and still the chat's steering message.
  expect(chat.steeringSent?.('s1')).toBe(true);
  expect(pending()).toEqual([['chat/pendingMessageSet', 'steering', 's1']]);
  expect((await stateOf(client))['steeringMessage']).toMatchObject({ id: 's1' });

  // Taken out once the work behind the turn takes it in.
  chat.steeringConsumed?.('s1');
  expect(pending()).toEqual([
    ['chat/pendingMessageSet', 'steering', 's1'],
    ['chat/pendingMessageRemoved', 'steering', 's1'],
  ]);
  // The steer stays in the turn it went into, as a harness notice that names it.
  const quote = { kind: 'systemNotification', content: 'stop that', _meta: { 'ahpd.steer': 's1' } };
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/responsePart'))
    .toEqual([{ type: 'chat/responsePart', turnId: 't1', part: quote }]);

  // Read back while the turn is still open, as after a daemon that died in it:
  // the steer, then the turn read back interrupted.
  const early = await (await backend(configDir, records)).transcript?.('one');
  expect(early?.[0]?.responseParts).toEqual([quote, {
    kind: 'error',
    error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' },
  }]);

  chat.complete('done');
  const state = await stateOf(client);
  expect(state['turns']).toMatchObject([{ id: 't1', state: 'complete', responseParts: [quote, { kind: 'markdown', content: 'done' }] }]);
  expect(state['steeringMessage']).toBeUndefined();

  // Read back, the chat shows the turn the steer went into, as it does live.
  const fresh = await backend(configDir, records);
  const read = await fresh.transcript?.('one');
  expect(read?.map((turn) => [turn.id, turn.message.text])).toEqual([['t1', 'hello']]);
  expect(read?.[0]?.responseParts).toEqual([quote, { id: 't1:reply', kind: 'markdown', content: 'done' }]);
});

/*
 * A steer whose turn ended while it was on its way to the work behind it goes
 * back unsent, and runs as the next turn, as VS Code's agents hand back a steer
 * whose turn ended first and its host runs it next (agent.ts L1943-L1948,
 * queueDrainContribution.ts L230-L243 at 6b68d3fe).
 */
it('hands a steer back unsent when its turn ended on its way, and runs it next', async () => {
  const listened = hearing();
  const { heard } = listened;
  const { host, configDir } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that', origin: { kind: 'user' } } } },
  });
  chat.complete('done');
  expect(chat.steeringSent?.('s1')).toBe(false);
  // The host hears the hand-off's answer once the promise it holds settles.
  await new Promise((done) => { setTimeout(done, 0); });

  const after = await stateOf(client);
  expect(after['steeringMessage']).toBeUndefined();
  expect(after['activeTurn']).toMatchObject({ message: { text: 'stop that' } });
  expect(heard.map((one) => [one.text, one.steering])).toEqual([['hello', undefined], ['stop that', 's1'], ['stop that', undefined]]);
  // Nothing of it is written against the turn it missed.
  expect(lines(configDir, 'one').filter((line) => line['steering'] === true)).toEqual([]);
});

/*
 * A steer the work behind its turn holds and never took in is over with the
 * turn: it is taken out before the turn's end is said, as VS Code's agents
 * clear a steer's pending state when its turn ends (codexAgent.ts L3409-L3412
 * at 6b68d3fe).
 */
it('takes out a steer the work behind its turn still holds when the turn ends', async () => {
  const listened = hearing();
  const { host } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that', origin: { kind: 'user' } } } },
  });
  expect(chat.steeringSent?.('s1')).toBe(true);
  chat.fail?.('it broke');

  const told = actions(notes, CHAT).map((one) => one['type'])
    .filter((type) => String(type).startsWith('chat/pendingMessage') || type === 'chat/error');
  expect(told).toEqual(['chat/pendingMessageSet', 'chat/pendingMessageRemoved', 'chat/error']);
  expect((await stateOf(client))['steeringMessage']).toBeUndefined();
});

/*
 * A stop takes out every steer of its turn once, one still on its way to the
 * work included, which is then sent nowhere: VS Code's host takes a stopped
 * turn's steering out, and its agents let go of what they hold
 * (queueDrainContribution.ts L55-L65, codexAgent.ts L6852-L6854 at 6b68d3fe).
 */
it('takes out a steer still on its way when its turn is stopped, and sends it nowhere', async () => {
  const listened = hearing();
  const { heard } = listened;
  const { host } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that', origin: { kind: 'user' } } } },
  });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  expect(chat.steeringSent?.('s1')).toBe(false);

  const removed = actions(notes, CHAT).filter((one) => one['type'] === 'chat/pendingMessageRemoved');
  expect(removed).toEqual([expect.objectContaining({ kind: 'steering', id: 's1' })]);
  const after = await stateOf(client);
  expect(after['steeringMessage']).toBeUndefined();
  expect(after['activeTurn']).toBeUndefined();
  expect(heard.map((one) => one.text)).toEqual(['hello', 'stop that']);
});

// The protocol's reducer moves a chat's modifiedAt at a turn's start and end only.
it('leaves the chat\'s modified time where a steer finds it', async () => {
  const { host, configDir, records } = made();
  const client = await anyone(host);
  await client.handle({
    method: 'resourceWrite',
    params: { uri: 'bot://backer', data: JSON.stringify({ name: 'Backer' }), createOnly: true },
  });
  const agent = await backend(configDir, records, () => {});
  // The session a later subscriber is seeded from, read directly.
  const session = agent.create({
    uri: 'bot-chat:/steered',
    chatUri: 'ahp-chat:/steered',
    settings: { bot: 'backer' },
    schema: () => ({}),
    emit: () => {},
    clientToolTimeoutMs: 0,
  } as Start) as Session;
  session.sendMessage('t1', 'hello');
  const before = session.modifiedAt();
  // Long enough that a moved time would read as another one.
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  expect(session.sendSteeringMessage?.({ id: 's1', text: 'stop that', from: { origin: { kind: 'user' } } })).toBeInstanceOf(Promise);
  expect(session.modifiedAt()).toBe(before);
});

it('answers a steer to the client that sent it', async () => {
  const { host } = made();
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, clientSeq: 9, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that', origin: { kind: 'user' } } } },
  });

  // The client holds its message until an action with its own origin answers it.
  const answers = notes
    .filter((note) => note.method === 'action')
    .map((note) => note.params as { action: Bag; origin?: { clientSeq: number } })
    .filter((one) => one.origin?.clientSeq === 9);
  expect(answers.map((one) => one.action)).toEqual([
    expect.objectContaining({ type: 'chat/pendingMessageSet', kind: 'steering', id: 's1' }),
  ]);
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/turnStarted')).toHaveLength(1);
});

it('keeps the sender of a steered message on the message', async () => {
  const { host } = made({}, [], hearing().listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const outside = { origin: { kind: 'agent' }, _meta: { 'vscode.chat.delegation': 'other-session' } };

  await said(client, 't1', 'hello');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that', ...outside } } },
  });

  // Who sent it rides the steering message, rather than falling back to the
  // person at the keyboard.
  const set = actions(notes, CHAT).find((one) => one['type'] === 'chat/pendingMessageSet');
  expect(set).toMatchObject({ message: { text: 'stop that', ...outside } });
});

/** A few ticks: the host's queue drain starts the next turn once the turn in front has ended. */
const drained = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => { setTimeout(r, 0); });
};

it('keeps a queued message behind the steered turn', async () => {
  const listened = hearing();
  const { heard } = listened;
  const { host } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  await queued(client, 'q1', 'and then this');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop that', origin: { kind: 'user' } } } },
  });

  // The steered turn is the open one, and what was waiting is still waiting.
  const steered = await stateOf(client);
  expect(steered['activeTurn']).toMatchObject({ id: 't1', message: { text: 'hello' } });
  expect(steered['queuedMessages']).toMatchObject([{ id: 'q1', message: { text: 'and then this' } }]);
  expect(heard.map((one) => one.text)).toEqual(['hello', 'stop that']);

  // The work behind the turn takes the steer in, and the turn goes on.
  chat.steeringSent?.('s1');
  chat.steeringConsumed?.('s1');
  expect((await stateOf(client))['activeTurn']).toMatchObject({ id: 't1' });

  // It starts when the steered turn ends, and not before.
  chat.complete('done');
  await drained();
  const after = await stateOf(client);
  expect(after['activeTurn']).toMatchObject({ message: { text: 'and then this' } });
  // The chat's reducer leaves the key out once its queue is empty.
  expect(after['queuedMessages'] ?? []).toEqual([]);
});

/*
 * A stopped turn starts nothing behind it: the reference host leaves queued
 * messages queued, and a message set while idle starts the first of them.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1950-L1954
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L245-L286
 */
it('starts nothing behind a stopped turn, and its queue\'s head once a message is queued after it', async () => {
  const { heard, listener } = hearing();
  const { host } = made({}, [], listener);
  const client = await anyone(host, []);
  await talkTo(client);

  await said(client, 't1', 'hello');
  await queued(client, 'q1', 'and then this');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  const stopped = await stateOf(client);
  expect(stopped['activeTurn']).toBeUndefined();
  expect(stopped['queuedMessages']).toMatchObject([{ id: 'q1' }]);

  await queued(client, 'q2', 'one more');
  const after = await stateOf(client);
  expect(after['activeTurn']).toMatchObject({ message: { text: 'and then this' } });
  expect(heard.map((one) => one.text)).toEqual(['hello', 'and then this']);
});

/*
 * A client's reorder while nothing runs runs the reference host's drain, which
 * starts the head of a queue a stop left waiting.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90
 */
it('starts the head once a client reorders a stopped turn\'s queue', async () => {
  const { heard, listener } = hearing();
  const { host } = made({}, [], listener);
  const client = await anyone(host, []);
  await talkTo(client);

  await said(client, 't1', 'hello');
  await queued(client, 'q1', 'and then this');
  await queued(client, 'q2', 'one more');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  expect((await stateOf(client))['activeTurn']).toBeUndefined();

  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/queuedMessagesReordered', order: ['q2', 'q1'] } },
  });
  const after = await stateOf(client);
  expect(after['activeTurn']).toMatchObject({ message: { text: 'one more' } });
  expect(after['queuedMessages']).toMatchObject([{ id: 'q1' }]);
  expect(heard.map((one) => one.text)).toEqual(['hello', 'one more']);
});

/*
 * A failed turn starts nothing behind it, as the reference host drains its
 * queue after a success alone, and a client taking a message back while nothing
 * runs starts the head.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L90
 */
it('starts nothing behind a failed turn, and the head once a client takes a message back', async () => {
  const { heard, listener, chat } = hearing();
  const { host } = made({}, [], listener);
  const client = await anyone(host, []);
  await talkTo(client);

  await said(client, 't1', 'hello');
  await queued(client, 'q1', 'and then this');
  await queued(client, 'q2', 'one more');
  chat().fail?.('the work failed');
  const failed = await stateOf(client);
  expect(failed['activeTurn']).toBeUndefined();
  expect(failed['queuedMessages']).toMatchObject([{ id: 'q1' }, { id: 'q2' }]);

  await taken(client, 'q1');
  const after = await stateOf(client);
  expect(after['activeTurn']).toMatchObject({ message: { text: 'one more' } });
  expect(heard.map((one) => one.text)).toEqual(['hello', 'one more']);
});

/*
 * A chat read back shows the turn a steer went into, as the live chat does once
 * the message is handed on: the reference host hands a steering message into
 * the running turn, which goes on, and the Claude backend reads a steering
 * prompt back inside the turn it steered.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L171-L208
 */
it('reads a steering line back in the turn it went into', async () => {
  const { host, configDir, records } = made({}, [], { heard: (_message, handle) => { handle.complete('done'); } });
  const client = await anyone(host);
  await talkTo(client);
  await said(client, 't1', 'hello');

  // The line names the turn it went into, which is the turn it is read in.
  appendFileSync(
    join(configDir, BOTS_DIR, 'backer', 'logs', 'one.jsonl'),
    `${JSON.stringify({ id: 't1', steering: true, message: { text: 'stop that', origin: { kind: 'user' } } })}\n`,
  );

  const fresh = await backend(configDir, records);
  const read = await fresh.transcript?.('one');
  expect(read?.map((turn) => [turn.id, turn.message.text])).toEqual([['t1', 'hello']]);
  // A line written before steers were shown names no steering id, and its
  // part goes after what the turn holds.
  expect(read?.[0]?.responseParts).toEqual([
    { id: 't1:reply', kind: 'markdown', content: 'done' },
    { kind: 'systemNotification', content: 'stop that', _meta: { 'ahpd.steer': 't1:0' } },
  ]);
});

it('reads a turn that ended with a steer quoted as markdown back as it was', async () => {
  const { listener, chat } = hearing();
  const { host, configDir, records } = made({}, [], listener);
  const client = await anyone(host);
  await talkTo(client);
  await said(client, 't1', 'hello');
  chat().complete('done');

  // The turn's last line holds the quote a steer was before it was a notice.
  const log = join(configDir, BOTS_DIR, 'backer', 'logs', 'one.jsonl');
  const lines = readFileSync(log, 'utf8').trimEnd().split('\n');
  const ended = JSON.parse(lines.pop() ?? '{}') as Bag;
  const quote = { id: 'steer:s1', kind: 'markdown', content: '> stop that' };
  ended['responseParts'] = [quote, ...(ended['responseParts'] as Bag[])];
  const steering = { id: 't1', steering: true, steeringId: 's1', message: { text: 'stop that', origin: { kind: 'user' } } };
  writeFileSync(log, `${[...lines, JSON.stringify(steering), JSON.stringify(ended)].join('\n')}\n`);

  const read = await (await backend(configDir, records)).transcript?.('one');
  expect(read?.[0]?.responseParts).toEqual([quote, { id: 't1:reply', kind: 'markdown', content: 'done' }]);
});

it('reads a turn its log shows begun and never ended back interrupted, as VS Code\'s Copilot reads one', async () => {
  const { listener, chat } = hearing();
  const { host, configDir, records } = made({}, [], listener);
  const client = await anyone(host);
  await talkTo(client);
  await said(client, 't1', 'hello');
  chat().complete('done');
  // Begun, and the daemon went before it ended: the log holds its first line alone.
  await said(client, 't2', 'and then');

  const fresh = await backend(configDir, records);
  const read = await fresh.transcript?.('one');
  expect(read?.map((turn) => [turn.id, turn.state])).toEqual([['t1', 'complete'], ['t2', 'error']]);
  expect(read?.[1]?.responseParts).toEqual([
    { kind: 'error', error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' } },
  ]);
});

it('waits a queued message out, and starts it when the turn in front ends', async () => {
  const listened = hearing();
  const { heard } = listened;
  const { host, configDir } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
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
  expect(heard).toEqual([{ session: HELD, chat: CHAT, bot: 'backer', turnId:'t1', text: 'hello' }]);
  expect(lines(configDir, 'one')).toHaveLength(1);

  chat.complete('one');
  await drained();

  // Started: the entry left the queue, and its message is the turn that began -
  // under a turn id of the chat's own, with the entry it was named on it.
  const started = await stateOf(client);
  const next = started['activeTurn'] as Bag;
  expect(started['queuedMessages'] ?? []).toEqual([]);
  expect(started['turns']).toMatchObject([{ id: 't1', state: 'complete' }]);
  expect(next).toMatchObject({ message: { text: 'and then this' } });
  expect(heard).toEqual([
    { session: HELD, chat: CHAT, bot: 'backer', turnId:'t1', text: 'hello' },
    { session: HELD, chat: CHAT, bot: 'backer', turnId:String(next['id']), text: 'and then this' },
  ]);
  // And the client is told by the turn the entry became, which names it, as VS
  // Code's host starts a queued message (queueDrainContribution.ts L291-L297 at
  // 6b68d3fe): the reducer takes the entry out of the queue with it.
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/pendingMessageRemoved')).toEqual([]);
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/turnStarted').map((one) => one['queuedMessageId']))
    .toEqual([undefined, 'q1']);

  chat.complete('two');
  // Two turns, and two lines each: the queued one is a turn of the chat's, kept
  // the same way as the one it waited behind.
  expect(lines(configDir, 'one').map((one) => (one['message'] as Bag)['text']))
    .toEqual(['hello', 'hello', 'and then this', 'and then this']);
});

it('starts what waited in the order the queue was left in', async () => {
  const listened = hearing();
  const { host, configDir } = made({}, [], listened.listener);
  const client = await anyone(host);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  await queued(client, 'q1', 'first asked');
  await queued(client, 'q2', 'second asked');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/queuedMessagesReordered', order: ['q2', 'q1'] } },
  });

  // Applied where it was asked for and read back from the state: the order a
  // client sends is the order the chat holds.
  expect((await stateOf(client))['queuedMessages']).toMatchObject([{ id: 'q2' }, { id: 'q1' }]);

  chat.complete('one');
  await drained();
  expect((await stateOf(client))['activeTurn']).toMatchObject({ message: { text: 'second asked' } });
  chat.complete('two');
  await drained();
  // And the one behind that, which is the rest of what the order said - the
  // queue emptying one turn at a time rather than all at once.
  const last = await stateOf(client);
  expect(last['activeTurn']).toMatchObject({ message: { text: 'first asked' } });
  expect(last['queuedMessages'] ?? []).toEqual([]);
  chat.complete('three');

  expect(lines(configDir, 'one').map((one) => (one['message'] as Bag)['text'])).toEqual([
    'hello', 'hello', 'second asked', 'second asked', 'first asked', 'first asked',
  ]);
});

it('takes a queued message back, and it is never a turn', async () => {
  const { listener, chat } = hearing();
  const { host, configDir } = made({}, [], listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  await queued(client, 'q1', 'never said');
  await taken(client, 'q1');

  expect((await stateOf(client))['queuedMessages'] ?? []).toEqual([]);
  chat().complete('one');

  // One turn in it, and nothing started behind it: what was taken back is a
  // message the chat never heard of, rather than one it says later.
  const idle = await stateOf(client);
  expect(idle['activeTurn']).toBeUndefined();
  expect(idle['turns']).toMatchObject([{ id: 't1', state: 'complete' }]);
  expect(lines(configDir, 'one')).toHaveLength(2);
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/turnStarted')).toHaveLength(1);
});

/*
 * A second message while the answer is still coming takes the open turn's
 * place at once, as the reducer replaces the active turn, and is handed on once
 * the open turn is answered: the reference host hands a client's start to its
 * agent at once, and its agents run each in turn.
 */
it('takes a second message while the answer is still coming, said in the first one\'s place and handed on after it', async () => {
  const listened = hearing();
  const heard = (): string[] => listened.heard.map((message) => message.turnId);
  const { host } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  await said(client, 't2', 'and this');

  const refused = notes
    .map((note) => note.params as { rejectionReason?: string; action?: Bag })
    .find((one) => one.rejectionReason !== undefined);
  expect(refused).toBeUndefined();
  const shown = await stateOf(client);
  expect(shown['activeTurn']).toMatchObject({ id: 't2' });
  expect((shown['turns'] as Bag[]).map((turn) => turn['id'])).not.toContain('t1');
  // The open turn is still the one being answered.
  expect(heard()).toEqual(['t1']);

  chat.complete('one');
  expect(heard()).toEqual(['t1', 't2']);
  chat.complete('two');
  const done = await stateOf(client);
  expect(done['activeTurn']).toBeUndefined();
  // The turn t2 took the place of is in no history.
  expect((done['turns'] as Bag[]).map((turn) => turn['id'])).toEqual(['t2']);
});

/*
 * A turn sent while another is open is handed on once the open turn is
 * answered, as the reference agent runs each send after the one before it.
 * The host said each start, so the chat says none, and the turn it took the
 * place of is in no history.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1814
 */
it('hands a turn sent while another is open on once the open turn is answered, saying no start of either', async () => {
  const { host, configDir, records } = made();
  const client = await anyone(host);
  // The bot, written the way a person writes one. No session is started here:
  // what is tested below is the backend the host hands its turns to.
  await client.handle({
    method: 'resourceWrite',
    params: { uri: 'bot://backer', data: JSON.stringify({ name: 'Backer' }), createOnly: true },
  });

  // Somebody answers this chat, which is what leaves the first turn open.
  const listened = hearing();
  const heard = (): string[] => listened.heard.map((message) => message.turnId);
  const agent = await backend(configDir, records, listened.listener.heard);
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
  session.sendMessage('t1', 'hello');
  session.sendMessage('t2', 'and then this');

  // The open turn is the one being answered.
  expect(session.chatState().activeTurn).toMatchObject({ id: 't1', message: { text: 'hello' } });
  expect(session.chatState().turns).toEqual([]);
  expect(heard()).toEqual(['t1']);

  // Handed on once the open turn is answered, under the id the client named,
  // and the turn it took the place of is in no history.
  listened.chat().complete('one');
  const next = session.chatState();
  expect(next.turns).toEqual([]);
  expect(next.activeTurn).toMatchObject({ id: 't2', message: { text: 'and then this' } });
  expect(heard()).toEqual(['t1', 't2']);
  expect(sent.map((one) => [one['type'], one['turnId']])).toEqual([
    ['chat/responsePart', 't1'],
    ['chat/turnComplete', 't1'],
  ]);
});

/*
 * A back session's call ends with the back session's turn.
 *
 * A turn that completes completes the call, as VS Code completes a subagent's
 * call when the subagent's work completes, answer or no answer: a back turn
 * that finished without a post completes it as much as one that posted. A
 * turn that is stopped or fails leaves it to its end, which forces it to
 * cancelled, `skipped`, as the reference host's chat draws a call its turn
 * left behind (stateToProgressAdapter.ts L548 at a4e689ae).
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211
 */
it('completes the back session\'s call when its turn ends with a notice, as VS Code completes a subagent\'s call with its work', async () => {
  const back = `ahp-chat://default/${Buffer.from('bot:/backer/ana/work', 'utf8').toString('base64url')}`;
  const { host } = made({}, [], { heard: (_message, handle) => { handle.subagent?.(back, 'Backer'); handle.notice('Backer finished without a reply'); } });
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');

  expect(actions(notes, CHAT).some((one) => one['type'] === 'chat/toolCallComplete')).toBe(true);
  const state = await stateOf(client);
  const call = ((state['turns'] as Bag[])[0]?.['responseParts'] as Bag[])[0];
  expect(call).toMatchObject({ kind: 'toolCall', toolCall: { status: 'completed' } });
});

it('leaves the back session\'s call to be cancelled when its turn fails', async () => {
  const back = `ahp-chat://default/${Buffer.from('bot:/backer/ana/work', 'utf8').toString('base64url')}`;
  const { host } = made({}, [], {
    heard: (_message, handle) => { handle.subagent?.(back, 'Backer'); handle.fail?.('Backer was not woken: the host refused it'); },
  });
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');

  expect(actions(notes, CHAT).some((one) => one['type'] === 'chat/toolCallComplete')).toBe(false);
  const state = await stateOf(client);
  const call = ((state['turns'] as Bag[])[0]?.['responseParts'] as Bag[])[0];
  expect(call).toMatchObject({ kind: 'toolCall', toolCall: { status: 'cancelled', reason: 'skipped' } });
});

/*
 * A back session may post more than once while its own turn runs.
 *
 * Each answer `responsePart` gives is a part of the open turn, which stays
 * open, and `complete` after them completes the turn: the call that shows the
 * back session completes, as a subagent call does when its turn ends.
 */
it('adds each answer to the open turn, and completes the call when the turn ends', async () => {
  const back = `ahp-chat://default/${Buffer.from('bot:/backer/ana/work', 'utf8').toString('base64url')}`;
  const listened = hearing();
  const { host } = made({}, [], { heard: (message, handle) => { listened.listener.heard?.(message, handle); handle.subagent?.(back, 'Backer'); } });
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: CHAT } }));

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  chat.responsePart('working on it');
  chat.responsePart('the answer');

  expect((await stateOf(client))['activeTurn']).toMatchObject({
    id: 't1',
    responseParts: [
      { kind: 'toolCall' },
      { id: 't1:reply', kind: 'markdown', content: 'working on it' },
      { id: 't1:reply2', kind: 'markdown', content: 'the answer' },
    ],
  });

  chat.complete();

  const state = await stateOf(client);
  expect(state['activeTurn']).toBeUndefined();
  expect(state['turns']).toMatchObject([{
    id: 't1',
    state: 'complete',
    responseParts: [
      { kind: 'toolCall', toolCall: { status: 'completed' } },
      { id: 't1:reply', kind: 'markdown', content: 'working on it' },
      { id: 't1:reply2', kind: 'markdown', content: 'the answer' },
    ],
  }]);
  // A client that watched it live reads the same turn.
  const watched = (replayed(opened, notes, CHAT)['turns'] as Bag[])[0];
  expect(watched).toMatchObject({
    id: 't1',
    state: 'complete',
    responseParts: [
      { kind: 'toolCall', toolCall: { status: 'completed' } },
      { kind: 'markdown', content: 'working on it' },
      { kind: 'markdown', content: 'the answer' },
    ],
  });
});

/*
 * A call the back session stopped waiting on leaves the open turn at once.
 *
 * The back session raised the confirmation and took it back, and the copy here
 * is told skipped under the open turn's own id - a call action for another turn
 * is one the reducer drops - so a client that watched it cancels the call. The
 * host's own state has no action to remove a part, so the copy is spliced out
 * of what a late client reads instead.
 */
it('takes a withdrawn call out of the open turn, which the reducer cancels', async () => {
  const listened = hearing();
  const { host } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: CHAT } }));

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  chat.asking?.({
    id: 'toolu_run',
    kind: 'toolConfirmation',
    toolCall: {
      toolCallId: 'toolu_run',
      toolName: 'Bash',
      displayName: 'Bash',
      confirmationTitle: 'Run in terminal',
      invocationMessage: 'Run `ls` in the bot folder',
    },
  });
  chat.withdrawn?.('toolu_run');

  expect((await stateOf(client))['activeTurn']).toMatchObject({
    id: 't1',
    responseParts: [{ kind: 'toolCall', toolCall: { status: 'cancelled', reason: 'skipped' } }],
  });
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/toolCallConfirmed')).toEqual([{
    type: 'chat/toolCallConfirmed',
    turnId: 't1',
    toolCallId: 'toolu_run',
    approved: false,
    reason: 'skipped',
  }]);
  const watched = replayed(opened, notes, CHAT)['activeTurn'] as Bag;
  expect(watched['responseParts']).toMatchObject([{
    kind: 'toolCall',
    toolCall: { toolCallId: 'toolu_run', status: 'cancelled', reason: 'skipped' },
  }]);
  chat.complete('done');
});

/*
 * A question the back session stopped asking leaves the open turn at once.
 *
 * `chat/inputCompleted` names only the request, and the reducer writes the
 * response into the part the turn still holds, so a client that watched it
 * stops drawing a question nobody is asking.
 */
it('takes a withdrawn question out of the open turn, which the reducer cancels', async () => {
  const listened = hearing();
  const { host } = made({}, [], listened.listener);
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: CHAT } }));

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  chat.asking?.({
    id: 'ask-1',
    kind: 'chatInput',
    request: { id: 'ask-1', message: 'Which folder?', questions: [] },
  });
  chat.withdrawn?.('ask-1');

  expect((await stateOf(client))['activeTurn']).toMatchObject({
    id: 't1',
    responseParts: [{ kind: 'inputRequest', request: { id: 'ask-1' }, response: 'cancel' }],
  });
  expect(actions(notes, CHAT).filter((one) => one['type'] === 'chat/inputCompleted')).toEqual([
    { type: 'chat/inputCompleted', requestId: 'ask-1', response: 'cancel' },
  ]);
  const watched = replayed(opened, notes, CHAT)['activeTurn'] as Bag;
  expect((watched['responseParts'] as Bag[])[0]).toMatchObject({
    kind: 'inputRequest',
    request: { id: 'ask-1' },
    response: 'cancel',
  });
  chat.complete('done');
});

it('shows the back session as one subagent call in a turn a steer goes into', async () => {
  /** The chat of the back session a message wakes, as the wake knows it. */
  const back = `ahp-chat://default/${Buffer.from('bot:/backer/ana/work', 'utf8').toString('base64url')}`;
  /*
   * What the wake does for a message: the turn it leaves open shows the chat it
   * is waiting on. A steer goes into the open turn and wakes the same chat, so
   * the turn keeps the one call it shows.
   */
  const listened = hearing();
  const { host, configDir } = made({}, [], { heard: (message, handle) => { listened.listener.heard?.(message, handle); handle.subagent?.(back, 'Backer'); } });
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);

  await said(client, 't1', 'hello');
  const chat = listened.chat();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'and this', origin: { kind: 'user' } } } },
  });
  // The wake sends it on, which puts it in the turn.
  expect(chat.steeringSent?.('s1')).toBe(true);

  // The steered turn is the open one, waiting on the back session's chat by one call.
  const running = await stateOf(client);
  expect(running['turns']).toEqual([]);
  const active = running['activeTurn'] as Bag;
  expect(active['message']).toMatchObject({ text: 'hello' });
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
  }, { kind: 'systemNotification', content: 'and this', _meta: { 'ahpd.steer': 's1' } }]);
  const started = actions(notes, CHAT).filter((one) => ['chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallContentChanged'].includes(String(one['type'])));
  expect(started.map((one) => one['type'])).toEqual([
    'chat/toolCallStart',
    'chat/toolCallReady',
    'chat/toolCallContentChanged',
  ]);
  expect(started[2]?.['content']).toEqual([{ type: 'subagent', resource: back, title: 'Backer' }]);

  chat.complete('done');

  /*
   * Over, and the call is a part of the finished turn: the one its start
   * appended, completed, and not a second part a response could have added.
   */
  const idle = await stateOf(client);
  const turn = (idle['turns'] as Bag[])[0] as Bag;
  const parts = turn['responseParts'] as Bag[];
  expect(parts).toHaveLength(3);
  expect(parts[0]).toMatchObject({
    kind: 'toolCall',
    toolCall: {
      status: 'completed',
      success: true,
      content: [{ type: 'subagent', resource: back, title: 'Backer' }],
    },
  });
  expect(parts[1]).toEqual({ kind: 'systemNotification', content: 'and this', _meta: { 'ahpd.steer': 's1' } });
  expect(parts[2]).toMatchObject({ kind: 'markdown', content: 'done' });
  const kinds = actions(notes, CHAT).map((one) => one['type']);
  expect(kinds.slice(-4)).toEqual([
    'chat/toolCallComplete',
    'chat/responsePart',
    'chat/turnComplete',
    'chat/isReadChanged',
  ]);
  // The steer's quote and the reply; the call is said by its own actions.
  expect(kinds.filter((one) => one === 'chat/responsePart')).toHaveLength(2);
  // And the line a restart reads holds the same three parts, as JSON writes
  // them: a key whose value is undefined is left out of a line and of a frame.
  expect(lines(configDir, 'one').at(-1))
    .toMatchObject({ id: turn['id'], state: 'complete', responseParts: JSON.parse(JSON.stringify(parts)) as Bag[] });
});

/*
 * A turn somebody began in a back session stays in that session's own chat.
 *
 * Nothing in the main chat waits on it, so the main chat gets no turn of its
 * own for it: it shows the back session only as the call a main turn waits on,
 * as a turn VS Code's host starts is the turn of the chat it was started on
 * (agentHostTurnService.ts L126-L171 at 6b68d3fe).
 */
it('leaves a turn somebody began in a back session in that session\'s own chat', async () => {
  const { host, records } = made();
  const client = await anyone(host);
  await talkTo(client);
  const backSession = 'ahp-session:/back';
  const backChat = chatUriFor(backSession);
  await client.handle({ method: 'createSession', params: { channel: backSession, provider: 'base' } });
  await client.handle({ method: 'subscribe', params: { channel: backChat } });
  // The row that makes this the back session of the bot for this host.
  await (await records.collection(sessionsOf('backer'))).put({
    id: rowId(['backer', 'test', 'work']), bot: 'backer', user: 'test', name: 'work', session: backSession,
  });

  await client.handle({
    method: 'dispatchAction',
    params: { channel: backChat, action: { type: 'chat/turnStarted', turnId: 'b1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'typed on the back session' } } },
  });
  const backState = async (): Promise<Bag> => (await client.handle({ method: 'subscribe', params: { channel: backChat } }) as {
    snapshot: { state: Bag };
  }).snapshot.state;
  await vi.waitFor(async () => { expect((await backState())['turns']).toHaveLength(1); });

  // Watched for as long as a turn of the main chat's own took to open for it.
  let shown = false;
  for (let tries = 0; tries < 50 && !shown; tries++) {
    const state = await stateOf(client);
    shown = state['activeTurn'] !== undefined || ((state['turns'] as Bag[] | undefined) ?? []).length > 0;
    if (!shown) await new Promise((rest) => { setTimeout(rest, 10); });
  }
  expect(shown).toBe(false);
});

it('sends calls as the protocol declares them, and a late client reads them the same way', async () => {
  const back = `ahp-chat://default/${Buffer.from('bot:/backer/ana/work', 'utf8').toString('base64url')}`;
  const { host } = made({}, [], { heard: (_message, handle) => { handle.subagent?.(back, 'Backer'); handle.complete('done'); } });
  const notes: Notes = [];
  const client = await anyone(host, notes);
  await talkTo(client);
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: CHAT } }));

  // A client's message as the protocol declares one, with its origin.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
  });

  const late = await client.handle({ method: 'subscribe', params: { channel: CHAT } });
  const calls = ((((late as Bag)['snapshot'] as Bag)['state'] as Bag)['turns'] as Bag[])
    .flatMap((turn) => turn['responseParts'] as Bag[])
    .filter((part) => part['kind'] === 'toolCall');
  expect(calls).toHaveLength(1);
  expect(undeclaredIn([...notes, { asked: 'subscribe', params: { channel: CHAT }, result: late }])).toEqual([]);
  expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, notes, CHAT)));
});

it('offers its host every protocol version the package speaks, newest first, once a message wakes a bot', async () => {
  const { host, sessions, contribution } = made({}, ['session:trust']);
  // The plugin's own connection, served by this host, with what it offered kept.
  const offered: unknown[] = [];
  const accept = host.accept.bind(host);
  contribution.connects.host = {
    ...host,
    accept: (from, principal, root, opened) => {
      const served = accept(from, principal, root, opened);
      return {
        ...served,
        handle: (request) => {
          if (request.method === 'initialize') offered.push((request.params as Bag)['protocolVersions']);
          return served.handle(request);
        },
      };
    },
  };
  const client = await anyone(host);
  // A chat with the bot, which is the chat a message wakes it in. A host with
  // no users records no owner, and the wake starts work only for a session
  // somebody holds, so it is held as a root connection's.
  await talkTo(client);
  sessions.setOwner(idOf(SESSION), 'root:local');

  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
  });

  await vi.waitFor(() => { expect(offered).toEqual([['1.0.0', '0.9.0']]); });
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

  session.sendMessage('t1', 'hello');

  expect(heard).toEqual([{ session: 'bot-chat:/again', chat: 'ahp-chat:/again', bot: 'backer', turnId: 't1', text: 'hello' }]);
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

/*
 * Two people, each with a bot of their own: a picker offers each person only
 * the bots they may read, and a chat with the other one's bot is refused as a
 * bot that does not exist.
 */
it('offers a person only the bots they may read, and refuses a chat with another\'s', async () => {
  const { configDir, records } = made();
  const bots = await records.collection('bots');
  for (const [id, owner] of [['anas', 'user:ana'], ['bobs', 'user:bob']] as const) {
    await bots.put({
      id, name: id, labels: [], body: 'robot', color: 'red', workspace: join(configDir, BOTS_DIR, id), owner,
      createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z',
    });
  }
  const agent = await backend(configDir, records);
  const person = (id: string): Principal => ({ id, roles: [], can: () => false });
  const ana = person('ana');

  const offered = await agent.completions!['bot']!({ property: 'bot', query: '', reader: ana });
  expect(offered.map((one) => one.value)).toEqual(['anas']);
  // No reader is the root connection, or a host with no users: every bot.
  expect((await agent.completions!['bot']!({ property: 'bot', query: '' })).map((one) => one.value).sort()).toEqual(['anas', 'bobs']);

  const start = (bot: string): Start => ({
    uri: `bot-chat:/${bot}-chat`, chatUri: `ahp-chat:/${bot}-chat`, settings: { bot },
    schema: () => ({}), emit: () => {}, clientToolTimeoutMs: 0, reader: ana,
  } as Start);
  expect(() => agent.create(start('bobs'))).toThrow('There is no bot bobs.');
  expect(agent.create(start('anas'))).toBeDefined();
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

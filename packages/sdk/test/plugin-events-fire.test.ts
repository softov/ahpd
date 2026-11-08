import { WAIT_MS } from '../../../tools/wait.ts';
import { expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { localPath } from '../src/resources/fileuri.js';
import { uriOf } from '../src/resources/resources.js';
import { createHost } from '../src/host.js';
import { memoryAutomations } from '../src/automations/automations.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { EventName, HostEvent } from '../src/types/events.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { ResourceProvider, ResourceStore } from '../src/types/resources.js';
import type { Emit } from '../src/types/session.js';
import type { TerminalStore } from '../src/types/terminals.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';
import type { Principal, Users } from '../src/types/users.js';

/*
 * The first events, at the host's own moments.
 *
 * A plugin subscribed to every event, one host driven the way `test/host.test.ts`
 * drives one, and one case per event: what fired, how many times, and with what
 * the moment knew. A turn that streamed several deltas is deliberately one of
 * them, because "no event per token" is a rule and not an omission.
 */

const DIR = '/tmp/plugin-events';
const ROOT = 'ahp-root://';
const AUTOMATIONS = 'ahp-automations://';

const EVENT_NAMES: readonly EventName[] = [
  'session_start', 'session_end', 'session_opened', 'turn_start', 'turn_end', 'message', 'tool_call',
  'plan_update',
  'input_needed_set', 'input_needed_removed',
  'client_connect', 'client_disconnect', 'authenticated', 'automation_fire',
  'resource_write', 'terminal_open', 'log',
];

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const wait = async (ms: number): Promise<void> => { await new Promise((r) => { setTimeout(r, ms); }); };

const context = (): LoaderContext => ({ path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: () => {}, say: () => {} });

/** One host, one plugin subscribed to everything, and what it saw. */
function watched(extra: Partial<HostOptions> = {}, breaks?: EventName) {
  const seen: HostEvent[] = [];
  const lines: string[] = [];
  const { host: plugin, contribution } = pluginHost('probe', context());
  for (const name of EVENT_NAMES) plugin.on(name, (event) => {
    seen.push(event);
    if (name === breaks) throw new Error('probe broke');
  });

  const base: HostOptions = {
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    onEvent: (line) => { lines.push(line); },
    ...extra,
  };
  const { options } = foldHostOptions(base, [contribution]);
  const p = peer();
  const host = createHost(options);
  const client = host.accept(p);
  return { seen, lines, host, client, peer: p };
}

const hello = (client: ReturnType<ReturnType<typeof createHost>['accept']>) => client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
});

/** The chat the host minted for a session, read off its state as a client reads it. */
const mintedChat = async (client: ReturnType<ReturnType<typeof createHost>['accept']>, session: string): Promise<string> =>
  ((await client.handle({ method: 'subscribe', params: { channel: session } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;

const of = (seen: HostEvent[], type: EventName): HostEvent[] => seen.filter((event) => event.type === type);

/** A backend that calls the host's first contributed tool as it starts. */
const tooler = (outcome: (said: string) => void): Agent => {
  const inner = echo({ path: DIR, pace: 0 });
  return {
    ...inner,
    provider: 'tooler',
    displayName: 'Tooler',
    create: (start) => {
      const tool = start.tools?.[0];
      if (tool?.run !== undefined) {
        void Promise.resolve(tool.run({})).then(
          () => { outcome('ok'); },
          (error: unknown) => { outcome(`threw: ${error instanceof Error ? error.message : String(error)}`); },
        );
      }
      return inner.create(start);
    },
  };
};

/**
 * A backend that hands its emitter to the test, so the test decides when a
 * session begins and stops waiting on a person.
 */
function asker(): { agent: Agent; say: (action: Bag) => void; ask: (action: Bag) => void; chat: () => string } {
  const inner = echo({ path: DIR, pace: 0 });
  let emit: Emit | undefined;
  let chatUri = '';
  return {
    agent: {
      ...inner,
      provider: 'asker',
      displayName: 'Asker',
      create: (start) => {
        emit = start.emit;
        chatUri = start.chatUri;
        return inner.create(start);
      },
    },
    say: (action) => { emit?.('session', action); },
    ask: (action) => { emit?.('chat', action); },
    chat: () => chatUri,
  };
}

/** A backend whose every turn starts and then ends in `chat/error`. */
const failer = (): Agent => {
  const inner = echo({ path: DIR, pace: 0 });
  return {
    ...inner,
    provider: 'failer',
    displayName: 'Failer',
    create: (start) => {
      const session = inner.create(start);
      return {
        ...session,
        sendMessage: (turnId, text) => {
          start.emit('chat', { type: 'chat/turnStarted', turnId, message: { text } });
          start.emit('chat', {
            type: 'chat/error',
            turnId,
            duration: 1,
            part: { kind: 'error', error: { errorType: 'turnFailed', message: 'the model refused' } },
          });
        },
      };
    },
  };
};

/** A backend whose every send throws before it runs the turn. */
const thrower = (): Agent => {
  const inner = echo({ path: DIR, pace: 0 });
  return {
    ...inner,
    provider: 'thrower',
    displayName: 'Thrower',
    create: (start) => ({ ...inner.create(start), sendMessage: () => { throw new Error('the CLI is gone'); } }),
  };
};

const probeTool =(run: () => Promise<string> | string): HostTool => ({
  definition: { name: 'probe_tool', description: 'A tool the test calls.', inputSchema: { type: 'object', properties: {} } },
  run,
});

/** Two people, because who sent a turn is a connection's business and not a session's. */
const PEOPLE: Record<string, Principal> = {
  ana: {
    id: 'ana', roles: [], can: () => true,
    memberships: ['backend:ahpd'], primary: 'backend:ahpd', projects: [{ id: 'ahpd' }], teams: [{ id: 'backend' }],
  },
  bo: {
    id: 'bo', roles: [], can: () => true,
    memberships: ['backend:controllr'], primary: 'backend:controllr', projects: [{ id: 'controllr' }],
    teams: [{ id: 'backend' }],
  },
};

/** A directory, for a host to have somebody to name. Nobody authenticates against it here. */
const directory = (): Users => ({
  resource: { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: [], required: false },
  verify: async () => undefined,
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [{ id: 'backend' }],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

/** A turn event as the two facts a turn carries: which one, and who sent it. */
const asked = (event: HostEvent): { turn: string; sender?: string } => {
  const { sender } = event as { sender?: string };
  const turn = event.type === 'turn_end' ? event.turnId : (event as { turn: string }).turn;
  return sender === undefined ? { turn } : { turn, sender };
};

/**
 * What one client says into a chat, under the id it gives it, in the shape the
 * protocol gives a start or a queued message: the host says a client's action
 * as the client sent it.
 */
const said = (id: string, text: string, type: string): Bag => (type === 'chat/turnStarted'
  ? { type, turnId: id, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } }
  : { type, kind: 'queued', id, message: { text, origin: { kind: 'user' } } });

/** One client saying something into a chat, under the id it gives it. */
const send = (
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  channel: string,
  id: string,
  text: string,
  type = 'chat/turnStarted',
) => client.handle({
  method: 'dispatchAction',
  params: { channel, action: said(id, text, type) },
});

it('fires session_start with its provider, and session_end when it is disposed', async () => {
  const { seen, client } = watched();
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
  await settle();

  const started = of(seen, 'session_start');
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ session: 'ahp-session:/one', provider: 'echo', client: 'probe' });

  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await settle();
  const ended = of(seen, 'session_end');
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({ session: 'ahp-session:/one' });
});

it('names the creating client, and one client per subscription that opened a session', async () => {
  const { seen, host, client } = watched();
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/opened', provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/opened' } });
  await settle();

  // A person's second window is a second client, and it opens the session
  // again under its own id. Subscribing twice is still one opening.
  const second = host.accept(peer());
  await second.handle({
    method: 'initialize',
    params: { clientId: 'second', protocolVersions: ['0.9.0'], initialSubscriptions: [] },
  });
  await second.handle({ method: 'subscribe', params: { channel: 'ahp-session:/opened' } });
  await second.handle({ method: 'subscribe', params: { channel: 'ahp-session:/opened' } });
  await settle();

  const started = of(seen, 'session_start');
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ session: 'ahp-session:/opened', client: 'probe' });

  const opened = of(seen, 'session_opened');
  expect(opened.map((event) => (event as { client: string }).client)).toEqual(['probe', 'second']);
  expect(opened[0]).toMatchObject({ session: 'ahp-session:/opened' });
});

it('leaves the client off a session no client created', async () => {
  const { seen, client } = watched({ automations: memoryAutomations() });
  await hello(client);
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: AUTOMATIONS,
      action: {
        type: 'automation/createRequested',
        resource: 'ahp-automation:/alone',
        definition: {
          title: 'Alone',
          enabled: true,
          message: { text: 'review' },
          session: { provider: 'echo', workingDirectories: [`file://${DIR}`] },
          triggers: [],
        },
      },
    },
  });
  await client.handle({ method: 'runAutomation', params: { channel: AUTOMATIONS, automation: 'ahp-automation:/alone', requestId: 'r1' } });
  await settle();

  const started = of(seen, 'session_start');
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ provider: 'echo' });
  expect((started[0] as { client?: string }).client).toBeUndefined();
});

it('hands a provider the client that wrote to it', async () => {
  const written: { uri: string; client: string | undefined }[] = [];
  const scheme: ResourceProvider = {
    read: async () => ({ data: '', encoding: 'utf-8' }),
    write: async (uri, _content, _owner, client) => { written.push({ uri, client }); },
  };
  const { client } = watched({ resourceProviders: { probe: scheme } });
  await hello(client);
  await client.handle({
    method: 'resourceWrite',
    params: { channel: ROOT, uri: 'probe://devices/one', data: '{}', encoding: 'utf-8' },
  });
  await settle();

  expect(written).toEqual([{ uri: 'probe://devices/one', client: 'probe' }]);
});

it('fires message, turn_start and turn_end once each, and nothing per delta', async () => {
  const { seen, client } = watched({ agents: [echo({ path: DIR, pace: 60 })] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/turn', provider: 'echo' } });
  const chat = await mintedChat(client, 'ahp-session:/turn');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 'turn-1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello there' } } },
  });
  await wait(500);

  const about = seen.filter((event) => event.type === 'message' || event.type === 'turn_start' || event.type === 'turn_end');
  expect(about.map((event) => event.type)).toEqual(['message', 'turn_start', 'turn_end']);
  // The host's own session and chat URIs, whatever a client spells them as:
  // the event carries what the host calls the channel, which is the identity
  // it uses everywhere, and a session is held under its provider's name.
  expect(about[0]).toMatchObject({ session: 'ahp-session:/turn', chat: expect.stringMatching(/^ahp-chat:/), turn: 'turn-1', text: 'hello there' });
  expect(about[1]).toMatchObject({ turn: 'turn-1' });
  // VS Code's ITurnEnd: the session, the channel the turn ran on, its id and why it ended.
  expect(about[2]).toEqual({
    type: 'turn_end', session: 'ahp-session:/turn', channel: (about[0] as { chat: string }).chat, turnId: 'turn-1', reason: { kind: 'success' },
  });
});

/*
 * A turn that takes up a queued message names it, so a plugin that queued the
 * message knows which turn it became: the queued message's id is the one thing
 * it holds of it.
 */
it('names the queued message a turn took up on its turn_start', async () => {
  const { seen, client } = watched({ agents: [echo({ path: DIR, pace: 0 })] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/queued', provider: 'echo' } });
  const chat = await mintedChat(client, 'ahp-session:/queued');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q-1', message: { text: 'later', origin: { kind: 'user' } } } },
  });
  await wait(200);

  const started = seen.filter((event) => event.type === 'turn_start');
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ session: 'ahp-session:/queued', queuedMessageId: 'q-1' });
});

it('fires turn_end cancelled when a running turn is stopped', async () => {
  const { seen, client } = watched({ agents: [echo({ path: DIR, pace: 60 })] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/cancel', provider: 'echo' } });
  const chat = await mintedChat(client, 'ahp-session:/cancel');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 'turn-c', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'one two three four five' } } },
  });
  await settle(1);
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnCancelled', turnId: 'turn-c', duration: 0 } },
  });
  await wait(200);

  const ended = of(seen, 'turn_end');
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({ turnId: 'turn-c', reason: { kind: 'cancelled' } });
});

it('fires turn_end error, with the message and its type, when a turn ends in chat/error', async () => {
  const { seen, client } = watched({ agents: [failer()] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/fail', provider: 'failer' } });
  const chat = await mintedChat(client, 'ahp-session:/fail');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 'turn-f', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
  });
  await wait(100);

  const ended = of(seen, 'turn_end');
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({
    turnId: 'turn-f', reason: { kind: 'error', error: { errorType: 'turnFailed', message: 'the model refused' }, resumable: false },
  });
});

/*
 * The ends this host says itself raise `turn_end` as its backend's do, each
 * with how it ended: a start refused before any backend ran it is `rejected`,
 * with the refusal's words and a sender still holding the message, a send
 * that failed is an `error`, and a `!` command the host ran is a
 * `localCommand`, as VS Code's host offers each to its contributions'
 * `onTurnEnd`. A refused start was handed to nobody, so no `turn_start` comes
 * before it; a send that failed was handed to its backend first, and a
 * command to its chat.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatContributionsService.ts#L19-L49
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnStarter.ts#L95-L111
 */
it('fires turn_end rejected, with the refusal, for a start the host refuses before any backend runs it', async () => {
  const { seen, client } = watched();
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/filed', provider: 'echo' } });
  const chat = await mintedChat(client, 'ahp-session:/filed');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-session:/filed', clientSeq: 1, action: { type: 'session/isArchivedChanged', isArchived: true } },
  });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, clientSeq: 2, action: { type: 'chat/turnStarted', turnId: 'turn-r', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
  });
  await wait(100);

  expect(of(seen, 'turn_start')).toEqual([]);
  expect(of(seen, 'turn_end')).toEqual([expect.objectContaining({
    session: 'ahp-session:/filed',
    channel: chat,
    turnId: 'turn-r',
    reason: {
      kind: 'rejected',
      error: { errorType: 'archived', message: 'This session is archived and read-only. Restore the session to continue the conversation.' },
      recoverable: true,
    },
  })]);
});

it('fires turn_end rejected for a queued message the host will not run, naming the message its sender still holds', async () => {
  const { seen, client, host } = watched();
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/stopping', provider: 'echo' } });
  const chat = await mintedChat(client, 'ahp-session:/stopping');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  host.refuseTurns('This host is stopping');
  await send(client, chat, 'q-1', 'later', 'chat/pendingMessageSet');
  await wait(100);

  expect(of(seen, 'turn_end')).toEqual([expect.objectContaining({
    reason: { kind: 'rejected', error: { errorType: 'rejected', message: 'This host is stopping' }, recoverable: true },
    queuedMessageId: 'q-1',
  })]);
});

/*
 * A worker's chat raises its turn's end as every chat does, on the worker's
 * chat, as VS Code's host offers a subagent chat's turn end on the channel it
 * ran on.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatContributionsService.ts#L39-L49
 */
it('fires turn_end for a worker\'s turn, on the worker\'s chat', async () => {
  let start: Start | undefined;
  const inner = echo({ path: DIR, pace: 0 });
  const agent: Agent = { ...inner, create: (given) => { start = given; return inner.create(given); } };
  const { seen, client } = watched({ agents: [agent] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/lead', provider: 'echo' } });
  const worker = start?.subagent?.('call-1', { title: 'A worker', prompt: 'go' });
  if (worker === undefined) throw new Error('the host offered no subagent seam');
  worker.end('error', 'the worker gave up');
  await wait(50);

  expect(of(seen, 'turn_end')).toEqual([expect.objectContaining({
    session: 'ahp-session:/lead',
    channel: worker.uri,
    turnId: worker.turnId,
    reason: { kind: 'error', error: { errorType: 'subagentFailed', message: 'the worker gave up' }, resumable: false },
  })]);
});

it('fires turn_end error, with the failure, for a turn whose send fails before its backend runs it', async () => {
  const { seen, client } = watched({ agents: [thrower()] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/gone', provider: 'thrower' } });
  const chat = await mintedChat(client, 'ahp-session:/gone');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  await send(client, chat, 'turn-s', 'hello');
  await wait(100);

  expect(of(seen, 'turn_start').map(asked)).toEqual([{ turn: 'turn-s' }]);
  expect(of(seen, 'turn_end')).toEqual([expect.objectContaining({
    turnId: 'turn-s', reason: { kind: 'error', error: { errorType: 'sendFailed', message: 'the CLI is gone' }, resumable: false },
  })]);
});

it('fires turn_end localCommand for a ! command the host ran as the turn', async () => {
  const { seen, client } = watched({ terminals: shellTerminals() });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/bang', provider: 'echo' } });
  const chat = await mintedChat(client, 'ahp-session:/bang');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  await send(client, chat, 'turn-b', '!echo here');
  for (let i = 0; i < 200 && of(seen, 'turn_end').length === 0; i++) await wait(25);

  expect(of(seen, 'turn_end')).toEqual([expect.objectContaining({ turnId: 'turn-b', reason: { kind: 'localCommand' } })]);
  expect(of(seen, 'turn_start').map(asked)).toEqual([{ turn: 'turn-b' }]);
});

it('names who sent each turn, and a queued message keeps its sender when it runs', async () => {
  const { seen, host } = watched({ agents: [echo({ path: DIR, pace: 0 })], users: directory() });
  const ana = host.accept(peer(), PEOPLE.ana);
  await hello(ana);
  await ana.handle({ method: 'createSession', params: { channel: 'ahp-session:/shared', provider: 'echo' } });
  const chat = await mintedChat(ana, 'ahp-session:/shared');
  const bo = host.accept(peer(), PEOPLE.bo);
  await hello(bo);

  // One session, two people, and a question each of them asked in it: the
  // session says whose work it is, and only the turn says which of them it was.
  await send(ana, chat, 'turn-a', 'hello there');
  await wait(100);
  await send(bo, chat, 'turn-b', 'and again');
  await wait(100);
  await send(bo, chat, 'turn-c', 'last one');
  // And one that waited its turn, which this host starts under a turn id of
  // its own once the chat is idle, the sender the one who queued it.
  await send(bo, chat, 'left-behind', 'and one more', 'chat/pendingMessageSet');
  await wait(200);

  const started = of(seen, 'turn_start').map(asked);
  expect(started).toHaveLength(4);
  expect(started.slice(0, 3)).toEqual([
    { turn: 'turn-a', sender: 'user:ana' },
    { turn: 'turn-b', sender: 'user:bo' },
    { turn: 'turn-c', sender: 'user:bo' },
  ]);
  expect(started[3]).toEqual({ turn: expect.stringMatching(/[0-9a-f-]{36}/), sender: 'user:bo' });
  // And the sender a usage record will want is on the end of the turn too.
  expect(of(seen, 'turn_end').map(asked)).toEqual(started);
});

/*
 * Who sent a turn rides its start on the wire, as upstream decided (Softov,
 * 2026-10-02: "`_meta` on the wire"): `ahpd.sender` on the action and on its
 * message, the spec's `_meta` place for a fact it does not define. The rest of
 * a client's start goes out as the client sent it, as the reference host
 * applies a client's action and says it with the client's origin.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L779-L789
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752
 */
it('says a client\'s start on the wire with its sender, on a host with somebody to name', async () => {
  /** The `chat/turnStarted` frame a client was sent, out of what it saw. */
  const started = (notes: { method: string; params: unknown }[]): Bag | undefined => notes
    .filter((note) => note.method === 'action')
    .map((note) => (note.params as { action: Bag }).action)
    .find((action) => action.type === 'chat/turnStarted');

  const named = watched({ agents: [echo({ path: DIR, pace: 0 })], users: directory() });
  const on = peer();
  const ana = named.host.accept(on, PEOPLE.ana);
  await hello(ana);
  await ana.handle({ method: 'createSession', params: { channel: 'ahp-session:/who', provider: 'echo' } });
  const chat = await mintedChat(ana, 'ahp-session:/who');
  // Watching the chat first, because an action goes to whoever is listening.
  await ana.handle({ method: 'subscribe', params: { channel: chat } });
  const action = said('turn-who', 'hello there', 'chat/turnStarted');
  await ana.handle({ method: 'dispatchAction', params: { channel: chat, action } });
  await wait(100);
  const sender = { 'ahpd.sender': 'user:ana' };
  expect(started(on.notes)).toEqual({ ...action, _meta: sender, message: { ...(action.message as Bag), _meta: sender } });
  expect(of(named.seen, 'turn_start').map(asked)).toEqual([{ turn: 'turn-who', sender: 'user:ana' }]);
});

/*
 * The daemon's `turnSenders` at `kept`, VS Code's: the host keeps who sent a
 * turn, for its events and its store, and says it in no action and no turn a
 * client reads back.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatContributionsService.ts#L183-L199
 */
it('keeps a turn\'s sender off the wire and in its events, where the daemon keeps senders', async () => {
  const named = watched({ agents: [echo({ path: DIR, pace: 0 })], users: directory(), turnSenders: 'kept' });
  const on = peer();
  const ana = named.host.accept(on, PEOPLE.ana);
  await hello(ana);
  await ana.handle({ method: 'createSession', params: { channel: 'ahp-session:/kept', provider: 'echo' } });
  const chat = await mintedChat(ana, 'ahp-session:/kept');
  await ana.handle({ method: 'subscribe', params: { channel: chat } });
  const action = said('turn-kept', 'hello there', 'chat/turnStarted');
  await ana.handle({ method: 'dispatchAction', params: { channel: chat, action } });
  await wait(100);

  const frames = on.notes.filter((note) => note.method === 'action').map((note) => (note.params as { action: Bag }).action);
  expect(frames.find((one) => one.type === 'chat/turnStarted')).toEqual(action);
  const read = await ana.handle({ method: 'subscribe', params: { channel: chat } }) as { snapshot: { state: { turns: Bag[] } } };
  expect(read.snapshot.state.turns.map((turn) => (turn.message as Bag)._meta)).toEqual([undefined]);
  expect(of(named.seen, 'turn_start').map(asked)).toEqual([{ turn: 'turn-kept', sender: 'user:ana' }]);
  expect(of(named.seen, 'turn_end').map(asked)).toEqual([{ turn: 'turn-kept', sender: 'user:ana' }]);
});

it('names the maker of an automation as the sender of the turn it started', async () => {
  const store = memoryAutomations();
  const { seen, host } = watched({ agents: [echo({ path: DIR, pace: 0 })], users: directory(), automations: store });
  const ana = host.accept(peer(), PEOPLE.ana);
  await hello(ana);
  await ana.handle({
    method: 'dispatchAction',
    params: {
      channel: AUTOMATIONS,
      action: {
        type: 'automation/createRequested',
        resource: 'ahp-automation:/nightly',
        definition: {
          title: 'Nightly',
          enabled: true,
          message: { text: 'review what changed today' },
          session: { provider: 'echo', workingDirectories: [`file://${DIR}`] },
          triggers: [],
        },
      },
    },
  });
  expect(store.get('ahp-automation:/nightly')?._meta?.['ahpd.owner']).toBe('user:ana');

  // Somebody else presses Run, and there is nobody at the keyboard to send the
  // turn it starts: it is sent by whoever wrote the automation down.
  const bo = host.accept(peer(), PEOPLE.bo);
  await hello(bo);
  await bo.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: 'ahp-automation:/nightly', requestId: 'r1' },
  });
  await wait(200);

  expect(of(seen, 'turn_start').map(asked))
    .toEqual([{ turn: expect.stringMatching(/[0-9a-f-]{36}/), sender: 'user:ana' }]);
});

it('fires tool_call once, after a host tool answered', async () => {
  const outcomes: string[] = [];
  const { seen, client } = watched({ agents: [tooler((said) => outcomes.push(said))], tools: [probeTool(() => 'fine')] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/tool', provider: 'tooler' } });
  await settle();

  expect(outcomes).toEqual(['ok']);
  const calls = of(seen, 'tool_call');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ session: 'ahp-session:/tool', tool: 'probe_tool', ok: true });
});

it('tells a host tool which agent the calling session runs', async () => {
  const providers: (string | undefined)[] = [];
  const asking: HostTool = {
    definition: { name: 'probe_tool', description: 'A tool the test calls.', inputSchema: { type: 'object', properties: {} } },
    run: (_input, at) => { providers.push(at.provider); return 'fine'; },
  };
  const { client } = watched({ agents: [tooler(() => {})], tools: [asking] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/which', provider: 'tooler' } });
  await settle();
  expect(providers).toEqual(['tooler']);
});

it('fires tool_call with the failure when a host tool throws', async () => {
  const outcomes: string[] = [];
  const { seen, client } = watched({
    agents: [tooler((said) => outcomes.push(said))],
    tools: [probeTool(() => { throw new Error('boom'); })],
  });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/bad-tool', provider: 'tooler' } });
  await settle();

  expect(outcomes).toEqual(['threw: boom']);
  const calls = of(seen, 'tool_call');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ tool: 'probe_tool', ok: false, error: 'boom' });
});

it('fires client_connect on initialize and client_disconnect on close', async () => {
  const { seen, client } = watched();
  await hello(client);
  await settle();
  expect(of(seen, 'client_connect').map((event) => (event as { client: string }).client)).toEqual(['probe']);

  client.close();
  await settle();
  expect(of(seen, 'client_disconnect').map((event) => (event as { client: string }).client)).toEqual(['probe']);
});

it('fires authenticated when a client pushes a token for one of its resources', async () => {
  const resource = 'https://example.test';
  const { seen, client } = watched({
    agents: [{ ...echo({ path: DIR, pace: 0 }), protectedResources: [{ resource }] }],
  });
  await hello(client);
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource, token: 'shh' } });
  await settle();

  const auth = of(seen, 'authenticated');
  expect(auth).toHaveLength(1);
  expect(auth[0]).toMatchObject({ client: 'probe', resource });
});

it('fires resource_write once the store accepted the write', async () => {
  const store: ResourceStore = {
    list: async () => [],
    read: async () => ({ data: '', encoding: 'utf-8' }),
    resolve: async () => ({ type: 'file', uri: 'file:///tmp/x' }) as never,
    complete: async () => [],
    write: async () => {},
  };
  const { seen, client } = watched({ resources: store });
  await hello(client);
  await client.handle({ method: 'resourceRequest', params: { channel: ROOT, uri: 'file:///tmp/x', write: true } });
  await client.handle({ method: 'resourceWrite', params: { channel: ROOT, uri: 'file:///tmp/x', data: 'x', encoding: 'utf-8' } });
  await settle();

  const writes = of(seen, 'resource_write');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ uri: 'file:///tmp/x' });
});

it('fires terminal_open once the terminal exists', async () => {
  const store = {
    create: (options: { uri: string; cwd: string; claim: unknown; name?: string }) => ({
      uri: options.uri,
      title: () => options.name ?? 'Terminal',
      claim: () => options.claim,
      lifecycle: () => ({ status: 'running' }),
      state: () => ({ isPty: false }),
    }),
  } as unknown as TerminalStore;
  const { seen, client } = watched({ terminals: store });
  await hello(client);
  // A folder that is there on every platform, as one that is not opens in the home folder.
  await client.handle({ method: 'createTerminal', params: { channel: 'ahp-terminal:/one', claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(tmpdir()) } });
  // Fired once the folder is read, which a busy runner takes longer than a few ticks to do.
  for (const until = Date.now() + WAIT_MS; Date.now() < until && of(seen, 'terminal_open').length === 0;) await wait(10);
  await settle();

  const opened = of(seen, 'terminal_open');
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({ terminal: 'ahp-terminal:/one', cwd: localPath(uriOf(tmpdir())) });
});

it('fires automation_fire when an automation starts a session', async () => {
  const { seen, client } = watched({ automations: memoryAutomations() });
  await hello(client);
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: AUTOMATIONS,
      action: {
        type: 'automation/createRequested',
        resource: 'ahp-automation:/nightly',
        definition: {
          title: 'Nightly',
          enabled: true,
          message: { text: 'review' },
          session: { provider: 'echo', workingDirectories: [`file://${DIR}`] },
          triggers: [],
        },
      },
    },
  });
  await client.handle({ method: 'runAutomation', params: { channel: AUTOMATIONS, automation: 'ahp-automation:/nightly', requestId: 'r1' } });
  await settle();

  const fired = of(seen, 'automation_fire');
  expect(fired).toHaveLength(1);
  expect(fired[0]).toMatchObject({ automation: 'ahp-automation:/nightly' });
});

/*
 * The session's entries are the host's, raised from the chat's state under
 * VS Code's ids, and each is told to the plugins as it is said.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L51-L101
 */
it('fires input_needed_set and input_needed_removed as the host raises a question\'s entry and takes it down', async () => {
  const { agent, ask, chat } = asker();
  const { seen, client } = watched({ agents: [agent] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/ask', provider: 'asker' } });
  await settle();

  ask({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'go', origin: { kind: 'user' } } });
  ask({ type: 'chat/inputRequested', request: { id: 'ask-1', message: 'Which one?' } });
  ask({ type: 'chat/inputCompleted', requestId: 'ask-1', response: 'cancel' });
  await settle();

  // A plugin that says so watches nothing else. In the order said.
  const about = seen.filter((event) => event.type === 'input_needed_set' || event.type === 'input_needed_removed');
  const id = `chatInput:${chat()}:ask-1`;
  expect(about.map((event) => event.type)).toEqual(['input_needed_set', 'input_needed_removed']);
  expect(about[0]).toMatchObject({ session: 'ahp-session:/ask', chat: chat(), id, kind: 'chatInput' });
  expect(about[1]).toMatchObject({ session: 'ahp-session:/ask', id });
});

it('says no entry a backend raises itself, nor its event', async () => {
  const { agent, say } = asker();
  const { seen, client } = watched({ agents: [agent] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/bare', provider: 'asker' } });
  await settle();

  say({ type: 'session/inputNeededSet', request: { id: 'own', chat: 'ahp-chat:/bare', kind: 'chatInput' } });
  say({ type: 'session/inputNeededRemoved', id: 'own' });
  await settle();

  expect(of(seen, 'input_needed_set')).toHaveLength(0);
  expect(of(seen, 'input_needed_removed')).toHaveLength(0);
});

it('reports a handler that throws on input_needed_set and still reaches the client', async () => {
  const { agent, ask } = asker();
  const { lines, client, peer: p } = watched({ agents: [agent] }, 'input_needed_set');
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/broken', provider: 'asker' } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/broken' } });
  await settle();

  ask({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'go', origin: { kind: 'user' } } });
  ask({ type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'write', displayName: 'Write' });
  ask({ type: 'chat/toolCallReady', turnId: 't1', toolCallId: 'c1', invocationMessage: 'Write a file' });
  await settle();

  expect(lines.filter((line) => line.includes('probe failed at input_needed_set: probe broke'))).toHaveLength(1);
  const answered = p.notes
    .filter((one) => one.method === 'action')
    .map((one) => one.params as { channel: string; action: Record<string, unknown> })
    .filter((one) => one.channel === 'ahp-session:/broken');
  expect(answered.map((one) => one.action.type)).toContain('session/inputNeededSet');
});

it('fires log with the same line onEvent receives', async () => {
  const { seen, lines, client } = watched();
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/log', provider: 'echo' } });
  await settle();

  const logged = of(seen, 'log').map((event) => (event as { line: string }).line);
  expect(lines.length).toBeGreaterThan(0);
  expect(logged).toEqual(lines);
});

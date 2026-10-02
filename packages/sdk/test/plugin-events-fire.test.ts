import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { memoryAutomations } from '../src/automations.js';
import { foldHostOptions, pluginHost } from '../src/plugins.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { EventName, HostEvent } from '../src/types/events.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { ResourceStore } from '../src/types/resources.js';
import type { Emit } from '../src/types/session.js';
import type { TerminalStore } from '../src/types/terminals.js';
import type { PluginContext } from '../src/types/plugin.js';
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
  'session_start', 'session_end', 'turn_start', 'turn_end', 'message', 'tool_call',
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

const context = (): PluginContext => ({ path: DIR, paths: [DIR], version: sdkVersion(), log: () => {}, say: () => {} });

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
  params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: [ROOT] },
});

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
function asker(): { agent: Agent; say: (action: Bag) => void } {
  const inner = echo({ path: DIR, pace: 0 });
  let emit: Emit | undefined;
  return {
    agent: {
      ...inner,
      provider: 'asker',
      displayName: 'Asker',
      create: (start) => {
        emit = start.emit;
        return inner.create(start);
      },
    },
    say: (action) => { emit?.('session', action); },
  };
}

const probeTool = (run: () => Promise<string> | string): HostTool => ({
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
  const { turn, sender } = event as { turn: string; sender?: string };
  return sender === undefined ? { turn } : { turn, sender };
};

/** One client saying something into a chat, under the id it calls the turn. */
const send = (
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  channel: string,
  id: string,
  text: string,
  type = 'chat/turnStarted',
) => client.handle({
  method: 'dispatchAction',
  params: { channel, action: { type, id, kind: 'queued', turnId: id, message: { text } } },
});

it('fires session_start with its provider, and session_end when it is disposed', async () => {
  const { seen, client } = watched();
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
  await settle();

  const started = of(seen, 'session_start');
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ session: 'echo:/one', provider: 'echo' });

  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await settle();
  const ended = of(seen, 'session_end');
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({ session: 'echo:/one' });
});

it('fires message, turn_start and turn_end once each, and nothing per delta', async () => {
  const { seen, client } = watched({ agents: [echo({ path: DIR, pace: 60 })] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/turn', provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/turn' } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/turn', action: { type: 'chat/turnStarted', turnId: 'turn-1', message: { text: 'hello there' } } },
  });
  await wait(500);

  const about = seen.filter((event) => event.type === 'message' || event.type === 'turn_start' || event.type === 'turn_end');
  expect(about.map((event) => event.type)).toEqual(['message', 'turn_start', 'turn_end']);
  // The host's own session and chat URIs, not the client's aliases for them:
  // the event carries what the host calls the channel, which is the identity
  // it uses everywhere, and a session is held under its provider's name.
  expect(about[0]).toMatchObject({ session: 'echo:/turn', chat: expect.stringMatching(/^ahp-chat:/), turn: 'turn-1', text: 'hello there' });
  expect(about[1]).toMatchObject({ turn: 'turn-1' });
  expect(about[2]).toMatchObject({ turn: 'turn-1', status: 'complete' });
});

it('fires turn_end cancelled when a running turn is stopped', async () => {
  const { seen, client } = watched({ agents: [echo({ path: DIR, pace: 60 })] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/cancel', provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/cancel' } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/cancel', action: { type: 'chat/turnStarted', turnId: 'turn-c', message: { text: 'one two three four five' } } },
  });
  await settle(1);
  client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/cancel', action: { type: 'chat/turnCancelled', turnId: 'turn-c' } },
  });
  await wait(200);

  const ended = of(seen, 'turn_end');
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({ turn: 'turn-c', status: 'cancelled' });
});

it('names who sent each turn, and a queued message keeps its sender when it runs', async () => {
  const { seen, host } = watched({ agents: [echo({ path: DIR, pace: 0 })], users: directory() });
  const chat = 'ahp-chat:/shared';
  const ana = host.accept(peer(), PEOPLE.ana);
  await hello(ana);
  await ana.handle({ method: 'createSession', params: { channel: 'ahp-session:/shared', provider: 'echo' } });
  const bo = host.accept(peer(), PEOPLE.bo);
  await hello(bo);

  // One session, two people, and a question each of them asked in it: the
  // session says whose work it is, and only the turn says which of them it was.
  await send(ana, chat, 'turn-a', 'hello there');
  await wait(100);
  await send(bo, chat, 'turn-b', 'and again');
  await wait(100);
  await send(bo, chat, 'turn-c', 'last one');
  // And one that waited its turn, which the backend reports under the queued
  // message's id rather than under a turn id the host never chose.
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
  expect(store.get('ahp-automation:/nightly')?.owner).toBe('user:ana');

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
  expect(calls[0]).toMatchObject({ session: 'tooler:/tool', tool: 'probe_tool', ok: true });
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
    }),
  } as unknown as TerminalStore;
  const { seen, client } = watched({ terminals: store });
  await hello(client);
  await client.handle({ method: 'createTerminal', params: { channel: 'ahp-terminal:/one', claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' } });
  await settle();

  const opened = of(seen, 'terminal_open');
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({ terminal: 'ahp-terminal:/one', cwd: '/tmp' });
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

it('fires input_needed_set and input_needed_removed as the backend asks and answers', async () => {
  const { agent, say } = asker();
  const { seen, client } = watched({ agents: [agent] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/ask', provider: 'asker' } });
  await settle();

  const request = { id: 'ask-1', chat: 'ahp-chat:/ask', kind: 'chatInput' };
  say({ type: 'session/inputNeededSet', request });
  // The protocol's action is an upsert keyed by `id`, so a backend that sets
  // the same entry again says it again; the handler is what dedupes.
  say({ type: 'session/inputNeededSet', request });
  say({ type: 'session/inputNeededRemoved', id: 'ask-1' });
  await settle();

  // Both ends repeat an action the client also received, and both are here
  // because a plugin that says so watches nothing else. In the order sent.
  const about = seen.filter((event) => event.type === 'input_needed_set' || event.type === 'input_needed_removed');
  expect(about.map((event) => event.type)).toEqual(['input_needed_set', 'input_needed_set', 'input_needed_removed']);
  expect(about[0]).toMatchObject({ session: 'asker:/ask', chat: 'ahp-chat:/ask', id: 'ask-1', kind: 'chatInput' });
  expect(about[2]).toMatchObject({ session: 'asker:/ask', id: 'ask-1' });
});

it('leaves the event out when the backend sends no id to raise it about', async () => {
  const { agent, say } = asker();
  const { seen, client } = watched({ agents: [agent] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/bare', provider: 'asker' } });
  await settle();

  say({ type: 'session/inputNeededSet', request: { chat: 'ahp-chat:/bare', kind: 'chatInput' } });
  say({ type: 'session/inputNeededRemoved' });
  await settle();

  // An event carrying empty strings is a notifier told about a session it
  // cannot name, and the client already has the action.
  expect(of(seen, 'input_needed_set')).toHaveLength(0);
  expect(of(seen, 'input_needed_removed')).toHaveLength(0);
});

it('reports a handler that throws on input_needed_set and still reaches the client', async () => {
  const { agent, say } = asker();
  const { lines, client, peer: p } = watched({ agents: [agent] }, 'input_needed_set');
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/broken', provider: 'asker' } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/broken' } });
  await settle();

  say({ type: 'session/inputNeededSet', request: { id: 'ask-2', chat: 'ahp-chat:/broken', kind: 'toolConfirmation' } });
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

import { expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { createPeer, receive } from '../packages/sdk/src/rpc.js';
import { nestedAgent } from '../packages/sdk/src/nested.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent, Start } from '../packages/sdk/src/types/agent.js';
import type { NestedHost } from '../packages/sdk/src/nested.js';
import type { Handler, Peer, Wire } from '../packages/sdk/src/types/rpc.js';

/*
 * The proxy: a session the outer host owns, running in a host inside a machine.
 *
 * The inner host is a real `createHost` with the echo backend, reached over an
 * in-memory pipe rather than a process - the same frames, the same JSON-RPC,
 * none of the spawning. So what is under test is the proxy's own half: that a
 * turn dispatched to it comes out of the inner session and is emitted
 * unchanged, that a confirmation and a cancel reach the inner session, that
 * the inner host's end is the outer session's end, and that every way a start
 * can fail is a sentence rather than a hang.
 *
 * The command that starts a host in a machine is the `computers` port's own
 * test (`test/nested-start.test.ts`), and the host's choice between a backend
 * and the proxy is the last case here.
 */

const PROVIDER = 'cofold';
const REPO_ROOT = '/tmp/ahpd-nested-proxy';

type Bag = Record<string, any>;

/** Wait for something the proxy does asynchronously, without a fixed sleep. */
const until = async (check: () => boolean, times = 600): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
};

/** A peer that keeps what the host told it, for the host-level case. */
const watching = (): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

/**
 * An inner host, as the process the proxy would have spawned.
 *
 * Its stdin is fed to the SDK's `receive`, so the frames the proxy writes are
 * the frames a real host would parse, and its stdout is whatever that host
 * answers - a real `createPeer` on the other end.
 */
const innerHost = (agent: Agent) => {
  const host = createHost({ path: REPO_ROOT, agents: [agent] });
  let toOuter: ((text: string) => void) | undefined;
  let closed: ((code: number | null) => void) | undefined;
  let errored: ((error: Error) => void) | undefined;
  const stderr: ((chunk: unknown) => void)[] = [];
  const innerWire: Wire = {
    send: (text) => { toOuter?.(text); },
    close: () => { /* the fake process stays open until the test ends it */ },
    isOpen: () => true,
  };
  const peer = createPeer(innerWire);
  const accepted = host.accept(peer);
  const handler: Handler = (request) => accepted.handle(request);
  const proc = {
    stdin: {
      write: (text: string): void => {
        for (const line of String(text).split('\n')) {
          if (line.trim() !== '') receive(line, peer, handler);
        }
      },
    },
    stdout: { on: (_event: string, listener: (chunk: unknown) => void) => { toOuter = (text) => listener(`${text}\n`); } },
    stderr: { on: (_event: string, listener: (chunk: unknown) => void) => { stderr.push(listener); } },
    on: (event: string, listener: (...args: never[]) => void) => {
      if (event === 'exit') closed = listener as unknown as (code: number | null) => void;
      if (event === 'error') errored = listener as unknown as (error: Error) => void;
    },
    kill: () => { /* nothing runs outside this process */ },
  } as unknown as NestedHost;
  return {
    host,
    proc,
    /** One of the host's own stderr lines. */
    say: (line: string): void => { for (const listener of stderr) listener(`${line}\n`); },
    /** The host's process going away, which is what a machine being removed does. */
    crash: (code: number | null = 1): void => { closed?.(code); },
    fail: (error: Error): void => { errored?.(error); },
  };
};

/** A host that answers only what the test scripts, for the failures. */
const scripted = (answer: (message: Bag) => Bag | undefined) => {
  let toOuter: ((text: string) => void) | undefined;
  let closed: ((code: number | null) => void) | undefined;
  let heard = 0;
  const stderr: ((chunk: unknown) => void)[] = [];
  const proc = {
    stdin: {
      write: (text: string): void => {
        for (const line of String(text).split('\n')) {
          if (line.trim() === '') continue;
          heard += 1;
          const reply = answer(JSON.parse(line) as Bag);
          if (reply !== undefined) toOuter?.(`${JSON.stringify(reply)}\n`);
        }
      },
    },
    stdout: { on: (_event: string, listener: (chunk: unknown) => void) => { toOuter = (text) => listener(text); } },
    stderr: { on: (_event: string, listener: (chunk: unknown) => void) => { stderr.push(listener); } },
    on: (event: string, listener: (...args: never[]) => void) => {
      if (event === 'exit') closed = listener as unknown as (code: number | null) => void;
    },
    kill: () => { /* nothing to kill */ },
  } as unknown as NestedHost;
  return {
    proc,
    /** Whether the proxy has written anything yet, so a test can race it. */
    heard: (): number => heard,
    say: (line: string): void => { for (const listener of stderr) listener(`${line}\n`); },
    crash: (code: number | null = 1): void => { closed?.(code); },
  };
};

/** The least a session is, for a proxy driven without the host. */
const start = (emit: (channel: 'session' | 'chat' | 'terminal', action: Bag) => void, workingDirectory?: string): Start => ({
  uri: 'ahp-session:/outer',
  chatUri: 'ahp-chat:/outer',
  settings: { computer: 'computer://box' },
  ...(workingDirectory === undefined ? {} : { workingDirectory }),
  emit,
} as unknown as Start);

/** The echo backend, under the provider the inner host serves. */
const backend = (pace = 0): Agent => ({ ...echo({ path: REPO_ROOT, pace }), provider: PROVIDER, displayName: 'Cofold' });

/** What a session emitted, in order, with the channel it came out on. */
const recorder = (): { seen: { channel: string; action: Bag }[]; emit: (channel: 'session' | 'chat' | 'terminal', action: Bag) => void } => {
  const seen: { channel: string; action: Bag }[] = [];
  return { seen, emit: (channel, action) => { seen.push({ channel, action }); } };
};

it('a turn goes in and the inner session\'s actions come out unchanged', async () => {
  const inner = innerHost(backend());
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { start: async () => inner.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));

  // Sent before the inner session exists, so it is the gate that is under test
  // as much as the turn.
  session.begin('t1', 'hello world');
  await until(() => seen.some(({ action }) => action.type === 'chat/turnComplete'));

  expect(seen.some(({ action }) => action.type === 'session/creationFailed')).toBe(false);
  const types = seen.filter(({ channel }) => channel === 'chat').map(({ action }) => action.type);
  expect(types).toContain('chat/turnStarted');
  expect(types).toContain('chat/responsePart');
  expect(types).toContain('chat/turnComplete');
  const began = seen.find(({ action }) => action.type === 'chat/turnStarted')?.action;
  expect(began?.turnId).toBe('t1');
  expect(began?.message?.text).toBe('hello world');
  // The streamed text, as the inner backend wrote it: same chunks, same turn.
  const delta = seen.filter(({ action }) => action.type === 'chat/delta').map(({ action }) => String(action.content)).join('');
  expect(delta).toBe('hello world');
  expect(seen.find(({ action }) => action.type === 'chat/turnComplete')?.action.turnId).toBe('t1');
  session.close();
});

it('a permission ask answered outside is seen inside', async () => {
  const answered: { id: string; approved: boolean }[] = [];
  const asking: Agent = {
    provider: PROVIDER,
    displayName: 'Cofold',
    schema: () => ({ properties: {} }),
    defaults: () => ({}),
    create: (session: Start) => ({
      uri: session.uri,
      chatUri: session.chatUri,
      models: () => [],
      agentId: () => 'asking',
      customizations: () => [],
      allTurns: () => [],
      status: () => 1,
      activity: () => undefined,
      title: () => 'Asking',
      modifiedAt: () => new Date().toISOString(),
      workingDirectories: () => [`file://${REPO_ROOT}`],
      sessionState: () => ({ resource: session.uri, provider: PROVIDER, title: 'Asking', status: 1, lifecycle: 'ready', chats: [], workingDirectories: [`file://${REPO_ROOT}`] }),
      chatState: () => ({ resource: session.chatUri, title: 'Asking', status: 1, modifiedAt: new Date().toISOString(), turns: [] }),
      begin: (turnId: string, text: string) => {
        session.emit('chat', { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text } });
        session.emit('chat', {
          type: 'chat/inputRequested',
          turnId,
          request: { id: 'req-1', message: 'May I run it?', questions: [{ id: 'q1', kind: 'text', message: 'Allow?', required: true }] },
        });
      },
      confirm: (toolCallId: string, approved: boolean) => { answered.push({ id: toolCallId, approved }); },
      cancel: () => {}, queue: () => {}, unqueue: () => {}, setDraft: () => {}, reorder: () => {},
      answer: () => {}, setCustomizationEnabled: async () => false, startMcpServer: async () => false,
      stopMcpServer: async () => false, settings: () => ({}), close: () => {},
    }),
  } as unknown as Agent;

  const inner = innerHost(asking);
  const { seen, emit } = recorder();
  const agent = nestedAgent(asking, { start: async () => inner.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));

  session.begin('t1', 'do it');
  await until(() => seen.some(({ action }) => action.type === 'chat/inputRequested'));
  // What the client outside reads is the inner session's own ask.
  const asked = seen.find(({ action }) => action.type === 'chat/inputRequested')?.action;
  expect(asked?.request?.id).toBe('req-1');
  expect(asked?.request?.message).toBe('May I run it?');

  // The answer goes the other way: the host's `confirm` is the proxy's, and the
  // proxy's is a dispatch into the inner session.
  session.confirm('req-1', true);
  await until(() => answered.length > 0);
  expect(answered).toEqual([{ id: 'req-1', approved: true }]);
  session.close();
});

it('cancel stops the inner turn', async () => {
  const inner = innerHost(backend(30));
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(30), { start: async () => inner.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));

  session.begin('t1', 'one two three four five six seven eight nine ten');
  await until(() => seen.some(({ action }) => action.type === 'chat/delta'));
  session.cancel('t1');
  await until(() => seen.some(({ action }) => action.type === 'chat/turnCancelled'));
  expect(seen.find(({ action }) => action.type === 'chat/turnCancelled')?.action.turnId).toBe('t1');
  // A cancelled turn never reports itself complete, whether or not the inner
  // backend is still streaming.
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  expect(seen.some(({ action }) => action.type === 'chat/turnComplete')).toBe(false);
  session.close();
});

it('killing the inner host ends the outer session with what it last said', async () => {
  const inner = innerHost(backend());
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { start: async () => inner.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));
  session.begin('t1', 'hi');
  await until(() => seen.some(({ action }) => action.type === 'chat/turnComplete'));

  inner.say('ahpd: the machine has gone away');
  inner.crash(3);
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const failure = seen.find(({ action }) => action.type === 'session/creationFailed')?.action;
  expect(failure?.error?.message).toMatch(/ended/);
  expect(failure?.error?.message).toMatch(/machine has gone away/);
  session.close();
});

it('a host that cannot be started is a sentence, not a hang', async () => {
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), {
    start: async () => { throw new Error('spawn ahpd ENOENT'); },
    timeoutMs: 500,
  });
  const session = agent.create(start(emit));
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const failure = seen.find(({ action }) => action.type === 'session/creationFailed')?.action;
  expect(failure?.error?.message).toMatch(/could not start a host inside computer:\/\/box/);
  expect(failure?.error?.message).toMatch(/spawn ahpd ENOENT/);
  session.close();
});

it('a host that exits before initialize is a sentence with its stderr', async () => {
  const host = scripted(() => undefined);
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { start: async () => host.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));
  // The host never answers `initialize`; it is the process ending that is the
  // failure, so the test waits until the proxy has actually written to it.
  await until(() => host.heard() > 0);
  host.say('ahpd: no plugin called @ahpd/agent-cofold');
  host.crash(2);
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const failure = seen.find(({ action }) => action.type === 'session/creationFailed')?.action;
  expect(failure?.error?.message).toMatch(/ended before its session started/);
  expect(failure?.error?.message).toMatch(/no plugin called @ahpd\/agent-cofold/);
  session.close();
});

it('a host that speaks another protocol version is refused at initialize', async () => {
  const host = scripted((message) => ({
    jsonrpc: '2.0',
    id: message.id,
    result: { protocolVersion: '0.8.0', serverSeq: 0, serverInfo: { name: 'ahpd', version: '0' }, snapshots: [] },
  }));
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { start: async () => host.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const failure = seen.find(({ action }) => action.type === 'session/creationFailed')?.action;
  expect(failure?.error?.message).toMatch(/speaks 0\.8\.0/);
  expect(failure?.error?.message).toMatch(/this host speaks 0\.9\.0/);
  session.close();
});

it('a host that cannot create the inner session is a sentence with its stderr', async () => {
  const host = scripted((message) => {
    if (message.method === 'initialize') {
      return { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '0.9.0', serverSeq: 0, serverInfo: { name: 'ahpd', version: '0' }, snapshots: [] } };
    }
    if (message.method === 'createSession') {
      return { jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'No provider called cofold' } };
    }
    return undefined;
  });
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { start: async () => host.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const failure = seen.find(({ action }) => action.type === 'session/creationFailed')?.action;
  expect(failure?.error?.message).toMatch(/No provider called cofold/);
  session.close();
});

it('a host that never answers initialize times out into a sentence', async () => {
  const host = scripted(() => undefined);
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { start: async () => host.proc, timeoutMs: 30 });
  const session = agent.create(start(emit));
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const failure = seen.find(({ action }) => action.type === 'session/creationFailed')?.action;
  expect(failure?.error?.message).toMatch(/"initialize" timed out after 30ms/);
  session.close();
});

it('a backend that declares runsNested is given the proxy by the host', async () => {
  // The choice itself, at the one place it is made: a session with a machine
  // must not reach the backend's own `create`, because that is the process
  // that cannot leave this host.
  let started = 0;
  let release: () => void = () => { /* replaced below */ };
  const opened = new Promise<void>((resolve) => { release = resolve; });
  const real: Agent = {
    provider: PROVIDER,
    displayName: 'Cofold',
    runsNested: true,
    schema: () => ({ properties: {} }),
    defaults: () => ({}),
    create: () => { started += 1; throw new Error('the backend must not be started on this host'); },
  };
  const host = createHost({
    path: REPO_ROOT,
    agents: [real],
    // A port with no host to start, held open until the client is watching so
    // the failure is delivered rather than raced.
    computers: {
      how: async () => ({ command: 'true', args: [] }),
      nested: async () => { await opened; return undefined; },
    },
  });
  const peer = watching();
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'] } });
  await client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/nested', provider: PROVIDER, config: { computer: 'computer://box' } },
  });
  // The choice is already made: the backend's own `create` would have thrown.
  expect(started).toBe(0);
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/nested' } });
  release();
  await until(() => peer.seen.some(({ method, params }) => method === 'action' && params?.action?.type === 'session/creationFailed'));
  const said = peer.seen.find(({ method, params }) => method === 'action' && params?.action?.type === 'session/creationFailed');
  expect(said?.params.action.error.message).toMatch(/There is no computer called computer:\/\/box/);
});

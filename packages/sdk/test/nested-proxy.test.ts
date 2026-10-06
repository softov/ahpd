import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { chatUriFor, subagentChatUri } from '../src/host/channels.js';
import { createPeer, receive } from '../src/rpc.js';
import { nestedAgent } from '../src/nested.js';
import { fileSessions } from '../src/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { NestedHost } from '../src/nested.js';
import type { Handler, Peer, Wire } from '../src/types/rpc.js';

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
/** The plugin a nested cofold session asks the host inside to load. */
const PLUGINS = ['@ahpd/agent-cofold'];
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
  const ends = listeners();
  const stderr: ((chunk: unknown) => void)[] = [];
  const innerWire: Wire = {
    send: (text) => { toOuter?.(text); },
    close: () => { /* the fake process stays open until the test ends it */ },
    isOpen: () => true,
  };
  const peer = createPeer(innerWire);
  const accepted = host.accept(peer);
  const handler: Handler = (request) => accepted.handle(request);
  const signals: string[] = [];
  const messages: Bag[] = [];
  const proc = {
    stdin: {
      write: (text: string): void => {
        for (const line of String(text).split('\n')) {
          if (line.trim() === '') continue;
          messages.push(JSON.parse(line) as Bag);
          receive(line, peer, handler);
        }
      },
      on: () => { /* an in-memory pipe never fails */ },
      end: () => { /* nor closes under the writer */ },
    },
    stdout: { on: (_event: string, listener: (chunk: unknown) => void) => { toOuter = (text) => listener(`${text}\n`); } },
    stderr: { on: (_event: string, listener: (chunk: unknown) => void) => { stderr.push(listener); } },
    on: ends.on,
    kill: (signal = 'SIGTERM') => { signals.push(String(signal)); return true; },
  } as unknown as NestedHost;
  return {
    host,
    proc,
    /** The signals the proxy sent the process, in order. */
    signals,
    /** Everything the proxy wrote, parsed, in order. */
    messages,
    /** One of the host's own stderr lines. */
    say: (line: string): void => { for (const listener of stderr) listener(`${line}\n`); },
    /** The host's process going away, which is what a machine being removed does. */
    crash: (code: number | null = 1, signal: string | null = null): void => { ends.end(code, signal); },
    fail: (error: Error): void => { ends.fire('error', error); },
  };
};

/**
 * An inner host whose answer to the proxy's `createSession` is held back.
 *
 * The proxy asks for the session while it is starting up, before it subscribes
 * to it, so the answer is the one moment a case can stand inside: the machine's
 * store already holds what the create wrote, and the proxy does not know it yet.
 * Everything else the inner host says goes out as it is written; only the answer
 * to the create waits, and `release` sends it on.
 */
const holdingCreate = (agent: Agent) => {
  const inner = innerHost(agent);
  const stdout = inner.proc.stdout as unknown as { on: (event: string, listener: (chunk: unknown) => void) => void };
  const written = stdout.on.bind(stdout);
  const held: string[] = [];
  let out: ((chunk: unknown) => void) | undefined;
  let open = false;
  stdout.on = (event, listener) => {
    out = listener;
    written(event, (chunk: unknown) => {
      const asked = inner.messages.find((message) => message.method === 'createSession')?.id;
      const frame = ((): Bag | undefined => { try { return JSON.parse(String(chunk)) as Bag; } catch { return undefined; } })();
      if (!open && asked !== undefined && frame?.id === asked) { held.push(String(chunk)); return; }
      listener(chunk);
    });
  };
  return {
    ...inner,
    /** How many answers the proxy is still waiting for, which is one or none. */
    held: (): number => held.length,
    /** Send the answer the create is waiting for. */
    release: (): void => { open = true; for (const text of held.splice(0)) out?.(text); },
  };
};

/**
 * A process's own events, as a child process reports its end.
 *
 * `exit` and then `close`, each with the code and the signal, the order Node
 * keeps, so a fake ends the way a real child does whichever one is read.
 */
function listeners() {
  const held = new Map<string, ((...args: unknown[]) => void)[]>();
  const fire = (event: string, ...args: unknown[]): void => { for (const listener of held.get(event) ?? []) listener(...args); };
  return {
    on: (event: string, listener: (...args: unknown[]) => void): void => { held.set(event, [...(held.get(event) ?? []), listener]); },
    fire,
    end: (code: number | null, signal: string | null): void => { fire('exit', code, signal); fire('close', code, signal); },
  };
}

/** A host that answers only what the test scripts, for the failures. */
const scripted = (answer: (message: Bag) => Bag | undefined) => {
  let toOuter: ((text: string) => void) | undefined;
  const ends = listeners();
  let heard = 0;
  const messages: Bag[] = [];
  const stderr: ((chunk: unknown) => void)[] = [];
  const proc = {
    stdin: {
      write: (text: string): void => {
        for (const line of String(text).split('\n')) {
          if (line.trim() === '') continue;
          heard += 1;
          const message = JSON.parse(line) as Bag;
          messages.push(message);
          const reply = answer(message);
          if (reply !== undefined) toOuter?.(`${JSON.stringify(reply)}\n`);
        }
      },
      on: () => { /* an in-memory pipe never fails */ },
      end: () => { /* nor closes under the writer */ },
    },
    stdout: { on: (_event: string, listener: (chunk: unknown) => void) => { toOuter = (text) => listener(text); } },
    stderr: { on: (_event: string, listener: (chunk: unknown) => void) => { stderr.push(listener); } },
    on: ends.on,
    kill: () => true,
  } as unknown as NestedHost;
  return {
    proc,
    /** Whether the proxy has written anything yet, so a test can race it. */
    heard: (): number => heard,
    /** Everything the proxy wrote, parsed, in order. */
    messages,
    say: (line: string): void => { for (const listener of stderr) listener(`${line}\n`); },
    /** One stderr chunk as it is, with or without a newline. */
    raw: (chunk: string): void => { for (const listener of stderr) listener(chunk); },
    /** One stdout chunk as it is, with or without a newline. */
    feed: (chunk: string): void => { toOuter?.(chunk); },
    crash: (code: number | null = 1, signal: string | null = null): void => { ends.end(code, signal); },
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
  const agent = nestedAgent(backend(), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 });
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

/** What a scripted inner backend was told, in order. */
interface Told {
  confirmed: { id: string; approved: boolean; option?: string }[];
  answered: { id: string; accepted: boolean; answers: Bag }[];
  signedIn: { resource: string; token: string }[];
  order: string[];
}

/**
 * An inner backend whose turn does what the case scripts, and which keeps
 * what it was told: the confirmations, the answers, the sign-ins and its close.
 */
const scriptedAgent = (
  onBegin: (session: Start, turnId: string, text: string) => void,
  extra: { models?: { id: string; name: string }[]; awaiting?: string[] } = {},
): { agent: Agent; told: Told } => {
  const told: Told = { confirmed: [], answered: [], signedIn: [], order: [] };
  const agent = {
    provider: PROVIDER,
    displayName: 'Cofold',
    schema: () => ({ properties: {} }),
    defaults: () => ({}),
    ...(extra.models === undefined ? {} : { probe: async () => ({ models: extra.models, commands: [], customizations: [] }) }),
    create: (session: Start) => ({
      uri: session.uri,
      chatUri: session.chatUri,
      models: () => extra.models ?? [],
      agentId: () => 'scripted',
      customizations: () => [],
      allTurns: () => [],
      status: () => 1,
      activity: () => undefined,
      title: () => 'Scripted',
      modifiedAt: () => new Date().toISOString(),
      workingDirectories: () => [`file://${REPO_ROOT}`],
      sessionState: () => ({ resource: session.uri, provider: PROVIDER, title: 'Scripted', status: 1, lifecycle: 'ready', chats: [], workingDirectories: [`file://${REPO_ROOT}`] }),
      chatState: () => ({ resource: session.chatUri, title: 'Scripted', status: 1, modifiedAt: new Date().toISOString(), turns: [] }),
      begin: (turnId: string, text: string) => {
        session.emit('chat', { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text } });
        onBegin(session, turnId, text);
      },
      confirm: (toolCallId: string, approved: boolean, optionId?: string) => {
        told.confirmed.push({ id: toolCallId, approved, ...(optionId === undefined ? {} : { option: optionId }) });
      },
      answer: (requestId: string, accepted: boolean, answers: Bag) => { told.answered.push({ id: requestId, accepted, answers }); },
      cancel: () => {}, queue: () => {}, unqueue: () => {}, setDraft: () => {}, reorder: () => {},
      setCustomizationEnabled: async () => false, startMcpServer: async () => false,
      stopMcpServer: async () => false, settings: () => ({}),
      ...(extra.awaiting === undefined ? {} : {
        awaiting: () => extra.awaiting,
        authenticated: async (resource: string, token: string) => { told.signedIn.push({ resource, token }); return true; },
      }),
      close: () => { told.order.push('close'); },
    }),
  } as unknown as Agent;
  return { agent, told };
};

it('a tool call that asks for confirmation is confirmed from outside', async () => {
  const { agent, told } = scriptedAgent((session, turnId) => {
    session.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: 'call-1', toolName: 'shell', displayName: 'Shell' });
    session.emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId: 'call-1', invocationMessage: 'Run hostname', toolInput: 'hostname' });
  });
  const inner = innerHost(agent);
  const { seen, emit } = recorder();
  const session = nestedAgent(agent, { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 }).create(start(emit));

  session.begin('t1', 'do it');
  await until(() => seen.some(({ action }) => action.type === 'chat/toolCallReady'));
  // What the client outside reads is the inner session's own ask.
  expect(seen.find(({ action }) => action.type === 'chat/toolCallReady')?.action.toolCallId).toBe('call-1');

  // The host's `confirm` is the proxy's, and the proxy's is a dispatch into
  // the inner session, with the option the person picked outside.
  session.confirm('call-1', true, 'always');
  await until(() => told.confirmed.length > 0);
  expect(told.confirmed).toEqual([{ id: 'call-1', approved: true, option: 'always' }]);
  session.close();
});

it('a question the inner agent asks is answered from outside', async () => {
  const { agent, told } = scriptedAgent((session, turnId) => {
    session.emit('chat', {
      type: 'chat/inputRequested',
      turnId,
      request: { id: 'req-1', message: 'Which one?', questions: [{ id: 'q1', kind: 'text', message: 'Name it', required: true }] },
    });
  });
  const inner = innerHost(agent);
  const { seen, emit } = recorder();
  const session = nestedAgent(agent, { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 }).create(start(emit));

  session.begin('t1', 'ask me');
  await until(() => seen.some(({ action }) => action.type === 'chat/inputRequested'));
  expect(seen.find(({ action }) => action.type === 'chat/inputRequested')?.action.request.id).toBe('req-1');
  // A draft answer is taken while the request is open, and refused for one that is not.
  expect(session.setAnswer?.('req-1', 'q1', { kind: 'text', value: 'lulu' })).toBe(true);
  expect(session.setAnswer?.('req-9', 'q1', { kind: 'text', value: 'lulu' })).toBe(false);
  session.answer('req-1', true, { q1: { kind: 'text', value: 'lulu' } });
  await until(() => told.answered.length > 0);
  expect(told.answered[0]?.id).toBe('req-1');
  expect(told.answered[0]?.accepted).toBe(true);
  session.close();
});

it('steer, resume, config and the MCP controls answer what the inner session holds', async () => {
  const inner = innerHost(backend());
  const { seen, emit } = recorder();
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 }).create(start(emit));
  session.begin('t1', 'hi');
  await until(() => seen.some(({ action }) => action.type === 'chat/turnComplete'));
  const written = inner.messages.length;

  // Nothing is running, so there is nothing to steer and nothing is sent.
  expect(session.steer?.('s1', 'faster')).toBe(false);
  // The last turn completed, so there is nothing to run again.
  expect(session.resume?.('t1')).toBe(false);
  // A key the inner schema does not have is refused in a sentence.
  expect(typeof await session.setConfig?.('nonsense', 1)).toBe('string');
  // Ids the inner state does not hold are refused.
  expect(await session.startMcpServer('missing')).toBe(false);
  expect(await session.stopMcpServer('missing')).toBe(false);
  expect(await session.setCustomizationEnabled('missing', false)).toBe(false);
  expect(inner.messages.length).toBe(written);

  // A key it has, and may change while it runs, is taken.
  expect(await session.setConfig?.('voice', 'shouty')).toBe(true);
  session.close();
});

it('the session offers the models the inner host lists for its provider', async () => {
  const { agent } = scriptedAgent(() => {}, { models: [{ id: 'm1', name: 'One' }, { id: 'm2', name: 'Two' }] });
  const inner = innerHost(agent);
  const { emit } = recorder();
  const session = nestedAgent(agent, { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 }).create(start(emit));
  await until(() => session.models().length === 2);
  expect(session.models()).toEqual([{ id: 'm1', name: 'One' }, { id: 'm2', name: 'Two' }]);
  session.close();
});

it('a sign-in the inner session asks for is awaited outside and reaches the inner host', async () => {
  const resource = 'https://mcp.example/';
  const { agent, told } = scriptedAgent((session) => {
    session.emit('session', { type: 'session/mcpServerStateChanged', id: 'mcp:example', state: { kind: 'authRequired', resource: { resource } } });
  }, { awaiting: [resource] });
  const inner = innerHost(agent);
  const { emit } = recorder();
  const session = nestedAgent(agent, { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 }).create(start(emit));
  session.begin('t1', 'use the server');
  await until(() => (session.awaiting?.() ?? []).length > 0);
  expect(session.awaiting?.()).toEqual([resource]);
  expect(await session.authenticated?.(resource, 'token-1')).toBe(true);
  expect(told.signedIn).toEqual([{ resource, token: 'token-1' }]);
  session.close();
});

it('a request the inner host makes of the proxy is answered with a sentence', async () => {
  const host = scripted((message) => (message.method === 'initialize' ? hello(message.id) : undefined));
  const { emit } = recorder();
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => host.proc, timeoutMs: 500 }).create(start(emit));
  await until(() => host.messages.some((message) => message.method === 'initialize'));
  await new Promise((resolve) => { setTimeout(resolve, 10); });
  host.feed(`${JSON.stringify({ jsonrpc: '2.0', id: 'asked-1', method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'file:///etc/hostname' } })}\n`);
  await until(() => host.messages.some((message) => message.id === 'asked-1'));
  const answer = host.messages.find((message) => message.id === 'asked-1');
  expect(answer?.error?.message).toMatch(/publishes no resources/);
  session.close();
});

it('close disposes the inner session before the process is signalled', async () => {
  const { agent, told } = scriptedAgent(() => {});
  const inner = innerHost(agent);
  (inner.proc as unknown as { kill: (signal?: string) => boolean }).kill = (signal = 'SIGTERM') => { told.order.push(`kill:${signal}`); return true; };
  const { emit } = recorder();
  const session = nestedAgent(agent, { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 }).create(start(emit));
  session.begin('t1', 'hi');
  await until(() => inner.messages.some((message) => message.method === 'dispatchAction'));
  session.close();
  await until(() => told.order.some((step) => step.startsWith('kill:')));
  expect(told.order[0]).toBe('close');
  expect(told.order).toContain('kill:SIGTERM');
});

it('a session removed while its inner session is being made disposes what was made', async () => {
  const inner = holdingCreate(backend());
  const { seen, emit } = recorder();
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 }).create(start(emit));

  // The create is out and its answer held, so the removal lands in the window
  // between the machine's store gaining the session and this host subscribing
  // to it - the window a close that only disposes a ready session cannot see.
  await until(() => inner.held() === 1);
  const closing = session.close();
  inner.release();
  await closing;

  expect(inner.messages.some((message) => message.method === 'disposeSession')).toBe(true);
  expect(seen.some(({ action }) => action.type === 'session/creationFailed')).toBe(false);
});

it('a restart waits for a host inside that is still starting, and stops it', async () => {
  const inner = innerHost(backend());
  const { emit } = recorder();
  const agent = nestedAgent(backend(), {
    plugins: PLUGINS,
    timeoutMs: 500,
    start: async () => {
      // A machine that takes its time to hand the host over - a container being
      // started - so the restart arrives while `startInside` is still out.
      await new Promise((resolve) => { setTimeout(resolve, 200); });
      return inner.proc;
    },
  });
  const session = agent.create(start(emit));
  let closed = false;
  const closing = Promise.resolve(session.close(false)).then(() => { closed = true; });

  // The process was handed over after the close began, and only then stopped:
  // the restart is not over while the host it replaces is still coming up.
  await until(() => inner.signals.length > 0);
  expect(closed).toBe(false);
  inner.crash(0, 'SIGTERM');
  await closing;
  expect(closed).toBe(true);
}, 30_000);

it('a restart goes on when the host inside it stopped will not go', async () => {
  const inner = innerHost(backend());
  const signals: string[] = [];
  // A process that takes its kill and stays: nothing here can end it, so the
  // restart going on is the whole of what can be asked of a machine like that.
  (inner.proc as unknown as { kill: (signal?: string) => boolean }).kill = (signal = 'SIGTERM') => { signals.push(signal); return true; };
  const lines: string[] = [];
  const { emit } = recorder();
  const session = nestedAgent(backend(), {
    plugins: PLUGINS,
    start: async () => inner.proc,
    timeoutMs: 500,
    log: (line) => lines.push(line),
  }).create(start(emit));
  session.begin('t1', 'hi');
  await until(() => inner.messages.some((message) => message.method === 'dispatchAction'));

  const waited = await Promise.race([
    Promise.resolve(session.close(false)).then(() => 'gone'),
    new Promise((resolve) => { setTimeout(() => resolve('still open'), 8_000); }),
  ]);
  expect(waited).toBe('gone');
  expect(signals).toContain('SIGTERM');
  expect(lines.some((line) => line.includes('is still there'))).toBe(true);
}, 30_000);

it('cancel stops the inner turn', async () => {
  const inner = innerHost(backend(30));
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(30), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 });
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
  const agent = nestedAgent(backend(), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 });
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

it('a session whose inner host ended says why, and a later turn goes nowhere', async () => {
  const inner = innerHost(backend());
  const { seen, emit } = recorder();
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 }).create(start(emit));
  session.begin('t1', 'hi');
  await until(() => seen.some(({ action }) => action.type === 'chat/turnComplete'));
  expect(session.ended?.()).toBeUndefined();
  inner.crash(3);
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const said = seen.find(({ action }) => action.type === 'session/creationFailed')?.action.error.message;
  const before = seen.length;
  session.begin('t2', 'again');
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(seen.length).toBe(before);
  expect(session.ended?.()).toBe(said);
  session.close();
});

it('a host that cannot be started is a sentence, not a hang', async () => {
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), {
    plugins: PLUGINS,
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
  const agent = nestedAgent(backend(), { plugins: PLUGINS, start: async () => host.proc, timeoutMs: 500 });
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

it('a host that answers a version nobody offered is refused at initialize', async () => {
  const host = scripted((message) => ({
    jsonrpc: '2.0',
    id: message.id,
    result: { protocolVersion: '0.8.0', serverSeq: 0, serverInfo: { name: 'ahpd', version: '0' }, snapshots: [] },
  }));
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { plugins: PLUGINS, start: async () => host.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const failure = seen.find(({ action }) => action.type === 'session/creationFailed')?.action;
  expect(failure?.error?.message).toMatch(/speaks 0\.8\.0/);
  expect(failure?.error?.message).toMatch(/this host offered 1\.0\.0, 0\.9\.0/);
  session.close();
});

it.each([['0.9.0'], ['1.0.0']])('a host that answers %s, which it was offered, is carried on to createSession', async (version) => {
  const host = scripted((message) => {
    if (message.method === 'initialize') {
      return { jsonrpc: '2.0', id: message.id, result: { protocolVersion: version, serverSeq: 0, serverInfo: { name: 'ahpd', version: '0' }, snapshots: [] } };
    }
    if (message.method === 'subscribe') return listing(message.id);
    if (message.method === 'createSession') {
      return { jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'No provider called cofold' } };
    }
    return undefined;
  });
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { plugins: PLUGINS, start: async () => host.proc, timeoutMs: 500 });
  const session = agent.create(start(emit));
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const failure = seen.find(({ action }) => action.type === 'session/creationFailed')?.action;
  expect(failure?.error?.message).toMatch(/No provider called cofold/);
  session.close();
});

it('a host that never answers initialize times out into a sentence', async () => {
  const host = scripted(() => undefined);
  const { seen, emit } = recorder();
  const agent = nestedAgent(backend(), { plugins: PLUGINS, start: async () => host.proc, timeoutMs: 30 });
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
    agentPlugins: { [PROVIDER]: '@ahpd/agent-cofold' },
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

/** The `initialize` answer a scripted host gives, carrying what a case adds. */
const hello = (id: unknown, extra: Bag = {}): Bag => ({
  jsonrpc: '2.0',
  id,
  result: { protocolVersion: '1.0.0', serverSeq: 0, serverInfo: { name: 'ahpd', version: '0' }, snapshots: [], ...extra },
});

/** The root a scripted host answers a subscription with: the providers it serves. */
const listing = (id: unknown, providers: string[] = [PROVIDER]): Bag => ({
  jsonrpc: '2.0',
  id,
  result: {
    snapshot: {
      resource: 'ahp-root://',
      state: { agents: providers.map((provider) => ({ provider, displayName: provider, description: '', models: [] })), activeSessions: 0 },
      fromSeq: 0,
    },
  },
});

it('a very long stderr line is cut, so the sentence stays short', async () => {
  const host = scripted(() => undefined);
  const { seen, emit } = recorder();
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => host.proc, timeoutMs: 500 }).create(start(emit));
  await until(() => host.heard() > 0);
  host.raw(`${'x'.repeat(100_000)}\n`);
  host.crash(2);
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const said = String(seen.find(({ action }) => action.type === 'session/creationFailed')?.action.error.message);
  expect(said).toMatch(/xxxx/);
  expect(said.length).toBeLessThan(6_000);
  session.close();
});

it('a stderr line split across two chunks is one line', async () => {
  const host = scripted(() => undefined);
  const { seen, emit } = recorder();
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => host.proc, timeoutMs: 500 }).create(start(emit));
  await until(() => host.heard() > 0);
  host.raw('ahpd: no ');
  host.raw('plugin\n');
  host.crash(2);
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'));
  const said = String(seen.find(({ action }) => action.type === 'session/creationFailed')?.action.error.message);
  expect(said).toMatch(/It said: ahpd: no plugin$/);
});

it('a large stdout frame fed in small chunks is read in time proportional to its size', async () => {
  const host = scripted((message) => {
    if (message.method === 'subscribe') return listing(message.id);
    if (message.method === 'createSession') return { jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'read the whole frame' } };
    return undefined;
  });
  const { seen, emit } = recorder();
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => host.proc, timeoutMs: 20_000 }).create(start(emit));
  await until(() => host.heard() > 0);
  const frame = `${JSON.stringify(hello(host.messages[0]?.id, { _meta: { pad: 'y'.repeat(32 * 1024 * 1024) } }))}\n`;
  const began = Date.now();
  for (let at = 0; at < frame.length; at += 64 * 1024) host.feed(frame.slice(at, at + 64 * 1024));
  await until(() => seen.some(({ action }) => action.type === 'session/creationFailed'), 2_000);
  const took = Date.now() - began;
  expect(String(seen.find(({ action }) => action.type === 'session/creationFailed')?.action.error.message)).toMatch(/read the whole frame/);
  expect(took).toBeLessThan(3_000);
  session.close();
}, 60_000);

/**
 * A scripted host that serves the providers it is given, and answers a
 * session's creation and its subscriptions with nothing in them.
 */
const serving = (providers: string[]) => scripted((message) => {
  const ok = (result: Bag): Bag => ({ jsonrpc: '2.0', id: message.id, result });
  if (message.method === 'initialize') return hello(message.id);
  if (message.method === 'subscribe' && message.params?.channel === 'ahp-root://') return listing(message.id, providers);
  if (message.method === 'createSession') return ok({});
  if (message.method === 'subscribe') return ok({ snapshot: { resource: message.params?.channel, state: { turns: [] }, fromSeq: 0 } });
  return undefined;
});

/** The `createSession` a scripted host was sent, if any. */
const created = (host: ReturnType<typeof scripted>): Bag | undefined => host.messages.find((message) => message.method === 'createSession');

it('the inner session works at the path the folder has inside the machine', async () => {
  const host = serving([PROVIDER]);
  const { emit } = recorder();
  const session = nestedAgent(backend(), {
    plugins: ['@ahpd/agent-cofold'],
    start: async () => ({ host: host.proc, workingDirectory: '/workspaces/app/x' }),
    timeoutMs: 500,
  }).create(start(emit, '/srv/app/x'));
  await until(() => created(host) !== undefined);
  expect(created(host)?.params.workingDirectories).toEqual(['file:///workspaces/app/x']);
  // A client outside still reads the folder it named.
  expect(session.workingDirectories()).toEqual(['file:///srv/app/x']);
  session.close();
});

it('a variant the inner host does not serve ends the session naming it, and an agent it serves is created there', async () => {
  const variant = serving(['claude']);
  const first = recorder();
  const openrouter: Agent = { ...backend(), provider: 'claude-openrouter', variant: true };
  const refused = nestedAgent(openrouter, { plugins: ['@ahpd/agent-claude'], start: async () => variant.proc, timeoutMs: 500 }).create(start(first.emit));
  await until(() => first.seen.some(({ action }) => action.type === 'session/creationFailed'));
  expect(String(first.seen.find(({ action }) => action.type === 'session/creationFailed')?.action.error.message)).toMatch(/claude-openrouter/);
  expect(created(variant)).toBeUndefined();
  refused.close();

  const plain = serving(['claude']);
  const second = recorder();
  const taken = nestedAgent('claude', { plugins: ['@ahpd/agent-claude'], start: async () => plain.proc, timeoutMs: 500 }).create(start(second.emit));
  await until(() => created(plain) !== undefined);
  expect(created(plain)?.params.provider).toBe('claude');
  taken.close();
});

it('a renamed default agent is created under the provider the inner host serves', async () => {
  const host = serving(['cofold']);
  const { emit } = recorder();
  const work: Agent = { ...backend(), provider: 'cofold-work' };
  const session = nestedAgent(work, { plugins: ['@ahpd/agent-cofold'], start: async () => host.proc, timeoutMs: 500 }).create(start(emit));
  await until(() => created(host) !== undefined);
  expect(created(host)?.params.provider).toBe('cofold');
  session.close();
});

/**
 * A port whose nested host is a small real process: it answers `initialize`,
 * lists `providers` at the root, writes each `createSession`'s provider to a
 * file, and answers every other request empty.
 *
 * It also keeps a store, which is what a machine holds: subscribing a session
 * writes it there, a listing answers from it, and disposing one takes it out
 * again, so a case can read what the host inside holds after the outer host did
 * something. `keep` puts one there without a host: a machine that came back
 * holding a session the outer host only records is a state a case has to be
 * able to set up, since the road to it in the wild is a dispose that never
 * landed.
 *
 * `nestedDelete` is the profile's answer, the way the computer plugin reads it
 * from the machine's own profile - absent means the profile says nothing and
 * the default stands.
 */
const scriptedPort = (
  providers: string[],
  options: { nestedDelete?: 'inside' | 'record' } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-nested-port-'));
  const file = join(dir, 'created');
  const script = [
    'const providers = JSON.parse(process.argv[1]);',
    'const file = process.argv[2];',
    "const fs = require('node:fs');",
    'const newline = String.fromCharCode(10);',
    'const say = (m) => process.stdout.write(JSON.stringify(m) + newline);',
    'const store = file + ".store";',
    'const held = () => { try { return fs.readFileSync(store, "utf8").split(newline).filter((one) => one !== ""); } catch { return []; } };',
    "require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {",
    '  let m; try { m = JSON.parse(line); } catch { return; }',
    '  fs.appendFileSync(file + ".asked", JSON.stringify({ method: m.method, channel: m.params && m.params.channel }) + newline);',
    '  if (m.id === undefined) return;',
    "  const ok = (result) => say({ jsonrpc: '2.0', id: m.id, result });",
    "  if (m.method === 'initialize') ok({ protocolVersion: '1.0.0', serverSeq: 0, serverInfo: { name: 'ahpd', version: '0' }, snapshots: [] });",
    "  else if (m.method === 'subscribe' && m.params.channel === 'ahp-root://') ok({ snapshot: { resource: 'ahp-root://', state: { agents: providers.map((p) => ({ provider: p, displayName: p, description: '', models: [] })), activeSessions: 0 }, fromSeq: 0 } });",
    "  else if (m.method === 'createSession') { fs.appendFileSync(file, m.params.provider + newline); ok({}); }",
    '  else if (m.method === \'listSessions\') ok({ items: held().map((channel) => ({ resource: channel, provider: String(channel).split(":")[0], title: "", status: 0, createdAt: new Date(0).toISOString(), modifiedAt: new Date(0).toISOString(), workingDirectories: [] })) });',
    "  else if (m.method === 'subscribe') { const channel = m.params.channel; if (!String(channel).startsWith('ahp-')) fs.appendFileSync(store, channel + newline); ok({ snapshot: { resource: channel, state: { turns: [] }, fromSeq: 0 } }); }",
    "  else if (m.method === 'disposeSession') { const gone = m.params.channel; fs.writeFileSync(store, held().filter((one) => one !== gone).map((one) => one + newline).join('')); ok({}); }",
    '  else ok({});',
    '});',
  ].join('\n');
  const read = (): string[] => {
    try { return readFileSync(file, 'utf8').split('\n').filter((line) => line !== ''); }
    catch { return []; }
  };
  const stored = (): string[] => {
    try { return readFileSync(`${file}.store`, 'utf8').split('\n').filter((line) => line !== ''); }
    catch { return []; }
  };
  /** A session the machine holds without a host running: what a missed dispose leaves behind. */
  const keep = (channel: string): void => { appendFileSync(`${file}.store`, `${channel}\n`); };
  const asked = (): Bag[] => {
    try { return readFileSync(`${file}.asked`, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Bag); }
    catch { return []; }
  };
  return {
    read,
    /** What the host inside holds: the sessions subscribed there and not disposed. */
    stored,
    keep,
    asked,
    dir,
    // The scripted host is stopped behind a session's close and may still be
    // writing, so the folder is removed with retries.
    done: () => { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); },
    computers: {
      how: async () => ({ command: 'true', args: [] }),
      nested: async () => ({ command: process.execPath, args: ['-e', script, JSON.stringify(providers), file] }),
      ...(options.nestedDelete === undefined ? {} : { nestedDelete: async () => options.nestedDelete }),
    },
  };
};

it('a variant that is its plugin\'s only agent is not run as the agent the inner host serves', async () => {
  const port = scriptedPort(['claude']);
  const real: Agent = { ...backend(), provider: 'claude-openrouter', runsNested: true, variant: true };
  const host = createHost({ path: REPO_ROOT, agents: [real], agentPlugins: { 'claude-openrouter': '@ahpd/agent-claude' }, computers: port.computers });
  const peer = watching();
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/variant', provider: 'claude-openrouter', config: { computer: 'computer://box' } } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/variant' } });
  const failed = (): Bag | undefined => peer.seen.find(({ method, params }) => method === 'action' && params?.action?.type === 'session/creationFailed')?.params;
  await until(() => failed() !== undefined || port.read().length > 0, 1000);
  expect(String(failed()?.action.error.message)).toMatch(/does not serve claude-openrouter/);
  expect(port.read()).toEqual([]);
  await host.close();
  port.done();
});

/**
 * One outer host on a session store in `dir`, serving a cofold that runs
 * nested through `computers`, with one client watching.
 */
const restartable = async (
  dir: string,
  computers: ReturnType<typeof scriptedPort>['computers'] | { how: () => Promise<Bag>; nested: () => Promise<undefined> },
  log?: (line: string) => void,
) => {
  const sessions = fileSessions({ dir });
  const real: Agent = { ...backend(), runsNested: true };
  const host = createHost({ path: REPO_ROOT, agents: [real], agentPlugins: { [PROVIDER]: '@ahpd/agent-cofold' }, computers: computers as never, sessions, ...(log === undefined ? {} : { onEvent: log }) });
  const peer = watching();
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  return { host, peer, client, sessions };
};

/** The rows a client is answered with. */
const rowsOf = async (client: Awaited<ReturnType<typeof restartable>>['client']): Promise<Bag[]> =>
  ((await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as { items: Bag[] }).items;

/** A nested session made and named on one host, which is then closed as a daemon stops. */
const madeAndStopped = async (dir: string, port: ReturnType<typeof scriptedPort>): Promise<void> => {
  const first = await restartable(dir, port.computers);
  await first.client.handle({ method: 'createSession', params: { channel: 'ahp-session:/kept', provider: PROVIDER, config: { computer: 'computer://box' } } });
  await until(() => port.read().length > 0, 1000);
  await first.client.handle({ method: 'dispatchAction', params: { channel: 'ahp-session:/kept', clientSeq: 1, action: { type: 'session/titleChanged', title: 'In the box' } } });
  await first.host.close();
};

/**
 * The same, with the machine still holding the session.
 *
 * A stop disposes what is inside a machine on its way down, and that dispose is
 * bounded: a machine that is stopping, or a daemon that was killed, does not
 * carry it out. What that leaves is the state deleting a session that is not
 * running is about - the outer host records it, and the machine holds it.
 */
const madeKeptAndStopped = async (dir: string, port: ReturnType<typeof scriptedPort>): Promise<void> => {
  await madeAndStopped(dir, port);
  port.keep(`${PROVIDER}:/kept`);
};

it('a nested session is listed after the outer host restarts, from the record it kept', async () => {
  const port = scriptedPort([PROVIDER]);
  const dir = join(port.dir, 'sessions');
  await madeAndStopped(dir, port);
  const asked = port.asked().length;
  const second = await restartable(dir, port.computers);
  const rows = await rowsOf(second.client);
  expect(rows.map((one) => [one.resource, one.title])).toEqual([[`${PROVIDER}:/kept`, 'In the box']]);
  // Listed without asking the machine anything.
  expect(port.asked().length).toBe(asked);
  await second.host.close();
  port.done();
});

it('a nested session listed after a restart resumes the inner session by id from its record', async () => {
  const port = scriptedPort([PROVIDER]);
  const dir = join(port.dir, 'sessions');
  await madeAndStopped(dir, port);
  const second = await restartable(dir, port.computers);
  const [row] = await rowsOf(second.client);
  const uri = String(row?.resource);
  await second.client.handle({ method: 'subscribe', params: { channel: chatUriFor(uri) } });
  await second.client.handle({ method: 'dispatchAction', params: { channel: chatUriFor(uri), clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } } });
  await until(() => port.asked().some(({ method }) => method === 'dispatchAction'), 1000);
  // The inner session is subscribed under the outer id and not created again.
  expect(port.read()).toEqual([PROVIDER]);
  expect(port.asked().filter(({ method }) => method === 'subscribe').map(({ channel }) => channel)).toContain(`${PROVIDER}:/kept`);
  expect(second.peer.seen.some(({ params }) => params?.rejectionReason !== undefined)).toBe(false);
  await second.host.close();
  port.done();
});

it('a nested session whose machine is gone is listed, and its resume ends with a sentence', async () => {
  const port = scriptedPort([PROVIDER]);
  const dir = join(port.dir, 'sessions');
  await madeAndStopped(dir, port);
  const second = await restartable(dir, { how: async () => ({ command: 'true', args: [] }), nested: async () => undefined });
  const rows = await rowsOf(second.client);
  expect(rows.map((one) => one.resource)).toEqual([`${PROVIDER}:/kept`]);
  const uri = String(rows[0]?.resource);
  await second.client.handle({ method: 'subscribe', params: { channel: uri } });
  await second.client.handle({ method: 'dispatchAction', params: { channel: chatUriFor(uri), clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } } });
  const failed = (): Bag | undefined => second.peer.seen.find(({ params }) => params?.action?.type === 'session/creationFailed')?.params;
  await until(() => failed() !== undefined, 1000);
  expect(String(failed()?.action.error.message)).toMatch(/There is no computer called computer:\/\/box/);
  await second.host.close();
  port.done();
});

it('a nested session that is not running is deleted inside its machine', async () => {
  const port = scriptedPort([PROVIDER]);
  const dir = join(port.dir, 'sessions');
  await madeKeptAndStopped(dir, port);
  const second = await restartable(dir, port.computers);
  const [row] = await rowsOf(second.client);

  await second.client.handle({ method: 'disposeSession', params: { channel: String(row?.resource) } });

  expect(port.stored()).toEqual([]);
  expect(await rowsOf(second.client)).toEqual([]);
  await second.host.close();
  port.done();
});

it('a nested session whose profile says record is deleted here, and its copy inside stays', async () => {
  const port = scriptedPort([PROVIDER], { nestedDelete: 'record' });
  const dir = join(port.dir, 'sessions');
  await madeKeptAndStopped(dir, port);
  const second = await restartable(dir, port.computers);
  const [row] = await rowsOf(second.client);

  await second.client.handle({ method: 'disposeSession', params: { channel: String(row?.resource) } });

  expect(port.stored()).toEqual([`${PROVIDER}:/kept`]);
  expect(await rowsOf(second.client)).toEqual([]);
  await second.host.close();
  port.done();
});

it('a nested session whose machine is gone is deleted here, and the log says the copy went with it', async () => {
  const port = scriptedPort([PROVIDER]);
  const dir = join(port.dir, 'sessions');
  await madeAndStopped(dir, port);
  const lines: string[] = [];
  const second = await restartable(
    dir,
    { how: async () => ({ command: 'true', args: [] }), nested: async () => undefined },
    (line) => lines.push(line),
  );
  const [row] = await rowsOf(second.client);

  await second.client.handle({ method: 'disposeSession', params: { channel: String(row?.resource) } });

  expect(await rowsOf(second.client)).toEqual([]);
  expect(lines.join('\n')).toMatch(/computer:\/\/box/);
  await second.host.close();
  port.done();
});

it('a renamed default that is its plugin\'s only agent is run as the agent the inner host serves', async () => {
  const port = scriptedPort(['cofold']);
  const real: Agent = { ...backend(), provider: 'cofold-work', runsNested: true };
  const host = createHost({ path: REPO_ROOT, agents: [real], agentPlugins: { 'cofold-work': '@ahpd/agent-cofold' }, computers: port.computers });
  const client = host.accept(watching());
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/work', provider: 'cofold-work', config: { computer: 'computer://box' } } });
  await until(() => port.read().length > 0, 1000);
  expect(port.read()).toEqual(['cofold']);
  await host.close();
  port.done();
});

it('the host asks the port for the plugin that registered the agent', async () => {
  const asked: string[][] = [];
  const real: Agent = { ...backend(), provider: 'cofold-work', runsNested: true };
  const host = createHost({
    path: REPO_ROOT,
    agents: [real],
    agentPlugins: { 'cofold-work': '@ahpd/agent-cofold' },
    computers: {
      how: async () => ({ command: 'true', args: [] }),
      nested: async (_id, wanted) => { asked.push(wanted.plugins); return undefined; },
    },
  });
  const client = host.accept(watching());
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/work', provider: 'cofold-work', config: { computer: 'computer://box' } } });
  await until(() => asked.length > 0);
  expect(asked).toEqual([['@ahpd/agent-cofold']]);
  await host.close();
});

it('an agent no plugin registered is refused nested with a sentence, and nothing is started', async () => {
  let started = 0;
  const real: Agent = { ...backend(), runsNested: true };
  const host = createHost({
    path: REPO_ROOT,
    agents: [real],
    computers: {
      how: async () => ({ command: 'true', args: [] }),
      nested: async () => { started += 1; return undefined; },
    },
  });
  const peer = watching();
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/loose', provider: PROVIDER, config: { computer: 'computer://box' } } });
  // Refused before anything could start, so the snapshot is where it is said.
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/loose' } }) as Bag;
  expect(opened.snapshot.state.lifecycle).toBe('failed');
  expect(opened.snapshot.state.creationError.message).toMatch(/which plugin/);
  expect(started).toBe(0);
  await host.close();
});

it('a client announcing itself in a nested session that ended is refused with the sentence it ended with', async () => {
  const real: Agent = { ...backend(), runsNested: true };
  const host = createHost({ path: REPO_ROOT, agents: [real], computers: { how: async () => ({ command: 'true', args: [] }) } });
  const peer = watching();
  const client = host.accept(peer);
  const uri = 'ahp-session:/over';
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  await client.handle({ method: 'createSession', params: { channel: uri, provider: PROVIDER, config: { computer: 'computer://box' } } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq: 1, action: { type: 'session/activeClientSet', activeClient: { tools: [] } } } });
  const refused = (): Bag | undefined => peer.seen.find(({ params }) => params?.action?.type === 'session/activeClientSet' && params?.rejectionReason !== undefined)?.params;
  await until(() => refused() !== undefined, 200);
  expect(String(refused()?.rejectionReason)).toMatch(/which plugin/);
  await host.close();
});

/**
 * An inner backend whose turn calls a tool that runs a worker: the worker's
 * chat is opened through the inner host's `subagent` seam, says `found it`,
 * and ends a moment later, and then the turn completes.
 */
const workingAgent = (): Agent => scriptedAgent((session, turnId) => {
  session.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: 'call-1', toolName: 'task', displayName: 'Task' });
  const worker = session.subagent?.('call-1', { title: 'Explore', prompt: 'look around' });
  if (worker === undefined) throw new Error('the inner host offered no subagent seam');
  setTimeout(() => {
    worker.emit({ type: 'chat/responsePart', turnId: worker.turnId, part: { id: 'w:0', kind: 'markdown', content: '' } });
    worker.emit({ type: 'chat/delta', turnId: worker.turnId, partId: 'w:0', content: 'found it' });
    worker.end('complete');
    setTimeout(() => {
      session.emit('chat', { type: 'chat/toolCallComplete', turnId, toolCallId: 'call-1', result: { success: true, pastTenseMessage: 'Explored' } });
      session.emit('chat', { type: 'chat/turnComplete', turnId });
    }, 30);
  }, 30);
}).agent;

/** A `subagent` seam that keeps what it was asked and what was written to each chat. */
const seam = (session: string) => {
  const asked: { toolCallId: string; request: Bag }[] = [];
  const written: Bag[] = [];
  const ended: string[] = [];
  const subagent = (toolCallId: string, request: Bag) => {
    asked.push({ toolCallId, request });
    return {
      uri: subagentChatUri(session, toolCallId),
      turnId: 'outer-turn',
      emit: (action: Bag) => { written.push(action); },
      end: (state: string) => { ended.push(state); },
    };
  };
  return { asked, written, ended, subagent };
};

it('an inner subagent chat is opened outside through the subagent seam, and its actions reach it on the outer turn', async () => {
  const inner = innerHost(workingAgent());
  const { emit } = recorder();
  const outside = seam('ahp-session:/outer');
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 })
    .create({ ...start(emit), subagent: outside.subagent } as unknown as Start);
  session.begin('t1', 'go');
  await until(() => outside.ended.length > 0);
  expect(outside.asked).toEqual([{ toolCallId: 'call-1', request: { title: 'Explore', prompt: 'look around' } }]);
  // The worker's own turn is the one the seam opened, so nothing starts another.
  expect(outside.written.some((action) => action.type === 'chat/turnStarted')).toBe(false);
  expect(outside.written.every((action) => action.turnId === 'outer-turn')).toBe(true);
  const said = outside.written.filter((action) => action.type === 'chat/delta').map((action) => action.content).join('');
  const shown = outside.written.filter((action) => action.type === 'chat/responsePart').map((action) => action.part.content).join('');
  expect(`${shown}${said}`).toBe('found it');
  expect(outside.ended).toEqual(['complete']);
  session.close();
});

it('a worker chat the outer seam cannot open is logged, and the session runs on', async () => {
  const inner = innerHost(workingAgent());
  const { seen, emit } = recorder();
  const lines: string[] = [];
  /*
   * A promise nobody holds is what this is about: the proxy opens a worker's
   * chat from the action that announces it, and a throw from there - the seam
   * is the outer host's own, and the chat it hands back can be gone - reaches
   * neither the session nor a caller. With no `unhandledRejection` handler
   * anywhere in this package, that ends the daemon.
   */
  const escaped: unknown[] = [];
  const watch = (error: unknown): void => { escaped.push(error); };
  process.on('unhandledRejection', watch);
  try {
    const session = nestedAgent(backend(), {
      plugins: PLUGINS,
      start: async () => inner.proc,
      timeoutMs: 500,
      log: (line: string) => { lines.push(line); },
    })
      .create({ ...start(emit), subagent: () => { throw new Error('the outer chat is gone'); } } as unknown as Start);
    session.begin('t1', 'go');
    await until(() => seen.some(({ action }) => action.type === 'chat/turnComplete'));
    // A rejection nobody holds is raised on a later turn of the loop than the
    // one that made it, so the case lets the tick pass before reading.
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(escaped).toEqual([]);
    expect(lines.some((line) => /could not be opened/.test(line) && /the outer chat is gone/.test(line))).toBe(true);
    expect(seen.some(({ action }) => action.type === 'session/creationFailed')).toBe(false);
    session.close();
  }
  finally {
    process.off('unhandledRejection', watch);
  }
});

it('a link to an inner subagent chat in the lead chat names the outer chat', async () => {
  const inner = innerHost(workingAgent());
  const { seen, emit } = recorder();
  const outside = seam('ahp-session:/outer');
  const session = nestedAgent(backend(), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 })
    .create({ ...start(emit), subagent: outside.subagent } as unknown as Start);
  session.begin('t1', 'go');
  await until(() => seen.some(({ action }) => action.type === 'chat/turnComplete'));
  const links = JSON.stringify(seen.filter(({ channel }) => channel === 'chat')).match(/ahp-chat:\/\/subagent\/[^"\\]+/g) ?? [];
  expect(links.length).toBeGreaterThan(0);
  expect([...new Set(links)]).toEqual([subagentChatUri('ahp-session:/outer', 'call-1')]);
  session.close();
});

it('the catalogue rows of an inner subagent chat reach a client outside under the outer URI', async () => {
  const inner = innerHost(workingAgent());
  const host = createHost({
    path: REPO_ROOT,
    agents: [nestedAgent(backend(), { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 500 })],
    computers: { how: async () => ({ command: 'true', args: [] }) },
  });
  const peer = watching();
  const client = host.accept(peer);
  const uri = 'ahp-session:/nested';
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  await client.handle({ method: 'createSession', params: { channel: uri, provider: PROVIDER, config: { computer: 'computer://box' } } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUriFor(uri) } });
  await client.handle({ method: 'dispatchAction', params: { channel: chatUriFor(uri), clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } } });
  await until(() => peer.seen.some(({ params }) => params?.action?.type === 'chat/turnComplete' && params?.channel === chatUriFor(uri)));
  const worker = subagentChatUri(uri, 'call-1');
  const added = peer.seen.find(({ params }) => params?.action?.type === 'session/chatAdded')?.params.action;
  expect(added?.summary.resource).toBe(worker);
  expect(added?.summary.title).toBe('Explore');
  expect(added?.summary.origin).toEqual({ kind: 'tool', chat: chatUriFor(uri), toolCallId: 'call-1' });
  // Every subagent chat a client was told of is the outer one.
  const named = JSON.stringify(peer.seen).match(/ahp-chat:\/\/subagent\/[^"\\]+/g) ?? [];
  expect([...new Set(named)]).toEqual([worker]);
  await host.close();
});

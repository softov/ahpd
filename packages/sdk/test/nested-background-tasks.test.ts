/*
 * A nested host's background tasks, drawn by the host outside.
 *
 * The backend inside reports a task to the host inside, which builds the row;
 * the proxy out here reports that row to the host outside, which builds its
 * own. What the cases below check is the translation between the two: the
 * outer chat, no terminal the outside cannot reach, and a stop that is a
 * request back into the machine.
 */

import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { createPeer, receive } from '../src/rpc.js';
import { nestedAgent } from '../src/sessions/nested.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { BackgroundTask, BackgroundTasks } from '../src/types/background.js';
import type { NestedHost } from '../src/sessions/nested.js';
import type { Handler, Peer, Wire } from '../src/types/rpc.js';
import { startedNow } from './support/started.js';
import { WAIT_MS } from '../../../tools/wait.ts';

const PROVIDER = 'cofold';
const PLUGINS = ['@ahpd/agent-cofold'];
const REPO_ROOT = '/tmp/ahpd-nested-background';

type Bag = Record<string, any>;

/** Wait for something the proxy does asynchronously, without a fixed sleep. */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

/** What a session emitted, in order, with the channel it came out on. */
const recorder = (): {
  seen: { channel: string; action: Bag }[];
  emit: (channel: 'session' | 'chat' | 'terminal', action: Bag) => void;
} => {
  const seen: { channel: string; action: Bag }[] = [];
  return { seen, emit: (channel, action) => { seen.push({ channel, action }); } };
};

/** What the host outside was handed on `Start`, and what was reported through it. */
interface Seam {
  set: { chat: string; task: BackgroundTask }[];
  removed: { chat: string; id: string }[];
  tasks: BackgroundTasks;
}

const seam = (): Seam => {
  const set: Seam['set'] = [];
  const removed: Seam['removed'] = [];
  return {
    set,
    removed,
    tasks: {
      set: (chat, task) => { set.push({ chat, task }); },
      remove: (chat, id) => { removed.push({ chat, id }); },
    },
  };
};

/** The outermost session's own `Start`, with `emit` and the seam it was handed. */
const start = (emit: (channel: 'session' | 'chat' | 'terminal', action: Bag) => void, tasks: BackgroundTasks): Start => ({
  uri: 'ahp-session:/outer',
  chatUri: 'ahp-chat:/outer',
  settings: { computer: 'computer://box' },
  backgroundTasks: tasks,
  emit,
} as unknown as Start);

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
    end: (code: number | null, signal: string | null): void => { fire('exit', code, signal); fire('close', code, signal); },
  };
}

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
          if (line.trim() === '') continue;
          receive(line, peer, handler);
        }
      },
      on: () => { /* an in-memory pipe never fails */ },
      end: () => { /* nor closes under the writer */ },
    },
    stdout: { on: (_event: string, listener: (chunk: unknown) => void) => { toOuter = (text) => listener(`${text}\n`); } },
    stderr: { on: () => { /* nothing is read from it here */ } },
    on: ends.on,
    kill: () => true,
  } as unknown as NestedHost;
  return { host, proc };
};

/**
 * An inner backend that reports one shell task as its turn starts.
 *
 * Reported from `begin` rather than from `create`, because the proxy subscribes
 * to the inner chat as it comes up: a task reported before that subscription
 * exists is in the snapshot the proxy reads but is never an action for it, and
 * this test is about the actions.
 */
const reporting = (counted: { stops: number; inner: Start | undefined }, base: Agent): Agent => ({
  ...base,
  provider: PROVIDER,
  displayName: 'Cofold',
  create: (given) => {
    const held = startedNow(base.create(given));
    counted.inner = given;
    return {
      ...held,
      sendMessage: (...args: Parameters<typeof held.sendMessage>) => {
        void held.sendMessage(...args);
        given.backgroundTasks?.set(given.chatUri, {
          id: 'shell:t-sleep',
          kind: 'shell',
          label: 'sleep 100',
          startedAt: '2026-01-01T00:00:00.000Z',
          command: 'sleep 100',
          stop: async () => { counted.stops += 1; return true; },
        });
      },
    };
  },
});

/** A session outside, one backend inside, and what the outside was told. */
const opened = async () => {
  const counted = { stops: 0, inner: undefined as Start | undefined };
  const agent = reporting(counted, echo({ path: REPO_ROOT, pace: 0 }));
  const inner = innerHost(agent);
  const { seen, emit } = recorder();
  const outside = seam();
  const lines: string[] = [];
  const session = nestedAgent(agent, { plugins: PLUGINS, start: async () => inner.proc, timeoutMs: 2000, log: (line) => { lines.push(line); } }).create(start(emit, outside.tasks));
  void session.sendMessage('t1', 'run it in the background');
  await until(() => outside.set.length > 0);
  return { session, seen, outside, counted, inner, lines };
};

it('an inner shell row reaches the outer host with no terminal', async () => {
  const { session, seen, outside } = await opened();

  expect(outside.set).toHaveLength(1);
  const [{ chat, task }] = outside.set as [Seam['set'][number]];
  // The outer chat, which is what a client outside subscribes to.
  expect(chat).toBe('ahp-chat:/outer');
  expect(task).toEqual({
    id: 'shell:t-sleep',
    kind: 'shell',
    label: 'sleep 100',
    startedAt: '2026-01-01T00:00:00.000Z',
    command: 'sleep 100',
    stop: expect.any(Function),
  });
  // No `terminal`: one would name a channel of the host inside, which no
  // client out here can subscribe to.
  expect(task.terminal).toBeUndefined();

  // And the inner action itself never goes out, so a client is not told twice.
  expect(seen.filter(({ action }) => String(action.type).startsWith('chat/backgroundWork'))).toEqual([]);
  session.close();
});

it('an outer stop reaches the host inside and answers its result', async () => {
  const { session, outside, counted } = await opened();

  const task = outside.set[0]?.task;
  if (task?.stop === undefined) throw new Error('the row carries no stop');
  expect(await task.stop()).toBe(true);
  // The inner backend's own stop ran, once.
  expect(counted.stops).toBe(1);
  session.close();
});

it('an inner removal takes the outer row off', async () => {
  const { session, outside, counted } = await opened();
  expect(counted.inner?.backgroundTasks).toBeDefined();

  counted.inner?.backgroundTasks?.remove(counted.inner.chatUri, 'shell:t-sleep');
  await until(() => outside.removed.length > 0);
  expect(outside.removed).toEqual([{ chat: 'ahp-chat:/outer', id: 'shell:t-sleep' }]);
  session.close();
});

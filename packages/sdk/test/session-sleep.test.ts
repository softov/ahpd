/*
 * A quiet session sleeps.
 *
 * A live session holds its agent between turns. With nothing in hand for
 * `sleepAfterMinutes`, over `sessionResidencyLimit`, or archived, the host lets
 * the agent go with `close('stopping')`, and the session stays in the
 * catalogue, the same as after a daemon restart. What keeps it awake: a
 * running or queued turn, a person being asked something, `resumable()`
 * false, `busy()` true, and a client subscribed to it.
 *
 * The clock is the host's `now` and `timer`, so a case moves time and fires
 * the minute sweep by hand.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions } from '../src/types/host.js';
import type { Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';
import type { Terminal } from '../src/types/terminals.js';

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-sleep-'));
  made.push(dir);
  return dir;
};

const peer = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const until = async (ready: () => boolean, tries = 200): Promise<void> => {
  for (let i = 0; i < tries && !ready(); i++) await settle(1);
  if (!ready()) throw new Error(`still waiting after ${tries} tries`);
};

/** What a case sets on the sessions the backend makes, and reads back from them. */
interface Knobs {
  /** How many times a session's agent was started, a wake included. */
  starts?: number;
  /** Each `close` call, with the reason it was handed. */
  closes: ('dispose' | 'stopping' | undefined)[];
  /** The id of each session a `close` was called on. */
  closed?: string[];
  resumable?: boolean;
  busy?: boolean;
  /** A chat state to answer in place of the backend's own. */
  state?: (state: Bag) => Bag;
  /** A `SessionStatus` to answer in place of the backend's own. */
  status?: number;
  /** What a `close` waits on before it finishes, as an agent slow to exit. */
  exiting?: Promise<void>;
}

/** The echo backend, with the knobs a case turns. */
const wrapped = (dir: string, knobs: Knobs): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    create: (start: Start): Session => {
      const session = base.create(start);
      knobs.starts = (knobs.starts ?? 0) + 1;
      return {
        ...session,
        close: (reason?: 'dispose' | 'stopping') => {
          knobs.closes.push(reason);
          knobs.closed?.push(session.agentId() ?? '');
          const exiting = knobs.exiting;
          if (exiting === undefined) return session.close(reason);
          return exiting.then(() => session.close(reason));
        },
        resumable: () => knobs.resumable ?? true,
        busy: () => knobs.busy ?? false,
        status: () => knobs.status ?? session.status(),
        chatState: () => {
          const state = session.chatState() as Bag;
          return knobs.state === undefined ? state : knobs.state(state);
        },
      };
    },
  };
};

/** A clock a case moves: `now` it reads, and the sweep's timer it fires. */
const clock = () => {
  let at = Date.parse('2026-10-10T12:00:00Z');
  const armed: (() => void)[] = [];
  return {
    now: (): Date => new Date(at),
    timer: (fire: () => void): { cancel(): void } => {
      armed.push(fire);
      return { cancel: () => { const i = armed.indexOf(fire); if (i >= 0) armed.splice(i, 1); } };
    },
    /** Move time by `minutes`, then run the sweep once. */
    pass: (minutes: number): void => {
      at += minutes * 60_000;
      const due = armed.splice(0);
      for (const fire of due) fire();
    },
  };
};

type Options = Partial<Pick<HostOptions, 'sleepAfterMinutes' | 'sessionResidencyLimit' | 'terminals'>>;

/** One host and one client watching the root. */
async function serving(knobs: Knobs, options: Options = {}) {
  const dir = temp();
  const time = clock();
  const host = createHost({
    path: dir,
    agents: [wrapped(dir, knobs)],
    sessions: memorySessions(),
    now: time.now,
    timer: time.timer,
    ...options,
  });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });

  /** A session with one finished turn, and the channels it is read on. */
  const open = async (name: string) => {
    const channel = `ahp-session:/${name}`;
    /** The session's own name, which the catalogue lists it by. */
    const resource = `ahp-session:/${name}`;
    await client.handle({ method: 'createSession', params: { channel, provider: 'echo' } });
    const opened = await client.handle({ method: 'subscribe', params: { channel } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const chatUri = opened.snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    const say = async (text: string, clientSeq = 0): Promise<void> => {
      const before = await turns(chatUri);
      await client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, clientSeq, action: { type: 'chat/turnStarted', turnId: `${name}-${String(before)}`, message: { text } } },
      });
      for (let i = 0; i < 200 && await turns(chatUri) === before; i++) await settle(1);
    };
    await say('hello');
    /** Stop watching the session and its chat, which leaves it free to sleep. */
    const leave = async (): Promise<void> => {
      await client.handle({ method: 'unsubscribe', params: { channel: chatUri } });
      await client.handle({ method: 'unsubscribe', params: { channel } });
    };
    return { channel, resource, chatUri, say, leave };
  };

  const turns = async (chatUri: string): Promise<number> => {
    const read = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as { snapshot: { state: Bag } };
    return (read.snapshot.state.turns as Bag[]).length;
  };

  const root = async (): Promise<Bag> =>
    ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } })) as { snapshot: { state: Bag } }).snapshot.state;
  /** The sessions the root says are open: running, and asleep until disposed. */
  const active = async (): Promise<number> => Number((await root()).activeSessions);
  /** The sessions whose agent runs now: every start less every close. */
  const awake = (): number => (knobs.starts ?? 0) - knobs.closes.length;
  const listed = async (): Promise<string[]> => {
    const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: { resource: string }[] };
    return rows.items.map((one) => one.resource);
  };

  return { host, client, time, open, active, awake, listed, dir };
}

it('sleeps a session quiet for longer than the timeout', async () => {
  const knobs: Knobs = { closes: [] };
  const { time, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  expect(awake()).toBe(1);

  time.pass(29);
  await settle();
  expect(awake()).toBe(1);

  time.pass(2);
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
});

it('keeps a session awake while a turn runs or a message is queued', async () => {
  const knobs: Knobs = { closes: [] };
  const { time, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();

  knobs.state = (state) => ({ ...state, queuedMessages: [{ id: 'q', message: { text: 'next' } }] });
  time.pass(31);
  await settle();
  expect(awake()).toBe(1);
  expect(knobs.closes).toEqual([]);

  delete knobs.state;
  // `SessionStatus` 8, in progress: a turn running.
  knobs.status = 8;
  time.pass(31);
  await settle();
  expect(awake()).toBe(1);

  delete knobs.status;
  time.pass(1);
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
});

it('keeps a session awake while a tool confirmation or an input request waits', async () => {
  const knobs: Knobs = { closes: [] };
  const { time, open, active } = await serving(knobs);
  const one = await open('one');
  await one.leave();

  const waiting = (part: Bag) => (state: Bag): Bag => ({ ...state, activeTurn: { id: 'asking', message: { text: 'go' }, responseParts: [part] } });
  knobs.state = waiting({ kind: 'toolCall', toolCall: { toolCallId: 'c', status: 'pending-confirmation' } });
  time.pass(31);
  await settle();
  expect(await active()).toBe(1);

  knobs.state = waiting({ kind: 'inputRequest', id: 'r', questions: [] });
  time.pass(31);
  await settle();
  expect(await active()).toBe(1);
  expect(knobs.closes).toEqual([]);
});

it('keeps a session awake when resumable answers false', async () => {
  const knobs: Knobs = { closes: [], resumable: false };
  const { time, open, active } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  time.pass(31);
  await settle();
  expect(await active()).toBe(1);
  expect(knobs.closes).toEqual([]);
});

it('keeps a session awake when busy answers true', async () => {
  const knobs: Knobs = { closes: [], busy: true };
  const { time, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  time.pass(31);
  await settle();
  expect(awake()).toBe(1);

  knobs.busy = false;
  time.pass(1);
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
});

it('does not count a client subscribe as activity', async () => {
  const knobs: Knobs = { closes: [] };
  const { client, time, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();

  time.pass(20);
  // A look and away again: presence, not work in the session.
  await client.handle({ method: 'subscribe', params: { channel: one.channel } });
  await client.handle({ method: 'unsubscribe', params: { channel: one.channel } });
  time.pass(11);
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
});

it('keeps a session awake while a client is subscribed to it', async () => {
  const knobs: Knobs = { closes: [] };
  const { time, open, active } = await serving(knobs);
  await open('one');
  time.pass(31);
  await settle();
  time.pass(60);
  await settle();
  expect(await active()).toBe(1);
  expect(knobs.closes).toEqual([]);
});

it('sleeps the least recently used quiet session over the count limit', async () => {
  const knobs: Knobs = { closes: [], closed: [] };
  const { time, open, awake, active, listed } = await serving(knobs, { sessionResidencyLimit: 2 });
  const one = await open('one');
  await one.leave();
  time.pass(0.1);
  const two = await open('two');
  await two.leave();
  time.pass(0.1);
  expect(awake()).toBe(2);

  // A third session's turn start puts three over a limit of two.
  await open('three');
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(2);
  // Asleep is not disposed: all three are open sessions.
  expect(await active()).toBe(3);
  expect(knobs.closed).toEqual(['one']);
  // The oldest turn start went, and every one of them is still listed.
  const rows = await listed();
  expect(rows).toEqual(expect.arrayContaining([one.resource, two.resource, 'ahp-session:/three']));
  expect(rows).toHaveLength(3);
});

it('sleeps an archived session at once', async () => {
  const knobs: Knobs = { closes: [] };
  const { client, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: one.chatUri, clientSeq: 1, action: { type: 'chat/isArchivedChanged', isArchived: true } },
  });
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
});

it('closes each chat with close(\'stopping\'), and keeps its terminals and rule state', async () => {
  const knobs: Knobs = { closes: [] };
  const shells = shellTerminals();
  const opened: Terminal[] = [];
  const { client, time, open, awake } = await serving(knobs, {
    terminals: { create: (options) => { const one = shells.create(options); opened.push(one); return one; } },
  });
  const one = await open('one');
  await client.handle({
    method: 'createTerminal',
    params: { channel: 'ahp-terminal:/kept', claim: { kind: 'session', session: one.resource, chat: one.chatUri }, cwd: `file://${tmpdir()}` },
  });
  expect(opened).toHaveLength(1);
  await one.leave();

  time.pass(31);
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
  expect(knobs.closes).toEqual(['stopping']);
  // The shell is the session's still: running, and listed on the root.
  expect(opened[0]?.exitCode()).toBeUndefined();
  const terminals = ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } })) as {
    snapshot: { state: { terminals: { resource: string }[] } };
  }).snapshot.state.terminals;
  expect(terminals.map((one) => one.resource)).toContain('ahp-terminal:/kept');
  opened[0]?.close();
});

it('lists a sleeping session in the catalogue, and counts it among the open sessions', async () => {
  const knobs: Knobs = { closes: [] };
  const { time, open, active, awake, listed } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  time.pass(31);
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
  // Asleep is not disposed, and the protocol counts the non-disposed.
  expect(await active()).toBe(1);
  expect(await listed()).toContain(one.resource);
});

it('never sleeps with sleepAfterMinutes 0 and sessionResidencyLimit 0', async () => {
  const knobs: Knobs = { closes: [] };
  const { time, open, active } = await serving(knobs, { sleepAfterMinutes: 0, sessionResidencyLimit: 0 });
  const one = await open('one');
  await one.leave();
  await (await open('two')).leave();
  time.pass(24 * 60);
  await settle();
  expect(await active()).toBe(2);
  expect(knobs.closes).toEqual([]);
});

it('waits on host close for a sleep whose agent is still closing', async () => {
  const knobs: Knobs = { closes: [] };
  const { host, time, open } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  let exited!: () => void;
  knobs.exiting = new Promise<void>((done) => { exited = done; });

  time.pass(31);
  await until(() => knobs.closes.length > 0);
  let closed = false;
  void host.close().then(() => { closed = true; });
  await settle();
  expect(closed).toBe(false);

  exited();
  await until(() => closed);
  expect(closed).toBe(true);
});

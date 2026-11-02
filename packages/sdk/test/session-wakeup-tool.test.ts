/*
 * An agent schedules its own wake with `schedule_wakeup`.
 *
 * The wake is kept on the chat's record, so it fires whether the session is
 * live, asleep, or held by a host started again after the one that took it.
 * Its turn goes through the host's own turn gate, and a wake whose turn could
 * not begin stays on the record for the next start.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { hostTools } from '../src/tools/index.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, BoundTool, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Host } from '../src/types/host.js';
import type { Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';
import type { SessionStore } from '../src/types/sessions.js';

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-wakeup-'));
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

const until = async (ready: () => boolean | Promise<boolean>, what: string, tries = 400): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (await ready()) return;
    await settle(1);
  }
  throw new Error(`${what} never happened`);
};

/** What the backend was asked for, and the tools each chat was handed. */
interface Counts {
  /** Each session start, with the backend id it resumed or none. */
  starts: (string | undefined)[];
  closes: number;
  /** The host tools of the latest start of each chat, by chat URI. */
  tools: Map<string, BoundTool[]>;
  /** Whether a resume throws, as a backend that cannot load the conversation does. */
  failResume?: boolean;
}

/** The echo backend, counting starts and closes, and keeping the tools it was handed. */
const counted = (dir: string, counts: Counts): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    create: (start: Start): Session => {
      if (start.resume !== undefined && counts.failResume === true) throw new Error('The conversation could not be loaded');
      counts.starts.push(start.resume);
      counts.tools.set(start.chatUri, start.tools ?? []);
      const session = base.create(start);
      return {
        ...session,
        close: (reason?: 'dispose' | 'stopping') => {
          counts.closes += 1;
          return session.close(reason);
        },
      };
    },
  };
};

/** A clock a case moves, as in `session-sleep.test.ts`. */
const clock = () => {
  let at = Date.parse('2026-10-10T12:00:00Z');
  const armed: (() => void)[] = [];
  return {
    now: (): Date => new Date(at),
    timer: (fire: () => void): { cancel(): void } => {
      armed.push(fire);
      return { cancel: () => { const i = armed.indexOf(fire); if (i >= 0) armed.splice(i, 1); } };
    },
    pass: (minutes: number): void => {
      at += minutes * 60_000;
      for (const fire of armed.splice(0)) fire();
    },
  };
};

type Clock = ReturnType<typeof clock>;

/**
 * One host over a store, a backend and a clock that a second host can share.
 *
 * The backend is shared because echo keeps its conversations in memory: a
 * second host over the same one is a restart over transcripts that outlived
 * the first, as claude's on disk do.
 */
async function serving(world: { dir: string; kept: SessionStore; time: Clock; counts: Counts; agent: Agent }) {
  const { dir, kept, time, counts, agent } = world;
  const host: Host = createHost({
    path: dir,
    agents: [agent],
    sessions: kept,
    tools: hostTools(),
    now: time.now,
    timer: time.timer,
  });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });

  const read = async (channel: string): Promise<Bag> =>
    ((await client.handle({ method: 'subscribe', params: { channel } })) as { snapshot: { state: Bag } }).snapshot.state;
  /** The sessions whose agent runs now: every start less every close. */
  const awake = (): number => counts.starts.length - counts.closes;
  /** The sessions the root says are open: running, and asleep until disposed. */
  const active = async (): Promise<number> => Number((await read('ahp-root://')).activeSessions);
  const turnsOf = async (chat: string): Promise<Bag[]> => (await read(chat)).turns as Bag[];
  const textsOf = async (chat: string): Promise<string[]> => (await turnsOf(chat)).map((turn) => String((turn.message as Bag).text));

  let seq = 0;
  const prompt = (chat: string, text: string): Promise<unknown> => {
    seq += 1;
    return client.handle({
      method: 'dispatchAction',
      params: { channel: chat, clientSeq: seq, action: { type: 'chat/turnStarted', turnId: `t${String(seq)}`, message: { text } } },
    });
  };

  /** A session with one finished turn. */
  const open = async (name: string) => {
    await client.handle({ method: 'createSession', params: { channel: `ahp-session:/${name}`, provider: 'echo' } });
    // The name the session is held by, which its chat record is kept under.
    const channel = `ahp-session:/${name}`;
    const chat = String((await read(channel)).defaultChat);
    await prompt(chat, `hello ${name}`);
    await until(async () => (await turnsOf(chat)).length === 1, `the first turn of ${name}`);
    return { channel, chat, id: name };
  };

  /** Call `schedule_wakeup` as the agent in `chat` would. */
  const wakeup = async (chat: string, input: Record<string, unknown>): Promise<string> => {
    const tool = counts.tools.get(chat)?.find((one) => one.definition.name === 'schedule_wakeup');
    if (tool?.run === undefined) throw new Error(`${chat} was handed no schedule_wakeup`);
    return await tool.run(input);
  };

  /** Stop watching a session and its chat, and let the sweep sleep it. */
  const sleep = async (session: { channel: string; chat: string }): Promise<void> => {
    const before = counts.closes;
    await client.handle({ method: 'unsubscribe', params: { channel: session.chat } });
    await client.handle({ method: 'unsubscribe', params: { channel: session.channel } });
    time.pass(31);
    await until(() => counts.closes > before, 'the sleep');
  };

  /** The wake a chat's record holds. */
  const stored = (id: string, chat: string): Bag | undefined => kept.chats(id).find((one) => one.uri === chat)?.wake;

  return { host, client, open, wakeup, sleep, prompt, read, active, awake, turnsOf, textsOf, stored };
}

const world = () => {
  const dir = temp();
  const counts: Counts = { starts: [], closes: 0, tools: new Map() };
  return { dir, kept: memorySessions(), time: clock(), counts, agent: counted(dir, counts) };
};

it('begins a turn with the prompt when the wake is due', async () => {
  const w = world();
  const { open, wakeup, textsOf, stored } = await serving(w);
  const one = await open('one');

  expect(await wakeup(one.chat, { delaySeconds: 600, prompt: 'check the build' })).toBe('Wakeup scheduled for 2026-10-10T12:10:00.000Z.');
  expect(stored(one.id, one.chat)).toEqual({ at: Date.parse('2026-10-10T12:10:00Z'), prompt: 'check the build' });

  w.time.pass(9);
  await settle();
  expect(await textsOf(one.chat)).toEqual(['hello one']);

  w.time.pass(2);
  await until(async () => (await textsOf(one.chat)).length === 2, 'the woken turn');
  expect(await textsOf(one.chat)).toEqual(['hello one', 'check the build']);
  // Spent: the record holds it no more.
  expect(stored(one.id, one.chat)).toBeUndefined();
});

it('wakes a sleeping session for its wake', async () => {
  const w = world();
  const { open, wakeup, sleep, awake, textsOf } = await serving(w);
  const one = await open('one');
  await wakeup(one.chat, { delaySeconds: 3600, prompt: 'check the build' });
  await sleep(one);
  expect(awake()).toBe(0);

  w.time.pass(30);
  await until(() => awake() === 1, 'the wake');
  await until(async () => (await textsOf(one.chat)).length === 2, 'the woken turn');
  expect(await textsOf(one.chat)).toEqual(['hello one', 'check the build']);
  expect(w.counts.starts).toEqual([undefined, 'one']);
});

it('replaces the wake on a second call, and cancels it with stop', async () => {
  const w = world();
  const { open, wakeup, textsOf, stored } = await serving(w);
  const one = await open('one');

  expect(await wakeup(one.chat, { stop: true })).toBe('No wakeup was scheduled.');
  await wakeup(one.chat, { delaySeconds: 600, prompt: 'first' });
  await wakeup(one.chat, { delaySeconds: 1200, prompt: 'second' });
  expect(stored(one.id, one.chat)?.prompt).toBe('second');

  w.time.pass(11);
  await settle();
  expect(await textsOf(one.chat)).toEqual(['hello one']);
  w.time.pass(10);
  await until(async () => (await textsOf(one.chat)).length === 2, 'the second wake');
  expect(await textsOf(one.chat)).toEqual(['hello one', 'second']);

  await wakeup(one.chat, { delaySeconds: 600, prompt: 'third' });
  expect(await wakeup(one.chat, { stop: true })).toBe('Wakeup cancelled.');
  expect(stored(one.id, one.chat)).toBeUndefined();
  w.time.pass(20);
  await settle();
  expect(await textsOf(one.chat)).toEqual(['hello one', 'second']);
});

it('fires a stored wake after the host restarts', async () => {
  const w = world();
  const first = await serving(w);
  const one = await first.open('one');
  await first.wakeup(one.chat, { delaySeconds: 600, prompt: 'check the build' });
  await first.host.close();

  const second = await serving(w);
  expect(second.stored(one.id, one.chat)?.prompt).toBe('check the build');
  await settle();
  expect(await second.active()).toBe(0);

  w.time.pass(11);
  await until(async () => await second.active() === 1, 'the wake');
  await until(async () => (await second.textsOf(one.chat)).length === 2, 'the woken turn');
  expect(await second.textsOf(one.chat)).toEqual(['hello one', 'check the build']);
  expect(w.counts.starts).toEqual([undefined, 'one']);
});

it('fires a wake that fell due while the host was down once', async () => {
  const w = world();
  const first = await serving(w);
  const one = await first.open('one');
  await first.wakeup(one.chat, { delaySeconds: 600, prompt: 'check the build' });
  await first.host.close();
  w.time.pass(60);

  const second = await serving(w);
  await until(async () => await second.active() === 1, 'the wake at start');
  await until(async () => (await second.textsOf(one.chat)).length === 2, 'the woken turn');
  expect(second.stored(one.id, one.chat)).toBeUndefined();

  w.time.pass(60);
  await settle();
  expect(await second.textsOf(one.chat)).toEqual(['hello one', 'check the build']);
  expect(w.counts.starts).toEqual([undefined, 'one']);
});

it('lets a session with a pending host wake sleep', async () => {
  const w = world();
  const { open, wakeup, sleep, awake, stored } = await serving(w);
  const one = await open('one');
  await wakeup(one.chat, { delaySeconds: 3600, prompt: 'check the build' });

  await sleep(one);
  expect(awake()).toBe(0);
  // Still held, for the clock to fire.
  expect(stored(one.id, one.chat)?.prompt).toBe('check the build');
});

it('refuses a delay under 60 seconds or over 30 days, and stores nothing', async () => {
  const w = world();
  const { open, wakeup, stored } = await serving(w);
  const one = await open('one');

  for (const delaySeconds of [0, 59, 2_592_001, 1e13]) {
    await expect(wakeup(one.chat, { delaySeconds, prompt: 'later' })).rejects.toThrow(/from 60 to 2592000/);
    expect(stored(one.id, one.chat)).toBeUndefined();
  }
  expect(await wakeup(one.chat, { delaySeconds: 60, prompt: 'soon' })).toBe('Wakeup scheduled for 2026-10-10T12:01:00.000Z.');
  expect(await wakeup(one.chat, { delaySeconds: 2_592_000, prompt: 'late' })).toBe('Wakeup scheduled for 2026-11-09T12:00:00.000Z.');
});

it('begins no wake turn while the host refuses turns, and keeps it for the next start', async () => {
  const w = world();
  const first = await serving(w);
  const one = await first.open('one');
  await first.wakeup(one.chat, { delaySeconds: 60, prompt: 'check the build' });
  first.host.refuseTurns('host is stopping');

  w.time.pass(2);
  await settle(20);
  expect(await first.textsOf(one.chat)).toEqual(['hello one']);
  expect(first.stored(one.id, one.chat)?.prompt).toBe('check the build');
  await first.host.close();

  const second = await serving(w);
  await until(async () => (await second.textsOf(one.chat)).length === 2, 'the woken turn');
  expect(await second.textsOf(one.chat)).toEqual(['hello one', 'check the build']);
  expect(second.stored(one.id, one.chat)).toBeUndefined();
});

it('keeps a wake whose session cannot resume, for the next start', async () => {
  const w = world();
  const first = await serving(w);
  const one = await first.open('one');
  await first.wakeup(one.chat, { delaySeconds: 3600, prompt: 'check the build' });
  await first.sleep(one);
  expect(first.awake()).toBe(0);
  w.counts.failResume = true;

  w.time.pass(30);
  await settle(20);
  expect(first.awake()).toBe(0);
  expect(first.stored(one.id, one.chat)?.prompt).toBe('check the build');
  await first.host.close();

  w.counts.failResume = false;
  const second = await serving(w);
  await until(async () => (await second.textsOf(one.chat)).length === 2, 'the woken turn');
  expect(await second.textsOf(one.chat)).toEqual(['hello one', 'check the build']);
  expect(second.stored(one.id, one.chat)).toBeUndefined();
});

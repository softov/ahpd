/*
 * A sleeping session wakes when something needs it.
 *
 * `wake` is the one way a session that is not live comes back, resumed in
 * place with its earlier conversation. A prompt or any other client action, a
 * `send_message`, a pinned automation and a child's `childFinished` each call
 * it, and wakers that arrive together share one resume. A session does not
 * sleep while it is waking, or before the turn it was woken for has begun.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { memoryAutomations } from '../src/automations/automations.js';
import { createHost } from '../src/host.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { hostTools } from '../src/tools/index.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, BoundTool, Start } from '../src/types/agent.js';
import type { AutomationStore } from '../src/types/automations.js';
import type { Bag } from '../src/types/common.js';
import type { Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-wake-'));
  made.push(dir);
  return dir;
};

/** A client, keeping each notification it was sent. */
const peer = (): Peer & { notes: Bag[] } => {
  const notes: Bag[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => { notes.push({ method, ...(params as Bag) }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

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

/** What the backend was asked for, and what a case makes it refuse. */
interface Counts {
  /** Each session start, with the backend id it resumed or none. */
  starts: (string | undefined)[];
  closes: number;
  /** Whether a resume throws, as a backend that cannot load the conversation does. */
  failResume?: boolean;
  /** Transcript reads that wait, once the backend has started more than `after` sessions, and what they wait on. */
  slowTranscript?: { after: number; until: Promise<void> };
  /** The host tools of the latest start of each chat, by chat URI. */
  tools?: Map<string, BoundTool[]>;
  /** The echo backend's pace, in milliseconds a reply takes. */
  pace?: number;
  /** Whether the backend forks: each turn its session holds ends at `end:<turn>`. */
  forks?: boolean;
  /** Every start the backend was handed, in order. */
  made?: Start[];
  /** The chats running now, by the session each is a chat of. */
  running?: Map<string, number>;
}

/** The echo backend, counting the sessions it starts and resumes. */
const counted = (dir: string, counts: Counts): Agent => {
  const base = echo({ path: dir, pace: counts.pace ?? 0 });
  return {
    ...base,
    ...(counts.forks === true ? { chats: { ...base.chats, fork: true } } : {}),
    transcript: async (id: string) => {
      if (counts.slowTranscript !== undefined && counts.starts.length > counts.slowTranscript.after) await counts.slowTranscript.until;
      return await base.transcript?.(id);
    },
    create: (start: Start): Session => {
      if (start.resume !== undefined && counts.failResume === true) throw new Error('The conversation could not be loaded');
      counts.starts.push(start.resume);
      counts.made?.push(start);
      counts.tools?.set(start.chatUri, start.tools ?? []);
      const running = counts.running ??= new Map<string, number>();
      running.set(start.uri, (running.get(start.uri) ?? 0) + 1);
      const session = base.create(start);
      const holds = (turnId: string): boolean => session.allTurns().some((turn) => turn.id === turnId);
      return {
        ...session,
        ...(counts.forks === true ? { forkPoint: (turnId: string) => (holds(turnId) ? `end:${turnId}` : undefined) } : {}),
        close: (reason?: 'dispose' | 'stopping') => {
          counts.closes += 1;
          running.set(start.uri, (running.get(start.uri) ?? 1) - 1);
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

async function serving(counts: Counts, automations?: AutomationStore) {
  const dir = temp();
  const time = clock();
  const kept = memorySessions();
  const host = createHost({
    path: dir,
    agents: [counted(dir, counts)],
    sessions: kept,
    tools: hostTools(),
    now: time.now,
    timer: time.timer,
    ...(automations === undefined ? {} : { automations }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });

  const read = async (channel: string): Promise<Bag> =>
    ((await client.handle({ method: 'subscribe', params: { channel } })) as { snapshot: { state: Bag } }).snapshot.state;
  /**
   * The sessions with an agent running now: one with a chat started and not
   * closed. A sleep lets the agents go and keeps the session open, so the
   * root's count of the open ones is not this.
   */
  const awake = async (): Promise<number> => [...(counts.running ?? new Map<string, number>()).values()].filter((chats) => chats > 0).length;
  const turnsOf = async (chat: string): Promise<Bag[]> => (await read(chat)).turns as Bag[];

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
    const channel = `ahp-session:/${name}`;
    await client.handle({ method: 'createSession', params: { channel, provider: 'echo' } });
    const chat = String((await read(channel)).defaultChat);
    await prompt(chat, `hello ${name}`);
    await until(async () => (await turnsOf(chat)).length === 1, `the first turn of ${name}`);
    return { channel, resource: `ahp-session:/${name}`, chat };
  };

  /** Stop watching a session and its chat, and let the sweep sleep it. */
  const sleep = async (session: { channel: string; chat: string }): Promise<void> => {
    const before = counts.closes;
    await client.handle({ method: 'unsubscribe', params: { channel: session.chat } });
    await client.handle({ method: 'unsubscribe', params: { channel: session.channel } });
    time.pass(31);
    await until(() => counts.closes > before, 'the sleep');
  };

  const textsOf = async (chat: string): Promise<string[]> => (await turnsOf(chat)).map((turn) => String((turn.message as Bag).text));

  return { host, client, peer: p, kept, time, open, sleep, prompt, read, awake, turnsOf, textsOf, dir };
}

/** One automation that runs pinned to `session`. */
const pinnedTo = (dir: string, session: string): Bag => ({
  title: 'Check in',
  enabled: true,
  message: { text: 'check in' },
  session: { provider: 'echo', workingDirectories: [`file://${dir}`] },
  triggers: [{ id: 't1', kind: 'event', type: 'session', title: 'When a turn fails', events: [{ id: 'turnFailed' }], config: {} }],
  _meta: { ahpd: { session: 'pinned', pinnedSession: session } },
});

it('wakes a sleeping session on a prompt and answers with the earlier conversation', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { open, sleep, prompt, awake, turnsOf } = await serving(counts);
  const one = await open('one');
  await sleep(one);
  expect(await awake()).toBe(0);

  await prompt(one.chat, 'again');
  await until(async () => (await turnsOf(one.chat)).length === 2, 'the woken turn');
  expect(await awake()).toBe(1);
  // Resumed as the conversation it was, not started afresh.
  expect(counts.starts).toEqual([undefined, 'one']);
  const turns = await turnsOf(one.chat);
  expect(turns.map((turn) => (turn.message as Bag).text)).toEqual(['hello one', 'again']);
});

it('gives the turn that woke a session the origin of the prompt that woke it', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { open, sleep, prompt, read, awake, turnsOf, peer: p } = await serving(counts);
  const one = await open('one');
  await sleep(one);
  // Watched again before the prompt, so the echo has somewhere to go, and
  // still asleep: reading a chat does not wake it.
  await read(one.chat);
  expect(await awake()).toBe(0);
  p.notes.length = 0;

  await prompt(one.chat, 'again');
  await until(async () => (await turnsOf(one.chat)).length === 2, 'the woken turn');
  const started = p.notes.find((note) => note.method === 'action' && (note.action as Bag).type === 'chat/turnStarted');
  expect((started?.action as Bag).turnId).toBe('t2');
  expect(started?.origin).toEqual({ clientId: 'window', clientSeq: 2 });
});

it('wakes a pinned session for an automation run and makes no new session', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const store = memoryAutomations();
  const { client, open, sleep, awake, turnsOf, dir } = await serving(counts, store);
  const one = await open('one');
  await sleep(one);
  store.create('ahp-automation:/check', pinnedTo(dir, one.resource));

  await client.handle({ method: 'runAutomation', params: { channel: 'ahp-automations://', automation: 'ahp-automation:/check', requestId: 'r' } });
  await until(() => (store.get('ahp-automation:/check')?.runs ?? []).length === 1, 'the run');
  const run = (store.get('ahp-automation:/check')?.runs ?? [])[0] as unknown as Bag;
  expect(run.primarySession).toBe(one.resource);
  expect(counts.starts).toEqual([undefined, 'one']);
  await until(async () => (await turnsOf(one.chat)).length === 2, 'the run\'s turn');
  expect(await awake()).toBe(1);
});

it('wakes a parent for a child\'s childFinished', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { open, sleep, prompt, awake, kept } = await serving(counts);
  const parent = await open('parent');
  await sleep(parent);
  const child = await open('child');
  kept.setParent?.('child', 'parent');
  expect(await awake()).toBe(1);

  // The child's turn ends with nothing behind it, which is what its parent waits to hear.
  await prompt(child.chat, 'done');
  await until(async () => await awake() === 2, 'the parent waking');
  expect(counts.starts).toEqual([undefined, undefined, 'parent']);
});

it('resumes once when two wakers arrive together', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const store = memoryAutomations();
  const { client, open, sleep, prompt, awake, dir } = await serving(counts, store);
  const one = await open('one');
  await sleep(one);
  store.create('ahp-automation:/check', pinnedTo(dir, one.resource));

  await Promise.all([
    prompt(one.chat, 'again'),
    client.handle({ method: 'runAutomation', params: { channel: 'ahp-automations://', automation: 'ahp-automation:/check', requestId: 'r' } }),
  ]);
  await until(() => (store.get('ahp-automation:/check')?.runs ?? []).length === 1, 'the run');
  await settle();
  expect(counts.starts).toEqual([undefined, 'one']);
  expect(await awake()).toBe(1);
});

it('fails the action with the resume error when a session cannot resume', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { open, sleep, prompt, awake, peer: p } = await serving(counts);
  const one = await open('one');
  await sleep(one);

  counts.failResume = true;
  await prompt(one.chat, 'again');
  await until(() => p.notes.some((note) => note.rejectionReason !== undefined), 'the refusal');
  const refused = p.notes.find((note) => note.rejectionReason !== undefined) as Bag;
  expect(refused.rejectionReason).toBe('The conversation could not be loaded');
  // Left as it was: asleep, and still a session a later prompt can wake.
  expect(await awake()).toBe(0);
  counts.failResume = false;
  await prompt(one.chat, 'once more');
  await until(async () => await awake() === 1, 'the later wake');
});

it('does not sleep a session while it is waking', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { client, time, open, sleep, prompt, read, awake, textsOf } = await serving(counts);
  const one = await open('one');
  const lead = String((await read(one.resource)).defaultChat);
  await client.handle({ method: 'createChat', params: { channel: one.resource, chat: 'ahp-chat:/second' } });
  await prompt('ahp-chat:/second', 'second hi');
  await until(async () => (await textsOf('ahp-chat:/second')).length === 1, 'the second chat\'s turn');
  await client.handle({ method: 'unsubscribe', params: { channel: 'ahp-chat:/second' } });
  await client.handle({ method: 'unsubscribe', params: { channel: one.resource } });
  await client.handle({ method: 'unsubscribe', params: { channel: lead } });
  await sleep(one);
  const closes = counts.closes;

  // The resume stops at the second chat's transcript, with the lead started.
  const starts = counts.starts.length;
  let read_!: () => void;
  counts.slowTranscript = { after: starts, until: new Promise<void>((done) => { read_ = done; }) };
  void prompt(lead, 'after sleep');
  await until(() => counts.starts.length > starts, 'the lead chat\'s resume');

  time.pass(31);
  await settle();
  expect(counts.closes).toBe(closes);

  read_();
  delete counts.slowTranscript;
  // On the chat it was sent to, in the session that stayed awake.
  await until(async () => (await textsOf(lead)).at(-1) === 'after sleep', 'the woken turn');
  expect((await textsOf('ahp-chat:/second')).at(-1)).toBe('second hi');
  expect(counts.closes).toBe(closes);
  expect(await awake()).toBe(1);
});

it('refuses a second Run of a pinned automation while the first wakes the session', async () => {
  const counts: Counts = { starts: [], closes: 0, pace: 30 };
  const store = memoryAutomations();
  const { client, open, sleep, textsOf, dir } = await serving(counts, store);
  const one = await open('one');
  await sleep(one);
  store.create('ahp-automation:/check', pinnedTo(dir, one.resource));
  const run = (id: string): Promise<unknown> =>
    client.handle({ method: 'runAutomation', params: { channel: 'ahp-automations://', automation: 'ahp-automation:/check', requestId: id } });

  // Both pressed in one tick: the second fails as it does on a live session.
  await Promise.all([run('r1'), run('r2')]);
  const runs = (): Bag[] => (store.get('ahp-automation:/check')?.runs ?? []) as unknown as Bag[];
  await until(() => runs().length === 2 && runs().every((one) => (one.lifecycle as Bag).status !== 'running'), 'both runs settling');
  const ends = runs().map((one) => [(one.lifecycle as Bag).status, ((one.lifecycle as Bag).error as Bag | undefined)?.message]);
  expect(ends).toContainEqual(['completed', undefined]);
  expect(ends).toContainEqual(['failed', 'The chat this automation runs in is already running a turn']);
  expect((await textsOf(one.chat)).filter((text) => text === 'check in')).toHaveLength(1);
  expect(counts.starts).toEqual([undefined, 'one']);
});

it('starts no agent for a resume still going when the host closes', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { host, client, open, sleep, prompt, read, textsOf } = await serving(counts);
  const one = await open('one');
  const lead = String((await read(one.resource)).defaultChat);
  await client.handle({ method: 'createChat', params: { channel: one.resource, chat: 'ahp-chat:/second' } });
  await prompt('ahp-chat:/second', 'second hi');
  await until(async () => (await textsOf('ahp-chat:/second')).length === 1, 'the second chat\'s turn');
  await client.handle({ method: 'unsubscribe', params: { channel: 'ahp-chat:/second' } });
  await client.handle({ method: 'unsubscribe', params: { channel: one.resource } });
  await client.handle({ method: 'unsubscribe', params: { channel: lead } });
  await sleep(one);

  // The resume stops at the second chat's transcript, with the lead started.
  const starts = counts.starts.length;
  let read_!: () => void;
  counts.slowTranscript = { after: starts, until: new Promise<void>((done) => { read_ = done; }) };
  void prompt(lead, 'after sleep');
  await until(() => counts.starts.length > starts, 'the lead chat\'s resume');

  let closed = false;
  const closing = host.close().then(() => { closed = true; });
  await settle();
  expect(closed).toBe(false);
  read_();
  await closing;
  // The lead it had started is closed with the host, and the second chat never starts.
  expect(counts.starts).toHaveLength(starts + 1);
  expect(counts.closes).toBeGreaterThan(0);
});

it('refuses another owner\'s pinned automation without waking the session', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const store = memoryAutomations();
  const { client, kept, open, sleep, awake, dir } = await serving(counts, store);
  const one = await open('one');
  kept.setOwner?.('one', 'user:alice');
  await sleep(one);
  store.create('ahp-automation:/other', pinnedTo(dir, one.resource), 'user:mallory');

  await client.handle({ method: 'runAutomation', params: { channel: 'ahp-automations://', automation: 'ahp-automation:/other', requestId: 'r' } })
    .catch(() => undefined);
  await settle(20);
  expect(counts.starts).toEqual([undefined]);
  expect(await awake()).toBe(0);
});

it('wakes a sleeping session for a send_message from another', async () => {
  const counts: Counts = { starts: [], closes: 0, tools: new Map() };
  const { open, sleep, read, awake, textsOf } = await serving(counts);
  const a = await open('a');
  const b = await open('b');
  await sleep(b);
  expect(await awake()).toBe(1);

  const own = String((await read(a.resource)).defaultChat);
  const send = counts.tools?.get(own)?.find((tool) => tool.definition.name === 'send_message');
  if (send?.run === undefined) throw new Error('a was handed no send_message');
  await send.run({ session: b.resource, message: 'ping' });
  await until(async () => (await textsOf(b.chat)).length === 2, 'the sent turn');
  expect(await textsOf(b.chat)).toEqual(['hello b', 'ping']);
  expect(counts.starts).toEqual([undefined, undefined, 'b']);
  expect(await awake()).toBe(2);
});

it('wakes a sleeping session to rename it', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { client, kept, open, sleep, read, awake, peer: p } = await serving(counts);
  const one = await open('one');
  await sleep(one);
  // Opened again, as a client opening a sleeping row does: reading it wakes nothing.
  await read(one.resource);
  expect(await awake()).toBe(0);

  await client.handle({ method: 'dispatchAction', params: { channel: one.resource, clientSeq: 50, action: { type: 'session/titleChanged', title: 'renamed' } } });
  await until(async () => await awake() === 1, 'the wake');
  await settle();
  expect(p.notes.filter((note) => note.rejectionReason !== undefined)).toEqual([]);
  expect(counts.starts).toEqual([undefined, 'one']);
  expect(p.notes.some((note) => note.channel === one.resource && (note.action as Bag | undefined)?.type === 'session/titleChanged')).toBe(true);
  expect(kept.chatTitle('one', String((await read(one.resource)).defaultChat))).toBe('renamed');
});

/*
 * A session asleep runs no turn, so a stop on its chat has nothing to stop, and
 * the protocol has the server refuse it: "`chat/turnCancelled` | No active turn
 * | Server MUST reject the action". Refused as it arrives, with no backend
 * started to find that out.
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L353
 */
it('refuses a stop on a sleeping session without waking it', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { client, open, sleep, read, awake, peer: p } = await serving(counts);
  const one = await open('one');
  await sleep(one);
  await read(one.chat);
  p.notes.length = 0;

  await client.handle({ method: 'dispatchAction', params: { channel: one.chat, clientSeq: 60, action: { type: 'chat/turnCancelled', turnId: '' } } });
  await settle(20);
  expect(p.notes.filter((note) => note.method === 'action').map((note) => note.rejectionReason))
    .toEqual([`Nothing is running on ${one.chat} to stop`]);
  expect(counts.starts).toEqual([undefined]);
  expect(await awake()).toBe(0);
});

it('wakes a sleeping session for a chat forked from it, and forks at the turn', async () => {
  const counts: Counts = { starts: [], closes: 0, forks: true, made: [] };
  const { client, open, sleep, read, awake } = await serving(counts);
  const one = await open('one');
  await sleep(one);
  expect(await awake()).toBe(0);

  await client.handle({
    method: 'createChat',
    params: { channel: one.channel, chat: 'ahp-chat:/copy', source: { kind: 'fork', chat: one.chat, turnId: 't1' } },
  });
  expect(await awake()).toBe(1);
  // The wake resumes the session, and the fork resumes it again at the turn's point.
  expect(counts.starts).toEqual([undefined, 'one', 'one']);
  expect(counts.made?.at(-1)).toMatchObject({ chatUri: 'ahp-chat:/copy', resume: 'one', forkAt: 'end:t1' });
  const chats = ((await read(one.channel)).chats as Bag[]).map((chat) => chat.resource);
  expect(chats).toContain('ahp-chat:/copy');
});

it('wakes a sleeping session for a new chat in it', async () => {
  const counts: Counts = { starts: [], closes: 0 };
  const { client, open, sleep, read, awake } = await serving(counts);
  const one = await open('one');
  await sleep(one);

  await client.handle({ method: 'createChat', params: { channel: one.channel, chat: 'ahp-chat:/second' } });
  expect(await awake()).toBe(1);
  expect(counts.starts).toEqual([undefined, 'one', undefined]);
  const chats = ((await read(one.channel)).chats as Bag[]).map((chat) => chat.resource);
  expect(chats).toContain('ahp-chat:/second');
});

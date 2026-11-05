/*
 * A quiet session sleeps.
 *
 * A live session holds its agent between turns. With nothing in hand for
 * `sleepAfterMinutes`, over `sessionResidencyLimit`, or archived, the host lets
 * the agent go with `close('stopping')`, and the session stays in the
 * catalogue, the same as after a daemon restart. What keeps it awake: a
 * running turn or a message pending in its chat, a person being asked
 * something, `resumable()` false, `busy()` true, and a client subscribed to it.
 *
 * Its state stays resident, asleep or not, until the residency lets the
 * session go: archived, or the least recent while more sessions are resident
 * than the limit, and never while a client watches it.
 *
 * The clock is the host's `now` and `timer`, so a case moves time and fires
 * the minute sweep by hand.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
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
  /** Whether a turn sent now fails, as a client can resume it. */
  fail?: boolean;
  /** What a `close` waits on before it finishes, as an agent slow to exit. */
  exiting?: Promise<void>;
  /** What a read of the record answers in place of the turns the backend kept. */
  read?: (turns: Bag[]) => Bag[];
}

/** The echo backend, with the knobs a case turns. */
const wrapped = (dir: string, knobs: Knobs): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    transcript: async (id, at) => {
      const turns = await base.transcript?.(id, at);
      return knobs.read === undefined || turns === undefined
        ? turns
        : knobs.read(turns as unknown as Bag[]) as unknown as typeof turns;
    },
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
        sendMessage: (turnId, text, from, attachments, options) => {
          if (knobs.fail !== true) return session.sendMessage(turnId, text, from, attachments, options);
          start.emit('chat', {
            type: 'chat/error',
            turnId,
            duration: 0,
            part: { kind: 'error', error: { errorType: 'turnFailed', message: '429 rate limited' }, resumable: true },
          });
          return undefined;
        },
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
        params: { channel: chatUri, clientSeq, action: { type: 'chat/turnStarted', turnId: `${name}-${String(before)}`, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
      });
      for (let i = 0; i < 200 && await turns(chatUri) === before; i++) await settle(1);
    };
    await say('hello');
    /** Stop watching the session and its chat, which leaves it free to sleep. */
    const leave = async (): Promise<void> => {
      await client.handle({ method: 'unsubscribe', params: { channel: chatUri } });
      await client.handle({ method: 'unsubscribe', params: { channel } });
    };
    /** A queued message set, or taken back. */
    const queue = async (id: string, text: string): Promise<void> => {
      await client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text, origin: { kind: 'user' } } } },
      });
    };
    const unqueue = async (id: string): Promise<void> => {
      await client.handle({ method: 'dispatchAction', params: { channel: chatUri, action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id } } });
    };
    return { channel, resource, chatUri, say, leave, queue, unqueue };
  };

  const turns = async (chatUri: string): Promise<number> => {
    const read = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as { snapshot: { state: Bag } };
    return (read.snapshot.state.turns as Bag[]).length;
  };

  const root = async (): Promise<Bag> =>
    ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } })) as { snapshot: { state: Bag } }).snapshot.state;
  /** The sessions the root says are not disposed. */
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
  // Queued behind a failure a client can resume, which holds the chat's queue.
  knobs.fail = true;
  await one.say('again');
  delete knobs.fail;
  await one.queue('q', 'next');
  await one.leave();

  time.pass(31);
  await settle();
  expect(awake()).toBe(1);
  expect(knobs.closes).toEqual([]);

  await one.unqueue('q');
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
  const { time, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();

  const waiting = (part: Bag) => (state: Bag): Bag => ({ ...state, activeTurn: { id: 'asking', message: { text: 'go' }, responseParts: [part] } });
  knobs.state = waiting({ kind: 'toolCall', toolCall: { toolCallId: 'c', status: 'pending-confirmation' } });
  time.pass(31);
  await settle();
  expect(awake()).toBe(1);

  knobs.state = waiting({ kind: 'inputRequest', id: 'r', questions: [] });
  time.pass(31);
  await settle();
  expect(awake()).toBe(1);
  expect(knobs.closes).toEqual([]);
});

it('keeps a session awake when resumable answers false', async () => {
  const knobs: Knobs = { closes: [], resumable: false };
  const { time, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  time.pass(31);
  await settle();
  expect(awake()).toBe(1);
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
  const { time, open, awake } = await serving(knobs);
  await open('one');
  time.pass(31);
  await settle();
  time.pass(60);
  await settle();
  expect(awake()).toBe(1);
  expect(knobs.closes).toEqual([]);
});

it('keeps the state of a session asleep while it is resident, and replays a client back from a drop', async () => {
  /*
   * The reference host lets a session's state go only as its residency does:
   * archived, or the least recent over the limit. A session asleep and
   * unwatched under the limit keeps it, so a client that comes back is
   * replayed onto the state it holds.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L292-L299
   */
  const knobs: Knobs = { closes: [] };
  const { host, client, time, open } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  time.pass(31);
  await until(() => knobs.closes.length > 0);

  // A look at the chat asleep, and away again.
  const seen = await client.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as { snapshot: { fromSeq: number } };
  await client.handle({ method: 'unsubscribe', params: { channel: one.chatUri } });
  client.close();

  // The record moves, which a state let go would be read again from: the
  // state held is what the client comes back to.
  knobs.read = (turns) => turns.map((turn) => ({ ...turn, state: 'cancelled' }));
  const back = host.accept(peer());
  const answer = await back.handle({
    method: 'reconnect',
    params: { clientId: 'window', lastSeenServerSeq: seen.snapshot.fromSeq, subscriptions: [one.channel, one.chatUri] },
  }) as { type: string };
  expect(answer.type).toBe('replay');
  const held = await back.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as { snapshot: { state: Bag } };
  expect(((held.snapshot.state.turns ?? []) as Bag[]).map((turn) => turn.state)).not.toContain('cancelled');
});

it('replays to a client back from a drop onto what it holds, its session let go and opened again meanwhile', async () => {
  /*
   * A baseline is owed only for a channel a client holds with no snapshot from
   * this process: a session the residency let go is opened again from its
   * record and replayed onto what the client holds, as VS Code's host replays
   * onto a session it evicted and restored.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L692-L704
   */
  const knobs: Knobs = { closes: [], closed: [] };
  const { host, client, open } = await serving(knobs, { sessionResidencyLimit: 1 });
  const one = await open('one');
  const seen = await client.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as { snapshot: { fromSeq: number } };
  await open('two');
  // Two sessions over a limit of one, and the least recent is free once
  // nobody watches it.
  client.close();
  await until(() => knobs.closes.length > 0);
  expect(knobs.closed).toEqual(['one']);

  const back = host.accept(peer());
  const answer = await back.handle({
    method: 'reconnect',
    params: { clientId: 'window', lastSeenServerSeq: seen.snapshot.fromSeq, subscriptions: [one.channel, one.chatUri] },
  });
  expect(answer).toMatchObject({ type: 'replay', missing: [] });
});

/*
 * The replay onto a released session holds: a client that held the chat from
 * before the release, replayed what landed after the chat was read back from
 * its record, holds what a client subscribing now is served. The actions since
 * the release apply to the state read back, so this is the condition that
 * replay rests on.
 */
it('leaves a client replayed onto a chat read back after its release with what a new subscriber is served', async () => {
  const knobs: Knobs = { closes: [], closed: [] };
  const { host, client, open } = await serving(knobs, { sessionResidencyLimit: 1 });
  const one = await open('one');
  const seen = await client.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as {
    snapshot: { state: Bag; fromSeq: number };
  };
  await open('two');
  client.close();
  await until(() => knobs.closes.length > 0);
  expect(knobs.closed).toEqual(['one']);

  // Read back from its record by another window, and something said after.
  const other = host.accept(peer());
  await other.handle({ method: 'initialize', params: { clientId: 'other', protocolVersions: ['0.9.0'] } });
  await other.handle({ method: 'subscribe', params: { channel: one.chatUri } });
  await other.handle({
    method: 'dispatchAction',
    params: { channel: one.chatUri, action: { type: 'chat/draftChanged', draft: { text: 'after the release', origin: { kind: 'user' } } } },
  });
  await settle(4);

  const back = host.accept(peer());
  const answer = await back.handle({
    method: 'reconnect',
    params: { clientId: 'window', lastSeenServerSeq: seen.snapshot.fromSeq, subscriptions: [one.chatUri] },
  }) as { type: string; actions: { channel: string; action: Bag }[] };
  expect(answer.type).toBe('replay');
  const replayed = answer.actions
    .filter((one_) => one_.channel === one.chatUri)
    .reduce((state, one_) => chatReducer(state as never, one_.action as never) as unknown as Bag, seen.snapshot.state);
  const newcomer = host.accept(peer());
  await newcomer.handle({ method: 'initialize', params: { clientId: 'newcomer', protocolVersions: ['0.9.0'] } });
  const fresh = await newcomer.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as {
    snapshot: { state: Bag };
  };
  /*
   * Compared with each turn's start and the chat's last change taken off,
   * which VS Code's own restore reads from the agent's record: a restored turn
   * starts at its SDK message's time, and a restored default chat last changed
   * at the agent's modified time, so its replay onto a restored session holds
   * the record's.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L287
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L354
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L14773
   */
  const untimed = ({ modifiedAt: _at, ...state }: Bag): Bag => ({
    ...state,
    turns: ((state.turns ?? []) as Bag[]).map(({ startedAt: _started, ...turn }) => turn),
  });
  expect(untimed(replayed)).toEqual(untimed(fresh.snapshot.state));
});

/*
 * A chat read back from its record holds no queue where nothing is queued, as
 * it held none live: the protocol's reducer clears an emptied queue to
 * nothing, and VS Code's host opens a chat's state with none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L660-L676
 */
it('reads a chat back after its release with no queue where nothing is queued, as it held live', async () => {
  const knobs: Knobs = { closes: [], closed: [] };
  const { host, client, open } = await serving(knobs, { sessionResidencyLimit: 1 });
  const one = await open('one');
  const live = await client.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as { snapshot: { state: Bag } };
  await open('two');
  client.close();
  await until(() => knobs.closes.length > 0);
  expect(knobs.closed).toEqual(['one']);

  const other = host.accept(peer());
  await other.handle({ method: 'initialize', params: { clientId: 'other', protocolVersions: ['0.9.0'] } });
  const back = await other.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as { snapshot: { state: Bag } };
  expect(live.snapshot.state).not.toHaveProperty('queuedMessages');
  expect(back.snapshot.state).not.toHaveProperty('queuedMessages');
});

/*
 * A finished turn reads back after its release as the chat held it, complete:
 * the protocol's `Turn` says how each turn ended, and a read after a release
 * serves the turns the backend kept.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L710-L730
 */
it('reads a finished turn back after its release as complete, as the chat held it', async () => {
  const knobs: Knobs = { closes: [], closed: [] };
  const { host, client, open } = await serving(knobs, { sessionResidencyLimit: 1 });
  const one = await open('one');
  const live = await client.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as { snapshot: { state: Bag } };
  await open('two');
  client.close();
  await until(() => knobs.closes.length > 0);
  expect(knobs.closed).toEqual(['one']);

  const other = host.accept(peer());
  await other.handle({ method: 'initialize', params: { clientId: 'other', protocolVersions: ['0.9.0'] } });
  const back = await other.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as { snapshot: { state: Bag } };
  const ended = (state: Bag): unknown[] => ((state.turns ?? []) as Bag[]).map((turn) => turn.state);
  expect(ended(live.snapshot.state)).toEqual(['complete']);
  expect(ended(back.snapshot.state)).toEqual(['complete']);
});

/*
 * A session's default chat holds no title of its own until it is given one,
 * and reads as its session's, live and read back: the backend titles the
 * session from its first message, and the chat goes on reading as the session,
 * as VS Code's host keeps a default chat's title empty while it inherits its
 * session's.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1668-L1675
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1733-L1738
 */
it('holds a default chat with no title of its own as its session\'s, live and read back after its release', async () => {
  const knobs: Knobs = { closes: [], closed: [] };
  const { host, client, open } = await serving(knobs, { sessionResidencyLimit: 1 });
  const one = await open('one');
  const subscribed = async (to: typeof client, channel: string): Promise<Bag> =>
    ((await to.handle({ method: 'subscribe', params: { channel } })) as { snapshot: { state: Bag } }).snapshot.state;
  const live = { session: await subscribed(client, one.channel), chat: await subscribed(client, one.chatUri) };
  await open('two');
  client.close();
  await until(() => knobs.closes.length > 0);
  expect(knobs.closed).toEqual(['one']);

  const other = host.accept(peer());
  await other.handle({ method: 'initialize', params: { clientId: 'other', protocolVersions: ['0.9.0'] } });
  const back = { session: await subscribed(other, one.channel), chat: await subscribed(other, one.chatUri) };
  for (const held of [live, back]) {
    expect(held.session.title).toBe('hello');
    expect((held.session.chats as Bag[])[0]).toMatchObject({ resource: one.chatUri, title: '' });
    expect(held.chat.title).toBe('');
  }
});

/*
 * A default chat takes its session's title as its own once the session has
 * another chat, and keeps it through a rename of the session, live and read
 * back after its release: the store keeps it beside the session's own, as VS
 * Code's host snapshots a default chat's title when a chat is added and
 * restores it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1855-L1862
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L74-L100
 */
it('keeps a default chat\'s own title from when its session gained a chat, through a rename, live and read back', async () => {
  const knobs: Knobs = { closes: [], closed: [] };
  const { host, client, open } = await serving(knobs, { sessionResidencyLimit: 1 });
  const one = await open('one');
  const subscribed = async (to: typeof client, channel: string): Promise<Bag> =>
    ((await to.handle({ method: 'subscribe', params: { channel } })) as { snapshot: { state: Bag } }).snapshot.state;
  const peerChat = 'ahp-chat:/peer';
  await client.handle({ method: 'createChat', params: { channel: one.channel, chat: peerChat } });
  // Something said in it, so the session sleeps with both chats.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: peerChat, action: { type: 'chat/turnStarted', turnId: 'peer-0', startedAt: new Date().toISOString(), message: { text: 'second', origin: { kind: 'user' } } } },
  });
  for (let i = 0; i < 200 && ((await subscribed(client, peerChat)).turns as Bag[]).length === 0; i++) await settle(1);
  await client.handle({ method: 'dispatchAction', params: { channel: one.channel, action: { type: 'session/titleChanged', title: 'Renamed' } } });
  await settle(4);
  const live = { session: await subscribed(client, one.channel), chat: await subscribed(client, one.chatUri) };
  await open('two');
  client.close();
  await until(() => knobs.closed?.includes('one') === true);

  const other = host.accept(peer());
  await other.handle({ method: 'initialize', params: { clientId: 'other', protocolVersions: ['0.9.0'] } });
  const back = { session: await subscribed(other, one.channel), chat: await subscribed(other, one.chatUri) };
  expect(live.session.title).toBe('Renamed');
  for (const held of [live, back]) {
    expect((held.session.chats as Bag[]).find((row) => row.resource === one.chatUri)).toMatchObject({ title: 'hello' });
    expect(held.chat.title).toBe('hello');
  }
});

it('lets an archived session go once nobody watches it, whatever the count', async () => {
  // https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L318-L338
  const knobs: Knobs = { closes: [] };
  const { host, client, open } = await serving(knobs);
  const one = await open('one');
  const seen = await client.handle({ method: 'subscribe', params: { channel: one.chatUri } }) as { snapshot: { fromSeq: number } };
  await client.handle({
    method: 'dispatchAction',
    params: { channel: one.channel, clientSeq: 1, action: { type: 'session/isArchivedChanged', isArchived: true } },
  });
  await settle();
  // Watched, so held.
  expect(knobs.closes).toEqual([]);

  client.close();
  await until(() => knobs.closes.length > 0);
  // Opened again from its record when its client comes back, and replayed onto what that client holds.
  const back = host.accept(peer());
  const answer = await back.handle({
    method: 'reconnect',
    params: { clientId: 'window', lastSeenServerSeq: seen.snapshot.fromSeq, subscriptions: [one.chatUri] },
  });
  expect(answer).toMatchObject({ type: 'replay', missing: [] });
});

it('sleeps the least recently used quiet session over the count limit', async () => {
  const knobs: Knobs = { closes: [], closed: [] };
  const { time, open, awake, listed } = await serving(knobs, { sessionResidencyLimit: 2 });
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
  expect(knobs.closed).toEqual(['one']);
  // The oldest turn start went, and every one of them is still listed: asleep
  // is not disposed.
  const rows = await listed();
  expect(rows).toEqual(expect.arrayContaining([one.resource, two.resource, 'ahp-session:/three']));
  expect(rows).toHaveLength(3);
});

it('counts a subscribe as recent, so the session looked at last is not the one let go', async () => {
  // https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L11633-L11634
  const knobs: Knobs = { closes: [], closed: [] };
  const { client, open, awake } = await serving(knobs, { sessionResidencyLimit: 2 });
  const one = await open('one');
  await one.leave();
  const two = await open('two');
  await two.leave();
  // A look at the first: it is the more recent of the two now.
  await client.handle({ method: 'subscribe', params: { channel: one.channel } });
  await client.handle({ method: 'unsubscribe', params: { channel: one.channel } });

  await open('three');
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(2);
  expect(knobs.closed).toEqual(['two']);
});

it('sleeps an archived session at once', async () => {
  const knobs: Knobs = { closes: [] };
  const { client, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: one.channel, clientSeq: 1, action: { type: 'session/isArchivedChanged', isArchived: true } },
  });
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
});

/*
 * VS Code's host refuses an archive of a default chat without restoring the
 * session it is in.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12120-L12122
 */
it('wakes nothing for an archive of a sleeping session\'s default chat, and archives nothing', async () => {
  const knobs: Knobs = { closes: [] };
  const { client, time, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  time.pass(31);
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
  const starts = knobs.starts;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: one.chatUri, clientSeq: 1, action: { type: 'chat/isArchivedChanged', isArchived: true } },
  });
  await settle();
  expect(knobs.starts).toBe(starts);
  const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; status: number }[];
  };
  // `SessionStatus.IsArchived` is 64.
  expect((rows.items.find((row) => row.resource === one.resource)?.status ?? 0) & 64).toBe(0);
});

/*
 * VS Code's host takes a chat's read on a session it has not restored into
 * the session's record without restoring it, the session's read bit
 * following, and says the client's action.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12557-L12577
 */
it('marks a sleeping session\'s chat read and unread without waking it, and the session follows', async () => {
  const knobs: Knobs = { closes: [] };
  const { client, time, open, awake } = await serving(knobs);
  const one = await open('one');
  await one.leave();
  time.pass(31);
  await until(() => knobs.closes.length > 0);
  expect(awake()).toBe(0);
  const starts = knobs.starts;
  const status = async (): Promise<number> => ((await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as {
    items: { resource: string; status: number }[];
  }).items.find((row) => row.resource === one.resource)?.status ?? 0;
  for (const isRead of [false, true, false]) {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: one.chatUri, clientSeq: 1, action: { type: 'chat/isReadChanged', isRead } },
    });
    await settle();
    // `SessionStatus.IsRead` is 32.
    expect((await status()) & 32).toBe(isRead ? 32 : 0);
  }
  expect(knobs.starts).toBe(starts);
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

it('lists a sleeping session in the catalogue, and counts it among the sessions not disposed', async () => {
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
  const { time, open, awake } = await serving(knobs, { sleepAfterMinutes: 0, sessionResidencyLimit: 0 });
  const one = await open('one');
  await one.leave();
  await (await open('two')).leave();
  time.pass(24 * 60);
  await settle();
  expect(awake()).toBe(2);
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

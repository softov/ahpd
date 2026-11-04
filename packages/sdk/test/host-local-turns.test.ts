import { WAIT_MS } from '../../../tools/wait.ts';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Turn } from '@microsoft/agent-host-protocol';
import {
  resetSdk, actions, claude, createHost, echo, emit, hello, machine, peer, sdk, settle, wrote,
} from './support/host.js';
import { fileSessions } from '../src/sessions/sessions.js';
import { uriOf } from '../src/resources/resources.js';
import { chatUriFor } from '../src/host/channels.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { WireTurn } from '../src/types/wire.js';
import type { Agent, Bag, Listed, Session, Start } from '@ahpd/sdk';

/*
 * A `!` command's turn, kept for its chat.
 *
 * The host ran the command and no agent saw the turn, so no transcript holds
 * it. The host keeps it as a local turn in the session's folder, anchored to
 * the turn before it by the id that turn's transcript gives it, and every read
 * of a transcript puts it back after that turn - as the reference host keeps
 * and interleaves its local turns. A truncation or a fork at one goes to the
 * backend at the turn before it.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-local-turns-'));
  made.push(dir);
  return dir;
};

/** Where every case works: a real folder, because a shell starts in it. */
const DIR = tmpdir();

/** Every local turn a session's folder keeps, as the files hold them, in `seq` order. */
const keptIn = (store: SessionStore, id: string): Bag[] => {
  const folder = store.attachmentsDir?.(id);
  const turns = folder === undefined ? undefined : join(folder, 'turns');
  if (turns === undefined || !existsSync(turns)) return [];
  return readdirSync(turns, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(turns, name), 'utf8')) as Bag)
    .sort((a, b) => Number(a.seq) - Number(b.seq));
};

type Client = { handle(request: unknown): Promise<unknown> };

/** A channel's state, as a subscribe answers it. */
const stateOf = async (client: Client, channel: string): Promise<Bag> =>
  (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: Bag } }).snapshot.state;

/** The ids of a chat's turns, as a subscribe answers them. */
const turnsOf = async (client: Client, chat: string): Promise<string[]> =>
  ((await stateOf(client, chat)).turns as Bag[]).map((turn) => String(turn.id));

/** Wait until a chat has sent the end of a turn. */
const ended = async (p: ReturnType<typeof peer>, chat: string, turnId: string): Promise<void> => {
  const ends = new Set(['chat/turnComplete', 'chat/turnCancelled', 'chat/error']);
  for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
    if (actions(p, chat).some((e) => ends.has(String(e.action.type)) && e.action.turnId === turnId)) return;
    await new Promise((r) => { setTimeout(r, 25); });
  }
};

/** Send a message as a turn. */
const say = (client: Client, chat: string, turnId: string, text: string): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
  });
};

/** What a case sets on the backend, and reads back from it. */
interface Knobs {
  /** Every start the host handed it, in order. */
  starts: Start[];
  /** What a transcript read answers, by the conversation's id. */
  transcript?: (id: string) => Bag[] | undefined;
  /** What a listing answers, for a host that has not run the session. */
  listed?: Listed[];
  /** The conversations the backend deleted, for a backend that can delete. */
  deleted?: string[];
}

const knobs = (): Knobs => ({ starts: [] });

/**
 * The echo backend, with the points a cut asks for: each turn it ran ends at
 * `end:<turn>`, as a backend names where a turn ended.
 */
const backend = (k: Knobs): Agent => {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    chats: { fork: true },
    list: async () => (k.listed === undefined ? await base.list?.() ?? [] : [...k.listed]),
    ...(k.deleted === undefined ? {} : { delete: async (id: string) => { k.deleted?.push(id); } }),
    transcript: async (id, at) => {
      // A case's own answer is the answer, nothing included: a backend with no
      // conversation under an id answers nothing for it.
      if (k.transcript !== undefined) return k.transcript(id) as WireTurn<Turn>[] | undefined;
      return await base.transcript?.(id, at);
    },
    create: (start: Start): Session => {
      k.starts.push(start);
      const session = base.create(start.chatId === undefined ? start : { ...start, resume: start.chatId });
      // The echo backend's own array, which starts as the seed and which its
      // turns go into as they end.
      const all = (): Bag[] => session.allTurns() as Bag[];
      return {
        ...session,
        allTurns: all,
        endPoint: (turnId) => (all().some((turn) => turn.id === turnId) ? `end:${turnId}` : undefined),
        forkPoint: (turnId) => (all().some((turn) => turn.id === turnId) ? `end:${turnId}` : undefined),
      };
    },
  };
};

const LIVE = 'echo:/live';
const TWO = 'echo:/two';
const PEER = 'ahp-chat:/3f0c6a52-9a43-4d0e-a2b1-6b1f7c1d5e10';
const TAIL = 'ahp-chat:/tail';

/** One row, as a backend lists it. */
const row = (id: string): Listed => ({
  id,
  title: 'Earlier',
  createdAt: '2026-10-27T00:00:00.000Z',
  modifiedAt: '2026-10-27T09:00:00.000Z',
  workingDirectories: [uriOf(DIR)],
});

/** A host on a store, with a client watching the root. */
const hostAt = async (k: Knobs, store: SessionStore) => {
  const host = createHost({ path: DIR, agents: [backend(k)], ...machine(), sessions: store });
  const p = peer();
  p.request = async () => ({ trusted: true });
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  return { host, client, p };
};

/** A session with a chat a client watches, on a host at a store. */
const opened = async (k: Knobs, store: SessionStore) => {
  const at = await hostAt(k, store);
  await at.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
  const chat = String((await stateOf(at.client, LIVE)).defaultChat);
  await stateOf(at.client, chat);
  return { ...at, chat };
};

/** The start the host made for one chat, the latest of them. */
const startOf = (k: Knobs, chat: string): Start => {
  const start = k.starts.filter((one) => one.chatUri === chat).at(-1);
  if (start === undefined) throw new Error(`no start for ${chat}`);
  return start;
};

/** A turn as a transcript reads it back. */
const said = (id: string, text: string): Bag => ({
  id,
  message: { text, origin: { kind: 'user' } },
  state: 'complete',
  responseParts: [{ kind: 'markdown', id: `${id}:0`, content: text }],
});

describe('a command\'s turn', () => {
  it('is kept when it completes, against the turn before it', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client, p, chat } = await opened(k, store);
    say(client, chat, 't1', 'hello there');
    await ended(p, chat, 't1');
    say(client, chat, 't2', '!echo one');
    await ended(p, chat, 't2');
    say(client, chat, 't3', '!echo two');
    await ended(p, chat, 't3');

    const kept = keptIn(store, 'live');
    expect(kept.map((one) => ({ turnId: one.turnId, anchor: one.anchor, seq: one.seq }))).toEqual([
      { turnId: 't2', anchor: 't1', seq: 1 },
      { turnId: 't3', anchor: 't1', seq: 2 },
    ]);
    // The turn as the chat holds it.
    expect((kept[0]?.turn as Bag).message).toEqual({ text: '!echo one', origin: { kind: 'user' } });
    expect(kept[0]?.version).toBe(1);
  });

  it('is kept as its clients hold it', async () => {
    /*
     * The reference records a local turn from the state its clients were
     * served, so the turn a restart reads back is the turn they reduced.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L235-L247
     */
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client, p, chat } = await opened(k, store);
    say(client, chat, 't1', '!echo one');
    await ended(p, chat, 't1');
    const held = ((await stateOf(client, chat)).turns as Bag[]).find((turn) => turn.id === 't1');
    const kept = keptIn(store, 'live');
    expect((kept[0]?.turn as Bag).state).toBe('complete');
    expect(kept[0]?.turn).toEqual(held);
  });

  /*
   * Kept once its command has run, however its turn ended: a stop ends the
   * turn, and the command it ran is kept cancelled once it is over; a command
   * that exited with a code is a turn that completed. The reference records
   * the turn from its state once the command has run, whatever ended it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L201-L222
   */
  it('is kept when a stop cancels it, and complete when its command fails', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client, p, chat } = await opened(k, store);
    say(client, chat, 't1', '!sleep 0.3');
    for (const until = Date.now() + WAIT_MS; Date.now() < until && !actions(p, chat).some((e) => e.action.type === 'chat/toolCallStart');) {
      await new Promise((r) => { setTimeout(r, 10); });
    }
    await client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } } });
    for (const until = Date.now() + WAIT_MS; Date.now() < until && keptIn(store, 'live').length === 0;) {
      await new Promise((r) => { setTimeout(r, 25); });
    }
    say(client, chat, 't2', '!exit 3');
    await ended(p, chat, 't2');
    expect(keptIn(store, 'live').map((one) => [one.turnId, (one.turn as Bag).state])).toEqual([['t1', 'cancelled'], ['t2', 'complete']]);
  });

  it('has no anchor before every other turn, and a question\'s turn is not kept', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client, p, chat } = await opened(k, store);
    say(client, chat, 't1', '!echo first');
    await ended(p, chat, 't1');
    say(client, chat, 't2', 'a question');
    await ended(p, chat, 't2');
    const kept = keptIn(store, 'live');
    expect(kept.map((one) => one.turnId)).toEqual(['t1']);
    expect('anchor' in (kept[0] ?? {})).toBe(false);
  });

});

describe('a host started again on the same store', () => {
  /** A first host that ran some turns, closed; and a second on the same store. */
  const restarted = async (script: (client: Client, p: ReturnType<typeof peer>, chat: string) => Promise<void>, transcript: Bag[]) => {
    const dir = join(temp(), 'sessions');
    const first = knobs();
    const before = await opened(first, fileSessions({ dir }));
    await script(before.client, before.p, before.chat);
    await before.host.close();
    const second = knobs();
    second.listed = [row('live')];
    second.transcript = (id) => (id === 'live' ? transcript : []);
    const after = await hostAt(second, fileSessions({ dir }));
    return { ...after, chat: before.chat, k: second };
  };

  it('puts each command\'s turn back after the turn it followed, the unanchored first, in the order kept', async () => {
    const { client, host, chat } = await restarted(async (c, p, ch) => {
      say(c, ch, 't0', '!echo before everything');
      await ended(p, ch, 't0');
      say(c, ch, 't1', 'hello there');
      await ended(p, ch, 't1');
      say(c, ch, 't2', '!echo one');
      await ended(p, ch, 't2');
      say(c, ch, 't3', '!echo two');
      await ended(p, ch, 't3');
      say(c, ch, 't4', 'and then');
      await ended(p, ch, 't4');
    }, [said('t1', 'hello there'), said('t4', 'and then')]);
    expect(await turnsOf(client, chat)).toEqual(['t0', 't1', 't2', 't3', 't4']);
    await host.close();
  });

  it('reads a turn the chat never began back inside the turn before it, and a chat with no record as it is', async () => {
    const held = [said('t1', 'hello there'), said('x1', 'written as its own'), said('t2', 'and then')];
    const ran = await restarted(async (c, p, ch) => {
      say(c, ch, 't1', 'hello there');
      await ended(p, ch, 't1');
      say(c, ch, 't2', 'and then');
      await ended(p, ch, 't2');
    }, held);
    const turns = (await stateOf(ran.client, ran.chat)).turns as Bag[];
    expect(turns.map((turn) => turn.id)).toEqual(['t1', 't2']);
    // Its message stays, quoted before its answer, as a steer's does.
    expect((turns[0]?.responseParts as Bag[]).map((part) => part.content)).toEqual(['hello there', '> written as its own', 'written as its own']);
    await ran.host.close();

    const never = await restarted(async () => {}, held);
    expect(await turnsOf(never.client, never.chat)).toEqual(['t1', 'x1', 't2']);
    await never.host.close();
  });

  it('drops a command\'s turn whose anchor the transcript no longer holds', async () => {
    const { client, host, chat } = await restarted(async (c, p, ch) => {
      for (const [turnId, text] of [['t1', 'hello there'], ['t2', '!echo kept'], ['t3', 'gone since'], ['t4', '!echo orphan']] as const) {
        say(c, ch, turnId, text);
        await ended(p, ch, turnId);
      }
    }, [said('t1', 'hello there')]);
    expect(await turnsOf(client, chat)).toEqual(['t1', 't2']);
    await host.close();
  });

  it('keeps a command\'s turn the transcript holds where it is, once, and the next after it', async () => {
    // An ACP record holds the seed it was resumed with, local turns and all.
    const { client, host, chat } = await restarted(async (c, p, ch) => {
      for (const [turnId, text] of [['t1', 'hello there'], ['t2', '!echo held'], ['t3', '!echo after']] as const) {
        say(c, ch, turnId, text);
        await ended(p, ch, turnId);
      }
    }, [said('t1', 'hello there'), said('t2', '!echo held')]);
    expect(await turnsOf(client, chat)).toEqual(['t1', 't2', 't3']);
    await host.close();
  });

  it('seeds a woken chat with its command\'s turn', async () => {
    const { client, host, chat, k } = await restarted(async (c, p, ch) => {
      say(c, ch, 't1', 'hello there');
      await ended(p, ch, 't1');
      say(c, ch, 't2', '!echo seeded');
      await ended(p, ch, 't2');
    }, [said('t1', 'hello there')]);
    await stateOf(client, chat);
    say(client, chat, 't3', 'wake up');
    for (let i = 0; i < 200 && k.starts.length === 0; i += 1) await settle(1);
    expect(((startOf(k, chat).seed ?? []) as Bag[]).map((turn) => turn.id)).toEqual(['t1', 't2']);
    await host.close();
  });

  it('reads a peer chat\'s command\'s turns from that chat', async () => {
    const dir = join(temp(), 'sessions');
    const first = knobs();
    const before = await opened(first, fileSessions({ dir }));
    await before.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await settle();
    await stateOf(before.client, PEER);
    say(before.client, PEER, 'p1', 'in the peer');
    await ended(before.p, PEER, 'p1');
    say(before.client, PEER, 'p2', '!echo peer command');
    await ended(before.p, PEER, 'p2');
    await before.host.close();

    const second = knobs();
    second.listed = [row('live')];
    const peerId = PEER.slice('ahp-chat:/'.length);
    second.transcript = (id) => (id === peerId ? [said('p1', 'in the peer')] : []);
    const after = await hostAt(second, fileSessions({ dir }));
    expect(await turnsOf(after.client, PEER)).toEqual(['p1', 'p2']);
    await after.host.close();
  });
});

describe('a cut at a command\'s turn', () => {
  /** A chat with a question, a command after it and a question after that. */
  const cut = async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const at = await opened(k, store);
    for (const [turnId, text] of [['t1', 'hello there'], ['t2', '!echo between'], ['t3', 'and then']] as const) {
      say(at.client, at.chat, turnId, text);
      await ended(at.p, at.chat, turnId);
    }
    return { ...at, k, store };
  };

  it('rewinds the backend at the turn before it, and keeps the command\'s turn', async () => {
    const { client, chat, k, store } = await cut();
    void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/truncated', turnId: 't2' } } });
    await settle(10);
    const start = startOf(k, chat);
    expect(start.rewindAt).toBe('end:t1');
    expect(((start.seed ?? []) as Bag[]).map((turn) => turn.id)).toEqual(['t1', 't2']);
    expect(keptIn(store, 'live').map((one) => one.turnId)).toEqual(['t2']);
  });

  it('drops the command\'s turn and its file with a cut before it', async () => {
    const { client, p, chat, store } = await cut();
    expect(keptIn(store, 'live').map((one) => one.turnId)).toEqual(['t2']);
    void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/truncated', turnId: 't1' } } });
    await settle(10);
    expect(actions(p, chat).some((e) => e.action.type === 'chat/truncated')).toBe(true);
    expect(keptIn(store, 'live')).toEqual([]);
  });

  it('is refused at a command\'s turn with no turn before it', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client, p, chat } = await opened(k, store);
    say(client, chat, 't1', '!echo alone');
    await ended(p, chat, 't1');
    const starts = k.starts.length;
    void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/truncated', turnId: 't1' } } });
    await settle(10);
    // Refused as a clear of the whole conversation, which it would be for the
    // backend, and nothing restarted.
    expect(actions(p).filter((e) => e.rejectionReason !== undefined).at(-1)?.rejectionReason).toContain('not a conversation entire');
    expect(k.starts.length).toBe(starts);
  });

  it('starts over at a command\'s turn with no turn before it, and keeps the command\'s turn', async () => {
    const k = { ...knobs(), deleted: [] as string[] };
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client, p, chat } = await opened(k, store);
    say(client, chat, 't1', '!echo alone');
    await ended(p, chat, 't1');
    say(client, chat, 't2', '!echo after');
    await ended(p, chat, 't2');
    void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/truncated', turnId: 't1' } } });
    await settle(30);
    // The backend saw no turn before it, so its conversation goes whole, as the
    // reference truncates with no turn when a local turn has no anchor; the
    // chat keeps the command's turn, which the host holds.
    expect(actions(p).filter((e) => e.rejectionReason !== undefined)).toEqual([]);
    expect(k.deleted).toEqual(['live']);
    const start = startOf(k, chat);
    expect(start.resume).toBeUndefined();
    expect(((start.seed ?? []) as Bag[]).map((turn) => turn.id)).toEqual(['t1']);
    expect(await turnsOf(client, chat)).toEqual(['t1']);
    expect(keptIn(store, 'live').map((one) => one.turnId)).toEqual(['t1']);
  });

  it('forks the backend at the turn before it, and the fork keeps the command\'s turn', async () => {
    const { client, chat, k, store } = await cut();
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: TAIL, source: { kind: 'fork', chat, turnId: 't2' } } });
    await settle();
    const start = startOf(k, TAIL);
    expect(start.forkAt).toBe('end:t1');
    expect(((start.seed ?? []) as Bag[]).map((turn) => turn.id)).toEqual(['t1', 't2']);
    // Kept for both chats now, each under its own.
    expect(keptIn(store, 'live').map((one) => one.turnId)).toEqual(['t2', 't2']);
  });
});

describe('a chat\'s command\'s turns', () => {
  it('go with the chat when a client disposes it', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client, p } = await opened(k, store);
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await settle();
    await stateOf(client, PEER);
    say(client, PEER, 'p1', '!echo in the peer');
    await ended(p, PEER, 'p1');
    expect(keptIn(store, 'live')).toHaveLength(1);
    await client.handle({ method: 'disposeChat', params: { channel: PEER } });
    expect(keptIn(store, 'live')).toEqual([]);
  });

  it('move with the chat to another session', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client, p } = await hostAt(k, store);
    for (const [session, chat] of [[LIVE, PEER], [TWO, TAIL]] as const) {
      await client.handle({ method: 'createSession', params: { channel: session, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
      await client.handle({ method: 'createChat', params: { channel: session, chat } });
    }
    await settle();
    await stateOf(client, PEER);
    say(client, PEER, 'p1', '!echo moving');
    await ended(p, PEER, 'p1');
    await client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'session', session: TWO } } });
    await settle(20);
    expect(keptIn(store, 'live')).toEqual([]);
    expect(keptIn(store, 'two').map((one) => one.turnId)).toEqual(['p1']);
  });
});

describe('a session that ran only commands', () => {
  /**
   * A first host that ran `texts` as turns and closed, and a second on the same
   * store where no backend lists the session or holds a conversation for it.
   */
  const reopened = async (texts: string[]) => {
    const dir = join(temp(), 'sessions');
    const before = await opened(knobs(), fileSessions({ dir }));
    for (const [index, text] of texts.entries()) {
      const turnId = `t${String(index + 1)}`;
      say(before.client, before.chat, turnId, text);
      await ended(before.p, before.chat, turnId);
    }
    await before.host.close();
    const second = knobs();
    second.listed = [];
    second.transcript = () => undefined;
    const store = fileSessions({ dir });
    const after = await hostAt(second, store);
    return { ...after, chat: before.chat, k: second, store };
  };
  /** The rows a listing answers. */
  const listed = async (client: Client): Promise<Bag[]> =>
    ((await client.handle({ method: 'listSessions', params: {} })) as { items: Bag[] }).items;

  it('is listed after a restart from the turns the host kept, by every listing', async () => {
    const { client, host, store } = await reopened(['!echo first', '!echo second']);
    const row = (await listed(client)).find((one) => one.resource === LIVE);
    const kept = keptIn(store, 'live').map((one) => one.turn as Bag);
    expect(row).toMatchObject({ title: '!echo first', createdAt: kept[0]?.startedAt });
    expect(Date.parse(String(row?.modifiedAt))).toBeGreaterThanOrEqual(Date.parse(String(kept[1]?.startedAt)));
    // The prune of the first listing is what lost such a session: a second one still holds it.
    expect((await listed(client)).map((one) => one.resource)).toContain(LIVE);
    expect(keptIn(store, 'live').map((one) => one.turnId)).toEqual(['t1', 't2']);
    await host.close();
  });

  it('opens with its commands\' turns, and a turn sent after the restart runs after them', async () => {
    const { client, host, p, chat } = await reopened(['!echo first']);
    await listed(client);
    expect(await turnsOf(client, chat)).toEqual(['t1']);
    say(client, chat, 't2', 'hello again');
    await ended(p, chat, 't2');
    expect(await turnsOf(client, chat)).toEqual(['t1', 't2']);
    await host.close();
  });

  it('is pruned after a restart when it ran nothing at all', async () => {
    const { client, host } = await reopened([]);
    await listed(client);
    expect((await listed(client)).map((one) => one.resource)).not.toContain(LIVE);
    await host.close();
  });
});

describe('a Claude chat', () => {
  /** A Claude session on a store that keeps a folder, with its chat watched. */
  const shelled = async (dir: string) => {
    const store = fileSessions({ dir });
    const host = createHost({ path: DIR, agents: [claude({ paths: [DIR] })], ...machine(), sessions: store });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    return { host, client, p, store };
  };

  /** One of agent-claude's captures of the real CLI, or what the SDK's reader returned for its session. */
  const capture = (name: string): Bag[] => readFileSync(new URL(`../../agent-claude/test/fixtures/${name}`, import.meta.url), 'utf8')
    .split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Bag);
  /** A capture's frames up to the first one `at` holds for, and the rest. */
  const upTo = (frames: Bag[], at: (frame: Bag) => boolean): [Bag[], Bag[]] => {
    const cut = frames.findIndex(at) + 1;
    return [frames.slice(0, cut), frames.slice(cut)];
  };
  /** A steering message a client sends into the turn that is running. */
  const steer = async (client: Client, chat: string, id: string, text: string): Promise<void> => {
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/pendingMessageSet', kind: 'steering', id, message: { text, origin: { kind: 'user' } } } },
    });
    await settle();
  };
  /** What a client shows of each turn: its id, how it ended, the message it answers and its prose. */
  const shown = (turns: Bag[]): unknown[][] => turns.map((turn) => [
    turn.id,
    turn.state,
    (turn.message as Bag).text,
    (turn.responseParts as Bag[]).filter((part) => part.kind === 'markdown').map((part) => part.content),
  ]);
  /** A session of the captured CLI session's id, with its chat watched, on a host at `dir`. */
  const sessionOf = async (dir: string, session: string) => {
    const at = await shelled(dir);
    const uri = `claude:/${session}`;
    await at.client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(DIR)] } });
    const chat = String((await stateOf(at.client, uri)).defaultChat);
    await stateOf(at.client, chat);
    return { ...at, uri, chat };
  };
  /** The same session read back by a host started again on the store at `dir`, its CLI having written `transcript`. */
  const readAgain = async (dir: string, session: string, summary: string, transcript: Bag[]): Promise<unknown[][]> => {
    sdk.sessions.push({ sessionId: session, summary, lastModified: 1, cwd: DIR });
    sdk.transcript.push(...transcript);
    const after = await shelled(dir);
    await stateOf(after.client, `claude:/${session}`);
    const read = shown((await stateOf(after.client, chatUriFor(`claude:/${session}`))).turns as Bag[]);
    await after.host.close();
    return read;
  };

  it('anchors a command\'s turn to the uuid the turn before it was written under, and has it back after a restart', async () => {
    const dir = join(temp(), 'sessions');
    const before = await shelled(dir);
    const uri = 'claude:/banged';
    await before.client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(DIR)] } });
    const chat = String((await stateOf(before.client, uri)).defaultChat);
    expect(chat).toBe(chatUriFor(uri));
    await stateOf(before.client, chat);
    say(before.client, chat, 't1', 'first');
    await settle();
    // The prompt as the CLI took it in: the uuid it carried is the one its
    // transcript writes it under, and nothing is echoed back.
    expect(sdk.said).toEqual(['first']);
    const written = String(sdk.uuids[0]);
    expect(written).not.toBe('t1');
    await emit({ type: 'assistant', uuid: 'reply-1', message: { id: 'm1', content: [{ type: 'text', text: 'one' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    await ended(before.p, chat, 't1');
    say(before.client, chat, 't2', '!echo after-the-reply');
    await ended(before.p, chat, 't2');
    expect(keptIn(before.store, 'banged').map((one) => ({ turnId: one.turnId, anchor: one.anchor }))).toEqual([
      { turnId: 't2', anchor: written },
    ]);
    const terminal = String((((keptIn(before.store, 'banged')[0]?.turn as Bag).responseParts as Bag[])
      .map((part) => part.toolCall as Bag)[0]?.content as Bag[]).find((one) => one.type === 'terminal')?.resource);
    await before.host.close();

    // The CLI's transcript holds the question under the uuid its prompt
    // carried, and the answer under one of the CLI's own.
    sdk.sessions.push({ sessionId: 'banged', summary: 'first', lastModified: 1, cwd: DIR });
    sdk.transcript.push(
      { type: 'user', uuid: written, message: { role: 'user', content: 'first' } },
      { type: 'assistant', uuid: 'reply-1', message: { content: [{ type: 'text', text: 'one' }] } },
    );
    const after = await shelled(dir);
    await stateOf(after.client, uri);
    expect(await turnsOf(after.client, chat)).toEqual([written, 't2']);
    // And the terminal the command's call names opens, exited, with its output.
    const rebuilt = await stateOf(after.client, terminal);
    expect(rebuilt.content).toEqual([{ type: 'unclassified', value: expect.stringContaining('after-the-reply') }]);
    expect(rebuilt.lifecycle).toEqual({ status: 'exited', exitCode: 0 });
    await after.host.close();
  });

  /*
   * A command that failed is a call that failed, in a turn that completed: the
   * action says so, and the record a restart reads says what the action said.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L201-L213
   */
  it('keeps a failed command\'s turn complete, as its clients held it, and has it back so after a restart', async () => {
    const dir = join(temp(), 'sessions');
    const before = await shelled(dir);
    const uri = 'claude:/failing';
    await before.client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(DIR)] } });
    const chat = String((await stateOf(before.client, uri)).defaultChat);
    await stateOf(before.client, chat);
    say(before.client, chat, 't1', '!exit 3');
    await ended(before.p, chat, 't1');
    const held = ((await stateOf(before.client, chat)).turns as Bag[]).find((turn) => turn.id === 't1');
    expect(held?.state).toBe('complete');
    expect((keptIn(before.store, 'failing')[0]?.turn as Bag | undefined)?.state).toBe('complete');
    await before.host.close();

    sdk.sessions.push({ sessionId: 'failing', summary: '!exit 3', lastModified: 1, cwd: DIR });
    const after = await shelled(dir);
    await stateOf(after.client, uri);
    const read = ((await stateOf(after.client, chat)).turns as Bag[]).find((turn) => turn.id === 't1');
    expect(read?.state).toBe('complete');
    await after.host.close();
  });

  it('has a steering message the CLI answered after the turn\'s last answer back inside that turn after a restart', async () => {
    const dir = join(temp(), 'sessions');
    const before = await shelled(dir);
    const uri = 'claude:/steered';
    await before.client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(DIR)] } });
    const chat = String((await stateOf(before.client, uri)).defaultChat);
    await stateOf(before.client, chat);
    say(before.client, chat, 't1', 'first');
    await settle();
    await before.client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'and then', origin: { kind: 'user' } } } },
    });
    await settle();
    const [prompt, steer] = sdk.uuids.map(String);
    // The CLI answers the prompt and ends that exchange, then runs the
    // steering message as an exchange of its own: the turn ends after both.
    await emit(
      { type: 'assistant', uuid: 'reply-1', user_message_uuid: prompt, message: { id: 'm1', content: [{ type: 'text', text: 'one' }] } },
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, user_message_uuids: [prompt] },
      { type: 'assistant', uuid: 'reply-2', user_message_uuid: steer, message: { id: 'm2', content: [{ type: 'text', text: 'two' }] } },
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, user_message_uuids: [steer] },
    );
    await ended(before.p, chat, 't1');
    await before.host.close();

    // The CLI's transcript holds the steering message as a prompt of its own.
    sdk.sessions.push({ sessionId: 'steered', summary: 'first', lastModified: 1, cwd: DIR });
    sdk.transcript.push(
      { type: 'user', uuid: prompt, message: { role: 'user', content: 'first' } },
      { type: 'assistant', uuid: 'reply-1', message: { content: [{ type: 'text', text: 'one' }] } },
      { type: 'user', uuid: steer, message: { role: 'user', content: 'and then' } },
      { type: 'assistant', uuid: 'reply-2', message: { content: [{ type: 'text', text: 'two' }] } },
    );
    const after = await shelled(dir);
    await stateOf(after.client, uri);
    const turns = (await stateOf(after.client, chat)).turns as Bag[];
    expect(turns.map((turn) => turn.id)).toEqual([prompt]);
    expect((turns[0]?.responseParts as Bag[]).filter((part) => part.kind === 'markdown').map((part) => part.content)).toEqual(['one', '> and then', 'two']);
    await after.host.close();

    // A store that kept no record of the chat reads it as its transcript gives
    // it, under the name a host with no record lists the session by.
    const elsewhere = await shelled(join(temp(), 'sessions'));
    await stateOf(elsewhere.client, 'ahp-session:/steered');
    expect(await turnsOf(elsewhere.client, chatUriFor('ahp-session:/steered'))).toEqual([prompt, steer]);
    await elsewhere.host.close();
  });

  it('reads a chat back after a restart as a client saw it live, from captures of the real CLI', async () => {
    // agent-claude's captures of one session of the real CLI, and what the
    // SDK's reader returned for it: a steering message the CLI ran after the
    // turn's last answer, and one it took in at a tool call.
    const SESSION = 'ae01151f-233d-4c04-901b-2e01f3afb037';
    const FIRST = '9975eb65-d506-4ab4-a8e6-6b318497c4e1';
    const LATE = '46569a15-a821-8da6-9ea4-802e84d5af14';
    const TOOL = '34c360d4-3f3a-4633-8f85-551354bb6668';
    const FOLDED = '7e5694fd-eb5f-8b42-88a6-5eb2f7464e74';
    const ALPHA = 'Reply with exactly the word ALPHA and nothing else.';
    const SLEEP = 'Run the shell command `sleep 4` with the Bash tool, then reply with exactly the word DONE.';
    const dir = join(temp(), 'sessions');
    const before = await sessionOf(dir, SESSION);
    const { chat } = before;
    const [alpha, late] = upTo(capture('claude-late-steer.jsonl'), (frame) => frame.type === 'stream_event'
      && (frame.event as Bag).type === 'content_block_delta');
    say(before.client, chat, FIRST, ALPHA);
    await settle();
    await emit(...alpha);
    await steer(before.client, chat, LATE, 'Reply with exactly the word BETA and nothing else.');
    await emit(...late);
    await ended(before.p, chat, FIRST);
    const [sleeping, folded] = upTo(capture('claude-folded-steer.jsonl'), (frame) => frame.type === 'assistant'
      && ((frame.message as Bag).content as Bag[]).some((block) => block.type === 'tool_use'));
    say(before.client, chat, TOOL, SLEEP);
    await settle();
    await emit(...sleeping);
    await steer(before.client, chat, FOLDED, 'Also, at the very end of your reply, add the word BETA2.');
    await emit(...folded);
    await ended(before.p, chat, TOOL);
    expect(sdk.uuids).toEqual([FIRST, LATE, TOOL, FOLDED]);
    const live = shown((await stateOf(before.client, chat)).turns as Bag[]);
    // Each steer shows quoted in the turn it went into, before its answer.
    expect(live).toEqual([
      [FIRST, 'complete', ALPHA, ['ALPHA', '> Reply with exactly the word BETA and nothing else.', 'BETA']],
      [TOOL, 'complete', SLEEP, ['> Also, at the very end of your reply, add the word BETA2.', 'DONE BETA2']],
    ]);
    await before.host.close();
    expect(await readAgain(dir, SESSION, ALPHA, capture('claude-steered-transcript.jsonl'))).toEqual(live);
  });

  it('reads a steering message answered after a failed turn back as the turn of its own it was live', async () => {
    // The session of agent-claude's capture of a turn that failed at its turn
    // limit with a steering message queued, which the CLI then answered.
    const SESSION = '2b965eb7-14a6-40b2-a9fa-f65ed1c95121';
    const LIMITED = '0bbc4aff-8f2b-4536-a33a-8d0587e38461';
    const STEERED = 'efe5b13b-5b99-8a8e-88c6-aec14eb8e451';
    const SLEEP = 'Run the shell command `sleep 3` with the Bash tool, then reply with exactly the word DONE.';
    const dir = join(temp(), 'sessions');
    const before = await sessionOf(dir, SESSION);
    const { chat } = before;
    // The probe sent the message as the tool's result arrived, which was the turn's last round.
    const [first, rest] = upTo(capture('claude-failed-steer.jsonl'), (frame) => frame.type === 'user');
    say(before.client, chat, LIMITED, SLEEP);
    await settle();
    await emit(...first);
    await steer(before.client, chat, STEERED, 'Reply with exactly the word BETA and nothing else.');
    await emit(...rest);
    await ended(before.p, chat, STEERED);
    const live = shown((await stateOf(before.client, chat)).turns as Bag[]);
    expect(live).toEqual([
      [LIMITED, 'error', SLEEP, []],
      [STEERED, 'complete', 'Reply with exactly the word BETA and nothing else.', ['BETA']],
    ]);
    await before.host.close();

    // Its turn began, so the record holds it and it is not read back inside the
    // failed one. The transcript says nothing of the failure, so the failed
    // turn reads back as the turn a read gives every finished one.
    const read = await readAgain(dir, SESSION, SLEEP, capture('claude-failed-steer-transcript.jsonl'));
    const asked = (turns: unknown[][]): unknown[] => turns.map(([id, , text, prose]) => [id, text, prose]);
    expect(asked(read)).toEqual(asked(live));
  });

  it('forks a session asleep since a restart at a command\'s turn, where the Claude turn read back before it ended', async () => {
    const dir = join(temp(), 'sessions');
    const before = await shelled(dir);
    const uri = 'claude:/forked';
    await before.client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(DIR)] } });
    const chat = String((await stateOf(before.client, uri)).defaultChat);
    await stateOf(before.client, chat);
    say(before.client, chat, 't1', 'first');
    await settle();
    const written = String(sdk.uuids[0]);
    await emit({ type: 'assistant', uuid: 'reply-1', message: { id: 'm1', content: [{ type: 'text', text: 'one' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    await ended(before.p, chat, 't1');
    say(before.client, chat, 't2', '!echo after-the-reply');
    await ended(before.p, chat, 't2');
    await before.host.close();

    sdk.sessions.push({ sessionId: 'forked', summary: 'first', lastModified: 1, cwd: DIR });
    sdk.transcript.push(
      { type: 'user', uuid: written, message: { role: 'user', content: 'first' } },
      { type: 'assistant', uuid: 'reply-1', message: { content: [{ type: 'text', text: 'one' }] } },
    );
    wrote('forked', DIR);
    const after = await shelled(dir);
    await stateOf(after.client, uri);
    // Nothing has woken it: the fork does, and the turn read back names where it ended.
    await after.client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/forked-copy', source: { kind: 'fork', chat, turnId: 't2' } },
    });
    const forked = sdk.queries.find((one) => one.options.forkSession === true);
    expect(forked?.options).toMatchObject({ resume: 'forked', forkSession: true, resumeSessionAt: 'reply-1' });
    await after.host.close();
  });
});

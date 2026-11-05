import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { createLocalTurns } from '../src/host/localturns.js';
import { steerOf } from '../src/sessions/steer.js';
import type { HostContext } from '../src/host/context.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { Agent, Bag } from '@ahpd/sdk';

/*
 * The area that keeps a chat's local turns, alone: where a file goes, what a
 * read skips, the turn a cut goes to and the name an anchor is written under.
 * `host-local-turns.test.ts` drives the same area through a host.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const LIVE = 'echo:/live';
const PEER = 'ahp-chat:/3f0c6a52-9a43-4d0e-a2b1-6b1f7c1d5e10';
const TAIL = 'ahp-chat:/tail';

/** The area alone, on a store with a folder. */
const area = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-localturns-'));
  made.push(dir);
  const store = fileSessions({ dir: join(dir, 'sessions') });
  return { store, turns: createLocalTurns({ kept: store, log: () => {}, outputsFor: () => undefined } as unknown as HostContext) };
};

/** A backend whose transcript reads back as `turns`. */
const reading = (turns: Bag[]): Agent => ({ transcript: async () => structuredClone(turns) }) as unknown as Agent;

/** What a session's folder records for one chat: the turn each transcript id began, by transcript id. */
const recordIn = (store: SessionStore, id: string, chat: string): Record<string, string> => {
  const folder = store.attachmentsDir?.(id);
  const recorded = folder === undefined ? undefined : join(folder, 'recorded', createHash('sha256').update(chat, 'utf8').digest('hex'));
  if (recorded === undefined || !existsSync(recorded)) return {};
  return Object.fromEntries(readdirSync(recorded)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(recorded, name), 'utf8')) as Bag)
    .map((one) => [String(one.transcriptId), String(one.turnId)]));
};

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

/** A turn as a chat holds it. */
const said = (id: string, text: string): Bag => ({
  id,
  message: { text, origin: { kind: 'user' } },
  state: 'complete',
  responseParts: [{ kind: 'markdown', id: `${id}:0`, content: text }],
});

describe('the local turns of a chat', () => {
  it('skips a file another version wrote, and one whose turn a client could not read', () => {
    const { store, turns } = area();
    const all = [said('t1', 'hello'), said('t2', '!echo kept'), said('t3', '!echo broken'), said('t4', '!echo old')];
    for (const at of [2, 3, 4]) turns.keepLocalTurn(LIVE, PEER, all.slice(0, at), String(all[at - 1]?.id));
    const folder = join(String(store.attachmentsDir?.('live')), 'turns');
    for (const name of readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter((one) => one.endsWith('.json'))) {
      const path = join(folder, name);
      const held = JSON.parse(readFileSync(path, 'utf8')) as Bag;
      if (held.turnId === 't3') writeFileSync(path, JSON.stringify({ ...held, turn: { ...(held.turn as Bag), state: undefined } }));
      if (held.turnId === 't4') writeFileSync(path, JSON.stringify({ ...held, version: 2 }));
    }
    expect(turns.withLocalTurns(LIVE, PEER, [said('t1', 'hello')]).map((turn) => turn.id)).toEqual(['t1', 't2']);
  });

  it('answers the turn a cut goes to: itself, or the nearest earlier one of the backend\'s', () => {
    const { turns } = area();
    const all = [said('t1', 'hello'), said('t2', '!echo one'), said('t3', '!echo two')];
    turns.keepLocalTurn(LIVE, PEER, all.slice(0, 2), 't2');
    turns.keepLocalTurn(LIVE, PEER, all, 't3');
    expect(turns.concreteTurnOf(LIVE, PEER, all, 0)).toBe('t1');
    expect(turns.concreteTurnOf(LIVE, PEER, all, 2)).toBe('t1');
    const alone = [said('t9', '!echo alone')];
    turns.keepLocalTurn(LIVE, TAIL, alone, 't9');
    expect(turns.concreteTurnOf(LIVE, TAIL, alone, 0)).toBeUndefined();
  });

  it('keeps nothing on a store that keeps no folder', () => {
    const turns = createLocalTurns({ kept: memorySessions(), log: () => {} } as unknown as HostContext);
    const all = [said('t1', 'hello'), said('t2', '!echo nowhere')];
    turns.keepLocalTurn(LIVE, PEER, all, 't2');
    expect(turns.withLocalTurns(LIVE, PEER, [said('t1', 'hello')]).map((turn) => turn.id)).toEqual(['t1']);
    expect(turns.concreteTurnOf(LIVE, PEER, all, 1)).toBe('t2');
  });

  it('names an anchor by the transcript id its backend gave it, and a fork carries the name', () => {
    const { store, turns } = area();
    turns.turnRecordedAs(LIVE, PEER, 't1', 'cli-uuid-1');
    turns.keepLocalTurn(LIVE, PEER, [said('t1', 'hello'), said('t2', '!echo kept')], 't2');
    expect(keptIn(store, 'live').map((one) => one.anchor)).toEqual(['cli-uuid-1']);
    turns.copyLocalTurns(LIVE, PEER, TAIL, [said('t1', 'hello'), said('t2', '!echo kept')]);
    turns.keepLocalTurn(LIVE, TAIL, [said('t1', 'hello'), said('t2', '!echo kept'), said('t5', 'more'), said('t6', '!echo late')], 't6');
    expect(keptIn(store, 'live').map((one) => one.anchor)).toEqual(['cli-uuid-1', 'cli-uuid-1', 't5']);
    const later = [said('t1', 'hello'), said('t2', '!echo kept'), said('t7', '!echo after the copy')];
    turns.keepLocalTurn(LIVE, TAIL, later, 't7');
    expect(keptIn(store, 'live').at(-1)?.anchor).toBe('cli-uuid-1');
  });
});

describe('the turns a chat began', () => {
  /** A chat's turns as a read gives them, from a backend whose transcript holds `held`. */
  const read = async (turns: ReturnType<typeof createLocalTurns>, held: Bag[], chat = PEER): Promise<Bag[]> =>
    (await turns.transcriptOf(reading(held), 'live', undefined, LIVE, chat) ?? []) as unknown as Bag[];
  const ids = (turns: Bag[]): unknown[] => turns.map((turn) => turn.id);
  const prose = (turn: Bag | undefined): unknown[] => ((turn?.responseParts ?? []) as Bag[])
    .map((part) => (steerOf(part) === undefined ? part.content : `steer: ${String(part.content)}`));

  it('reads a turn the chat never began back inside the turn before it', async () => {
    const { turns } = area();
    turns.turnRecordedAs(LIVE, PEER, 't1', 't1');
    turns.turnRecordedAs(LIVE, PEER, 't2', 't2');
    const back = await read(turns, [said('t1', 'asked'), said('s1', 'and also'), said('t2', 'next')]);
    expect(ids(back)).toEqual(['t1', 't2']);
    expect((back[0]?.message as Bag).text).toBe('asked');
    expect(prose(back[0])).toEqual(['asked', 'steer: and also', 'and also']);
  });

  it('reads a turn written again under a new id back as the turn it began as', async () => {
    const { turns } = area();
    turns.turnRecordedAs(LIVE, PEER, 't1', 'first-try');
    turns.turnRecordedAs(LIVE, PEER, 't1', 'second-try');
    const back = await read(turns, [said('first-try', 'asked'), said('second-try', 'asked')]);
    expect(ids(back)).toEqual(['first-try']);
    expect(prose(back[0])).toEqual(['asked', 'asked']);
  });

  it('leaves the turns a chat had before it kept a record as they are', async () => {
    const { turns } = area();
    turns.turnRecordedAs(LIVE, PEER, 't3', 't3');
    const back = await read(turns, [said('t1', 'old'), said('s1', 'old steer'), said('t3', 'new'), said('s2', 'new steer')]);
    expect(ids(back)).toEqual(['t1', 's1', 't3']);
    expect(prose(back[2])).toEqual(['new', 'steer: new steer', 'new steer']);
  });

  it('folds nothing for a chat with no record, nor on a store that keeps no folder', async () => {
    const held = [said('t1', 'asked'), said('s1', 'and also')];
    const { turns } = area();
    turns.turnRecordedAs(LIVE, TAIL, 't1', 't1');
    expect(ids(await read(turns, held))).toEqual(['t1', 's1']);
    const nowhere = createLocalTurns({ kept: memorySessions(), log: () => {}, outputsFor: () => undefined } as unknown as HostContext);
    nowhere.turnRecordedAs(LIVE, PEER, 't1', 't1');
    expect(ids(await read(nowhere, held))).toEqual(['t1', 's1']);
  });

  it('keeps a local turn the transcript holds as a turn of its own', async () => {
    const { turns } = area();
    turns.turnRecordedAs(LIVE, PEER, 't1', 't1');
    turns.keepLocalTurn(LIVE, PEER, [said('t1', 'asked'), said('t2', '!echo kept')], 't2');
    expect(ids(await read(turns, [said('t1', 'asked'), said('t2', '!echo kept')]))).toEqual(['t1', 't2']);
  });

  it('puts a local turn back after the turn its anchor was read back inside', async () => {
    const { turns } = area();
    turns.turnRecordedAs(LIVE, PEER, 't1', 'first-try');
    turns.turnRecordedAs(LIVE, PEER, 't1', 'second-try');
    turns.keepLocalTurn(LIVE, PEER, [said('t1', 'asked'), said('t2', '!echo kept')], 't2');
    expect(ids(await read(turns, [said('first-try', 'asked'), said('second-try', 'asked')]))).toEqual(['first-try', 't2']);
  });

  it('ends a turn where the last turn read back inside it ended, with what both spent', async () => {
    const { turns } = area();
    turns.turnRecordedAs(LIVE, PEER, 't1', 't1');
    const first = {
      ...said('t1', 'asked'),
      startedAt: '2026-10-28T10:00:00.000Z',
      duration: 2000,
      usage: { inputTokens: 10, outputTokens: 5, model: 'one', _meta: { 'ahpd.cacheWriteTokens': 3, 'ahpd.cost': { amount: 0.5, currency: 'USD' } } },
    };
    const after = {
      ...said('s1', 'and also'),
      state: 'cancelled',
      startedAt: '2026-10-28T10:00:05.000Z',
      duration: 1000,
      usage: { inputTokens: 7, cacheReadTokens: 4, model: 'two', _meta: { 'ahpd.cost': { amount: 0.25, currency: 'USD' }, 'ahpd.context': { used: 20, size: 100 } } },
    };
    const back = await read(turns, [first, after]);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: 't1', state: 'cancelled', startedAt: '2026-10-28T10:00:00.000Z', duration: 6000 });
    expect(back[0]?.usage).toEqual({
      inputTokens: 17,
      outputTokens: 5,
      cacheReadTokens: 4,
      model: 'two',
      _meta: { 'ahpd.cacheWriteTokens': 3, 'ahpd.cost': { amount: 0.75, currency: 'USD' }, 'ahpd.context': { used: 20, size: 100 } },
    });
  });

  it('forgets what a truncation drops, copies what a fork copies, and goes where its chat goes', () => {
    const { store, turns } = area();
    turns.turnRecordedAs(LIVE, PEER, 't1', 't1');
    turns.turnRecordedAs(LIVE, PEER, 't2', 'cli-2');
    turns.turnRecordedAs(LIVE, PEER, 't3', 't3');
    expect(recordIn(store, 'live', PEER)).toEqual({ t1: 't1', 'cli-2': 't2', t3: 't3' });
    turns.forgetLocalTurns(LIVE, PEER, [said('t3', 'dropped')]);
    expect(recordIn(store, 'live', PEER)).toEqual({ t1: 't1', 'cli-2': 't2' });
    // A fork's turns are held by the ids the transcript gave them, or by the client's.
    turns.copyLocalTurns(LIVE, PEER, TAIL, [said('t1', 'kept'), said('cli-2', 'kept too')]);
    expect(recordIn(store, 'live', TAIL)).toEqual({ t1: 't1', 'cli-2': 't2' });
    turns.moveChatLocalTurns(LIVE, 'echo:/other', TAIL);
    expect(recordIn(store, 'live', TAIL)).toEqual({});
    expect(recordIn(store, 'other', TAIL)).toEqual({ t1: 't1', 'cli-2': 't2' });
    turns.forgetChatLocalTurns(LIVE, PEER);
    expect(recordIn(store, 'live', PEER)).toEqual({});
  });
});

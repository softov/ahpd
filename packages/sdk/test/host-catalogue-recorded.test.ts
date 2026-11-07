import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHost, hello, machine, peer, resetSdk, settle } from './support/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { chatUriFor } from '../src/host/channels.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import type { Agent, Listed, SessionAt } from '@ahpd/sdk';
import type { SessionStore } from '../src/types/sessions.js';

/*
 * Sessions in folders no backend lists.
 *
 * A backend lists the paths it serves and nothing else, so a session that ran
 * in a bot's own folder, or in a git worktree, was never offered by a listing.
 * It opened through `find`, and the next refresh took the row away again. The
 * store records where each session ran, and the listing asks each backend
 * about the sessions outside every path it read, so the row is there after a
 * restart before anything opens or wakes the session.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const PATH = '/home/softov';
const BOT = '/home/softov/.bots/ember';
const WORKTREE = '/srv/worktrees/fix';

/** One row, as a backend answers it. */
const row = (id: string, title: string, folder = PATH): Listed => ({
  id,
  title,
  createdAt: '2026-10-18T00:00:00.000Z',
  modifiedAt: '2026-10-18T09:00:00.000Z',
  workingDirectories: [`file://${folder}`],
});

interface Store {
  /** What a listing answers, which a test edits. */
  listed: Listed[];
  /** What `find` answers for one id, given the folder it was told. */
  known?: (id: string, folder: string | undefined) => Listed | undefined;
  /** Whether `find` throws, as a store that cannot be read would. */
  throws?: boolean;
}

interface Counting {
  /** How many times `list` was asked, which is one pass each. */
  lists: number;
  /** Every lookup, as the backend, the id and the folder it was told. */
  asked: [string, string, string | undefined][];
}

const counting = (): Counting => ({ lists: 0, asked: [] });

/** A backend over a store, counting what the host asked it for. */
const backend = (provider: string, here: Store, counted: Counting): Agent => ({
  ...echo({ path: PATH, pace: 0 }),
  provider,
  displayName: provider,
  directories: () => [PATH],
  list: async () => {
    counted.lists += 1;
    return [...here.listed];
  },
  find: async (id: string, at?: SessionAt) => {
    counted.asked.push([provider, id, at?.workingDirectory]);
    if (here.throws === true) throw new Error('the store could not be read');
    return here.known?.(id, at?.workingDirectory);
  },
  transcript: async () => [],
});

const watching = async (agents: Agent[], store?: SessionStore) => {
  const host = createHost({ path: PATH, agents, ...machine(), ...(store === undefined ? {} : { sessions: store }) });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  return { client, notes: p.notes };
};

const list = async (client: { handle(request: unknown): Promise<unknown> }) =>
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; title: string }[];
  };

/** Ticks until this is true, or long enough that it plainly is not. */
const until = async (wanted: () => boolean): Promise<void> => {
  for (let i = 0; i < 500 && !wanted(); i++) await settle(2);
  if (!wanted()) throw new Error('still waiting');
};

/** A session recorded where it ran, as the store keeps it. */
const recorded = (store: SessionStore, id: string, folder: string): SessionStore => {
  store.setProvider(id, 'claude');
  store.setWorkingDirectory?.(id, folder);
  return store;
};

describe('a session in a folder no backend read', () => {
  it('is in the first listing after a restart, before anything opens it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-recorded-'));
    try {
      const dir = join(root, 'sessions');
      // What the host wrote when the session ran, and a restart is what reads
      // it back: the row has to be there without anything opening the session.
      recorded(fileSessions({ dir }), 'ember', BOT).close?.();

      const counted = counting();
      const here: Store = {
        listed: [row('one', 'One')],
        known: (id, folder) => (id === 'ember' && folder === BOT ? row('ember', 'Ember', BOT) : undefined),
      };
      const { client } = await watching([backend('claude', here, counted)], fileSessions({ dir }));

      const items = (await list(client)).items;
      expect(items.map((one) => one.resource)).toContain('claude:/ember');
      expect(items.find((one) => one.resource === 'claude:/ember')?.title).toBe('Ember');
      expect(counted.asked).toContainEqual(['claude', 'ember', BOT]);
    }
    finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('stays listed across two refreshes, with nothing said to be removed', async () => {
    const counted = counting();
    const here: Store = {
      listed: [row('one', 'One')],
      known: (id, folder) => (id === 'ember' && folder === BOT ? row('ember', 'Ember', BOT) : undefined),
    };
    // Both rows are sessions this host ran: `one` in the folder the backend
    // lists, under the name it was made with, and `ember` in the bot's.
    const store = recorded(recorded(memorySessions(), 'ember', BOT), 'one', PATH);
    store.setUri?.('one', 'ahp-session:/one');
    const { client, notes } = await watching([backend('claude', here, counted)], store);

    // The first answer joins the boot listing, and starts the first refresh of
    // its own behind it.
    expect((await list(client)).items.map((one) => one.resource).sort())
      .toEqual(['ahp-session:/one', 'claude:/ember']);
    await until(() => counted.lists >= 2);
    await settle(4);

    notes.length = 0;
    expect((await list(client)).items.map((one) => one.resource).sort())
      .toEqual(['ahp-session:/one', 'claude:/ember']);
    await until(() => counted.lists >= 3);
    await settle(4);
    expect((await list(client)).items.map((one) => one.resource).sort())
      .toEqual(['ahp-session:/one', 'claude:/ember']);

    // A row a refresh could not find again would be said gone, and a client
    // told that closes the session it is looking at.
    expect(notes.filter((one) => one.method === 'root/sessionRemoved')).toEqual([]);
  });

  it('is found the same way in a git worktree folder', async () => {
    const counted = counting();
    const here: Store = {
      listed: [],
      known: (id, folder) => (id === 'fix' && folder === WORKTREE ? row('fix', 'Fix', WORKTREE) : undefined),
    };
    const store = recorded(memorySessions(), 'fix', WORKTREE);
    const { client } = await watching([backend('claude', here, counted)], store);

    const items = (await list(client)).items;
    expect(items.map((one) => one.resource)).toEqual(['claude:/fix']);
    expect(items[0]).toMatchObject({ resource: 'claude:/fix', title: 'Fix' });
    expect(counted.asked).toContainEqual(['claude', 'fix', WORKTREE]);
  });

  it('is not looked up when a backend already listed it', async () => {
    const counted = counting();
    const here: Store = { listed: [row('ember', 'Ember', BOT)], known: () => undefined };
    const store = recorded(memorySessions(), 'ember', BOT);
    const { client } = await watching([backend('claude', here, counted)], store);

    expect((await list(client)).items.map((one) => one.resource)).toEqual(['claude:/ember']);
    // Listed, so the row is already the backend's answer. Asking again would
    // be one read per session per pass for a row the same pass just built.
    expect(counted.asked).toEqual([]);
  });

  it('does not list the backend id of a chat as a session', async () => {
    const counted = counting();
    const here: Store = {
      listed: [],
      known: (id, folder) => (folder === BOT ? row(id, id, BOT) : undefined),
    };
    const store = recorded(recorded(memorySessions(), 'ember', BOT), 'side', BOT);
    store.setChats('ember', [
      { uri: chatUriFor('claude:/ember'), backendId: 'ember', default: true },
      { uri: 'ahp-chat:/0f8fad5b-d9cb-469f-a165-70867728950e', backendId: 'side' },
    ]);
    const { client } = await watching([backend('claude', here, counted)], store);

    // `side` is the conversation of ember's second chat, not a session.
    expect((await list(client)).items.map((one) => one.resource)).toEqual(['claude:/ember']);
  });

  it('adds no row for a lookup that throws, and keeps the record', async () => {
    const counted = counting();
    const here: Store = { listed: [], known: () => undefined, throws: true };
    const store = recorded(memorySessions(), 'broken', BOT);
    const { client } = await watching([backend('claude', here, counted)], store);

    expect((await list(client)).items).toEqual([]);
    expect(counted.asked).toContainEqual(['claude', 'broken', BOT]);
    // Nothing read the folder the session ran in, so a listing cannot say the
    // session is gone: the record is kept, as `gone` keeps it.
    expect(store.provider('broken')).toBe('claude');
    expect(store.workingDirectory?.('broken')).toBe(BOT);
  });
});

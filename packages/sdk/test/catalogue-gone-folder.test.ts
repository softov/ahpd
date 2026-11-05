import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHost, flushed, hello, machine, peer, resetSdk, settle } from './support/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { uriOf } from '../src/resources/fileuri.js';
import { memorySessions } from '../src/sessions/sessions.js';
import type { Agent, Listed } from '@ahpd/sdk';
import type { SessionStore } from '../src/types/sessions.js';

/*
 * A session whose folder has gone.
 *
 * A git worktree removed by hand leaves the session's record behind, and a
 * summary that still named the folder was a client drawing a folder that opens
 * onto nothing. Only the summary changes: the record and the folders a row
 * was listed with stay as they were, so a folder that is made again is named
 * again, and a URI that names another machine is kept.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const PATH = '/home/softov';

/** One row, as a backend answers it, naming the folder the session ran in. */
const row = (id: string, title: string, folder: string): Listed => ({
  id,
  title,
  createdAt: '2026-10-18T00:00:00.000Z',
  modifiedAt: '2026-10-18T09:00:00.000Z',
  workingDirectories: [folder],
});

/** What a backend lists, which a test edits. */
interface Store {
  listed: Listed[];
}

/** How many times a backend was asked to list, which is one pass each. */
interface Counting {
  lists: number;
}

/** A backend over a store, counting the passes a listing costs it. */
const backend = (provider: string, here: Store, counted: Counting): Agent => ({
  ...echo({ path: PATH, pace: 0 }),
  provider,
  displayName: provider,
  directories: () => [PATH],
  list: async () => {
    counted.lists += 1;
    return [...here.listed];
  },
  transcript: async () => [],
});

/** A host, a client watching its root, and what that client was told. */
const watching = async (agents: Agent[], store: SessionStore = memorySessions()) => {
  const host = createHost({ path: PATH, agents, ...machine(), sessions: store });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  return { client, notes: p.notes };
};

/** The whole of what one listing answers. */
const list = async (client: { handle(request: unknown): Promise<unknown> }) =>
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; workingDirectories: string[] }[];
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

/** The folder the session worked in, under a root the test removes at the end. */
const workingRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-gone-'));
  return { root, folder: join(root, 'worktree') };
};

describe('a folder that has gone', () => {
  it('leaves the summary, and stays in the record and the opened session', async () => {
    const { root, folder } = workingRoot();
    try {
      mkdirSync(folder);
      // The record is written while the folder is there, and then the folder
      // is removed outside this host, as a worktree removed by hand is.
      const store = recorded(memorySessions(), 'gone', folder);
      rmSync(folder, { recursive: true, force: true });

      const counted = { lists: 0 };
      const { client } = await watching(
        [backend('claude', { listed: [row('gone', 'Gone', uriOf(folder))] }, counted)],
        store,
      );

      const items = (await list(client)).items;
      expect(items.map((one) => one.resource)).toContain('claude:/gone');
      expect(items.find((one) => one.resource === 'claude:/gone')?.workingDirectories).toEqual([]);

      // The record keeps the folder, so a listing that cannot see it still
      // knows where the session ran.
      expect(store.provider('gone')).toBe('claude');
      expect(store.workingDirectory?.('gone')).toBe(folder);

      // And so does the folders the row was listed with, which is where an
      // opened session reads them from.
      const opened = await client.handle({ method: 'subscribe', params: { channel: 'claude:/gone' } }) as {
        snapshot: { state: { workingDirectories: string[] } };
      };
      expect(opened.snapshot.state.workingDirectories).toEqual([uriOf(folder)]);
    }
    // Awaited, with retries: on Windows the host can hold the folder a moment longer.
    finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });

  it('is named again after it is made again', async () => {
    const { root, folder } = workingRoot();
    try {
      const store = recorded(memorySessions(), 'gone', folder);
      const counted = { lists: 0 };
      const { client } = await watching(
        [backend('claude', { listed: [row('gone', 'Gone', uriOf(folder))] }, counted)],
        store,
      );
      expect((await list(client)).items[0]?.workingDirectories).toEqual([]);

      // Let the refresh behind that answer finish, so the pass below is one
      // that read a disk where the folder is back.
      await until(() => counted.lists >= 2);
      await settle(8);
      mkdirSync(folder);

      const before = counted.lists;
      await list(client);
      await until(() => counted.lists > before);
      await settle(8);
      expect((await list(client)).items[0]?.workingDirectories).toEqual([uriOf(folder)]);
    }
    // Awaited, with retries: on Windows the host can hold the folder a moment longer.
    finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });

  it('keeps a URI that names another machine', async () => {
    const counted = { lists: 0 };
    const folder = 'computer://box/workspaces/app';
    const { client } = await watching([backend('claude', { listed: [row('box', 'Box', folder)] }, counted)]);

    // This host cannot read another machine's disk, so it keeps the URI as
    // the backend named it rather than guessing that the folder is gone.
    expect((await list(client)).items[0]?.workingDirectories).toEqual([folder]);
  });

  it('leaves a running session\'s summary too', async () => {
    const { root, folder } = workingRoot();
    try {
      mkdirSync(folder);
      const { client, notes } = await watching([echo({ path: PATH, pace: 0 })]);
      await client.handle({
        method: 'createSession',
        params: { channel: 'ahp-session:/live', provider: 'echo', workingDirectories: [uriOf(folder)] },
      });
      await settle(4);
      const added = notes.filter((one) => one.method === 'root/sessionAdded').at(-1)?.params as
        { summary?: { workingDirectories?: string[] } } | undefined;
      expect(added?.summary?.workingDirectories).toEqual([uriOf(folder)]);

      rmSync(folder, { recursive: true, force: true });
      await client.handle({
        method: 'dispatchAction',
        params: { channel: 'ahp-session:/live', action: { type: 'session/titleChanged', title: 'Gone' } },
      });
      await settle(4);
      await flushed();
      const moved = notes.filter((one) => one.method === 'root/sessionSummaryChanged').at(-1)?.params as
        { changes?: { workingDirectories?: string[] } } | undefined;
      expect(moved?.changes?.workingDirectories).toEqual([]);
      // And the row a listing builds for it, which is not the summary above.
      expect((await list(client)).items.find((one) => one.resource === 'ahp-session:/live')?.workingDirectories).toEqual([]);
    }
    // Awaited, with retries: on Windows the host can hold the folder a moment longer.
    finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });
});

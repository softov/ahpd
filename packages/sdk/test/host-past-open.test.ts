import { WAIT_MS } from '../../../tools/wait.ts';
import { describe, expect, it, vi } from 'vitest';
import { createHost, hello, machine, peer, settle } from './support/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import type { Agent, Listed, SessionAt } from '@ahpd/sdk';
import type { Turn } from '@microsoft/agent-host-protocol';
import type { WireTurn } from '../src/types/wire.js';
import type { SessionStore } from '../src/types/sessions.js';
import { WORK } from './support/work.js';
import { uriOf } from '../src/resources/fileuri.js';

/*
 * Opening a session this host is not running.
 *
 * A row in the catalogue opens without asking a backend anything: the host is
 * already holding the row, and the transcript is the one read that a client
 * opening a conversation cannot do without. What a client does do is open rows
 * the host has not got - a link from another machine, a session written to disk
 * after the last listing - and those used to cost a listing of every transcript
 * on the machine, for one id. `find` is that asked by id instead: one file
 * rather than a pass, and nothing at all for a session that is already held.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

const DIR = join(WORK, 'project');

const HOUR = 60 * 60 * 1000;
/** When a row was made and last written, inside the window of the mode that shows it. */
const CREATED = new Date(Date.now() - 10 * HOUR).toISOString();
const MODIFIED = new Date(Date.now() - HOUR).toISOString();

const row = (id: string, title: string): Listed => ({
  id,
  title,
  createdAt: CREATED,
  modifiedAt: MODIFIED,
  workingDirectories: [uriOf(DIR)],
});

interface Counting {
  /** How many times the catalogue was listed, which is one pass each. */
  lists: number;
  /** Which backends were asked for one session by id. */
  asked: string[];
}

const counting = (): Counting => ({ lists: 0, asked: [] });

interface Store {
  /** What a listing answers, which a test edits. */
  listed: Listed[];
  /** What `find` answers, or nothing where this backend has no `find`. */
  known?: (id: string) => Listed | undefined;
}

/** A backend over a store, counting what the host asked it for. */
const backend = (provider: string, here: Store, counted: Counting): Agent => ({
  ...echo({ path: DIR, pace: 0 }),
  provider,
  displayName: provider,
  directories: () => [DIR],
  list: async () => {
    counted.lists += 1;
    return [...here.listed];
  },
  ...(here.known === undefined ? {} : {
    find: async (id: string) => {
      counted.asked.push(provider);
      return here.known?.(id);
    },
  }),
  transcript: async () => [],
});

const watching = async (agents: Agent[], store?: SessionStore) => {
  const host = createHost({ path: DIR, agents, ...machine(), ...(store === undefined ? {} : { sessions: store }) });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  return { client, notes: p.notes };
};

const opened = async (client: { handle(request: unknown): Promise<unknown> }, channel: string) =>
  await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot?: { resource: string } };

const list = async (client: { handle(request: unknown): Promise<unknown> }) =>
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; createdAt?: string; modifiedAt?: string }[];
  };

describe('opening a past session', () => {
  it('reads a row the host holds without asking a backend anything', async () => {
    const counted = counting();
    const here: Store = { listed: [row('one', 'One')], known: () => undefined };
    const { client } = await watching([backend('claude', here, counted)]);
    // The catalogue filled by its own boot listing.
    await list(client);
    await settle(4);
    const passes = counted.lists;

    expect((await opened(client, 'ahp-session:/one')).snapshot?.resource).toBe('ahp-session:/one');
    // Opening the session a client is looking at is the one thing that must not
    // cost a pass over the machine: it is the case every window does on open.
    expect(counted.lists).toBe(passes);
    expect(counted.asked).toEqual([]);
  });

  it('asks for one id rather than listing everything, and says the row it found', async () => {
    const counted = counting();
    const here: Store = { listed: [], known: (id) => (id === 'late' ? row('late', 'Late') : undefined) };
    // A session this host ran, written after the last listing: its record names
    // the backend to ask.
    const store = memorySessions();
    store.setProvider('late', 'claude');
    store.setUri?.('late', 'ahp-session:/late');
    const { client, notes } = await watching([backend('claude', here, counted)], store);
    await list(client);
    await settle(4);
    const passes = counted.lists;

    expect((await opened(client, 'ahp-session:/late')).snapshot?.resource).toBe('ahp-session:/late');
    expect(counted.asked).toEqual(['claude']);
    // No listing: one file rather than a pass over every transcript, which is
    // the whole of what `find` is for.
    expect(counted.lists).toBe(passes);

    const added = notes.filter((one) => one.method === 'root/sessionAdded')
      .map((one) => (one.params as { summary?: { resource: string; title: string } }).summary);
    expect(added.map((one) => [one?.resource, one?.title])).toEqual([['ahp-session:/late', 'Late']]);

    // And it is held now, so a second opening asks nothing of anybody.
    expect((await opened(client, 'ahp-session:/late')).snapshot?.resource).toBe('ahp-session:/late');
    expect(counted.asked).toEqual(['claude']);
  });

  it('asks the backend that ran the session first, whichever loaded first', async () => {
    const counted = counting();
    const first: Store = { listed: [], known: () => undefined };
    const second: Store = { listed: [], known: (id) => (id === 'late' ? row('late', 'Late') : undefined) };
    // The record is what the host wrote when the session ran, and it is the one
    // loaded agent that names it: a transcript does not say which harness wrote
    // it, and a session resumed on the wrong endpoint moves conversation.
    const store: SessionStore = { ...memorySessions(), provider: (id) => (id === 'late' ? 'second' : undefined) };
    const { client } = await watching([backend('first', first, counted), backend('second', second, counted)], store);

    expect((await opened(client, 'ahp-session:/late')).snapshot?.resource).toBe('ahp-session:/late');
    // One question, to the one that recorded it: the transcript is there and
    // the answer is that this endpoint can serve it.
    expect(counted.asked).toEqual(['second']);
  });

  it('falls back to one listing for a backend that cannot answer by id', async () => {
    const counted = counting();
    // No `find`, and `list` is all it has ever had.
    const here: Store = { listed: [row('one', 'One')] };
    const { client } = await watching([backend('claude', here, counted)]);
    await list(client);
    await settle(4);
    const passes = counted.lists;

    // Written to disk after the last listing, and found the only way a backend
    // without `find` can be.
    here.listed.push(row('late', 'Late'));
    expect((await opened(client, 'ahp-session:/late')).snapshot?.resource).toBe('ahp-session:/late');
    expect(counted.lists).toBe(passes + 1);
  });

  it('lists nothing when a recorded id its backend does not have is opened again and again', async () => {
    const counted = counting();
    const here: Store = { listed: [row('one', 'One')], known: () => undefined };
    const store = memorySessions();
    for (let i = 0; i < 5; i++) {
      store.setProvider(`never-${i}`, 'claude');
      store.setUri?.(`never-${i}`, `ahp-session:/never-${i}`);
    }
    const { client } = await watching([backend('claude', here, counted)], store);
    await list(client);
    await settle(4);
    const passes = counted.lists;

    for (let i = 0; i < 5; i++) {
      await expect(client.handle({ method: 'subscribe', params: { channel: `ahp-session:/never-${i}` } }))
        .rejects.toMatchObject({ code: -32001 });
    }
    // The backend each record names can be asked about one session, so a
    // listing is a pass over the machine for nothing - and there is no window
    // that keeps the fifth one from paying for it as the first did.
    expect(counted.lists).toBe(passes);
    expect(counted.asked).toHaveLength(5);
  });

  /*
   * A session no record ties to a backend is found through a backend's own
   * listing, as VS Code's host finds one through its registry's discovery, and
   * no backend is asked about it by id.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostProviderService.ts#L141-L152
   */
  it('looks for an id nobody recorded in one listing, and asks no backend about it by id', async () => {
    const counted = counting();
    const here: Store = { listed: [row('one', 'One')], known: () => undefined };
    const { client } = await watching([backend('claude', here, counted)]);
    await list(client);
    await settle(4);
    const passes = counted.lists;

    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/never' } }))
      .rejects.toMatchObject({ code: -32001 });
    expect(counted.lists).toBe(passes + 1);
    expect(counted.asked).toEqual([]);
  });

  it('tells the backend the folder the record names, and opens a session found only there', async () => {
    const BOT = join(WORK, '.bots/support');
    const asked: (SessionAt | undefined)[] = [];
    const read: (SessionAt | undefined)[] = [];
    const agent: Agent = {
      ...backend('claude', { listed: [] }, counting()),
      // A store that looks in the folder it is told and nowhere else, which is
      // a session that ran outside every path this backend serves.
      find: async (id: string, at?: SessionAt) => {
        asked.push(at);
        return id === 'bot' && at?.workingDirectory === BOT ? { ...row('bot', 'Bot'), workingDirectories: [uriOf(BOT)] } : undefined;
      },
      transcript: async (_id: string, at?: SessionAt) => {
        read.push(at);
        return [];
      },
    };
    const store = memorySessions();
    store.setProvider('bot', 'claude');
    store.setWorkingDirectory('bot', BOT);
    const { client, notes } = await watching([agent], store);

    expect((await opened(client, 'claude:/bot')).snapshot?.resource).toBe('claude:/bot');
    // Said under the name a listing gives a row this host keeps a record for,
    // which is the one name the row has.
    expect(notes.filter((one) => one.method === 'root/sessionAdded')
      .map((one) => (one.params as { summary?: { resource: string } }).summary?.resource)).toEqual(['claude:/bot']);
    expect(asked).toEqual([{ workingDirectory: BOT }]);
    expect(read).toEqual([{ workingDirectory: BOT }]);
  });

  it('asks with no folder for a session whose record names none, as before', async () => {
    const asked: unknown[][] = [];
    const agent: Agent = {
      ...backend('claude', { listed: [] }, counting()),
      find: async (...args: [string, SessionAt?]) => {
        asked.push(args);
        return args[0] === 'late' ? row('late', 'Late') : undefined;
      },
    };
    // A record naming its backend and no folder.
    const store = memorySessions();
    store.setProvider('late', 'claude');
    store.setUri?.('late', 'ahp-session:/late');
    const { client } = await watching([agent], store);

    expect((await opened(client, 'ahp-session:/late')).snapshot?.resource).toBe('ahp-session:/late');
    expect(asked).toEqual([['late', undefined]]);
  });

  it('records the folder a found row ran in, and nothing for a session it keeps no record for', async () => {
    const found = (id: string): Listed => ({ ...row(id, id), workingDirectories: ['file:///srv/worktrees/fix'] });
    const agent: Agent = {
      ...backend('claude', { listed: [] }, counting()),
      find: async (id: string) => found(id),
    };
    const store = memorySessions();
    store.setProvider('ran', 'claude');
    const { client } = await watching([agent], store);

    // A row this host keeps a record for keeps its provider's scheme, as a
    // listing names it.
    await opened(client, 'claude:/ran');
    expect(store.workingDirectory('ran')).toBe('/srv/worktrees/fix');
    // A session this host never ran is found through a listing alone, which has
    // none here, and gets no record for being looked at.
    await expect(opened(client, 'ahp-session:/never-ran')).rejects.toMatchObject({ code: -32001 });
    expect(store.rowOf('never-ran')).toBeUndefined();
  });

  it('writes the folder of a session it creates into the record file', async () => {
    // Left to the run's own folder to remove: the checkpoint the session writes
    // runs git in it, which Windows will not remove a folder under while it runs.
    const root = mkdtempSync(join(tmpdir(), 'ahpd-folder-'));
    const dir = join(root, 'sessions');
    const store = fileSessions({ dir });
    const host = createHost({ path: root, agents: [echo({ path: root, pace: 0 })], ...machine(), sessions: store });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/made', provider: 'echo', workingDirectories: [`file://${root}`] },
    });
    const record = join(dir, 'made.json');
    for (const until = Date.now() + WAIT_MS; Date.now() < until && !existsSync(record);) {
      await new Promise((tick) => { setTimeout(tick, 10); });
    }
    const saved = JSON.parse(readFileSync(record, 'utf8')) as { workingDirectory?: string };
    expect(saved.workingDirectory).toBe(root);
    await host.close();
  });
});

describe('a stored session no listing names', () => {
  /** One turn, as a backend replays a conversation it still holds. */
  const replayed: WireTurn<Turn>[] = [{
    id: 'turn-one',
    startedAt: '2026-11-10T00:00:00.000Z',
    message: { text: 'what changed?', origin: { kind: 'user' as const } },
    responseParts: [],
    usage: undefined,
    state: 'complete' as const,
  }];

  /** A backend with nothing listed and nothing findable, as ACP is after a restart. */
  const unlisted = (transcript: NonNullable<Agent['transcript']>): Agent => ({
    ...backend('claude', { listed: [] }, counting()),
    transcript,
  });

  /** The store a restart reads: recorded where it ran, then reopened. */
  const stored = (dir: string): SessionStore => {
    const written = fileSessions({ dir });
    written.setProvider('ember', 'claude');
    written.setWorkingDirectory?.('ember', DIR);
    written.close?.();
    return fileSessions({ dir });
  };

  it('opens by id from its backend, and is listed once it has', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-unlisted-'));
    try {
      const { client } = await watching(
        [unlisted(async (id) => (id === 'ember' ? replayed : undefined))],
        stored(dir),
      );
      expect((await list(client)).items.map((one) => one.resource)).not.toContain('claude:/ember');

      const state = (await client.handle({ method: 'subscribe', params: { channel: 'claude:/ember' } }) as {
        snapshot: { state: { lifecycle: string; defaultChat: string } };
      }).snapshot.state;
      expect(state.lifecycle).toBe('ready');
      const chat = (await client.handle({ method: 'subscribe', params: { channel: state.defaultChat } }) as {
        snapshot: { state: { turns: { message: { text: string } }[] } };
      }).snapshot.state;
      expect(chat.turns.map((one) => one.message.text)).toEqual(['what changed?']);

      // Listed from the moment it has opened; nothing enumerates stored sessions.
      const opened = (await list(client)).items.find((one) => one.resource === 'claude:/ember');
      expect(opened).toBeDefined();
      // The row carries the conversation's clock, so a session from last week is not created today.
      expect(opened?.createdAt).toBe('2026-11-10T00:00:00.000Z');
      expect(opened?.modifiedAt).toBe('2026-11-10T00:00:00.000Z');
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses one its backend does not hold, and registers nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-unlisted-'));
    try {
      const { client } = await watching([unlisted(async () => undefined)], stored(dir));
      await expect(client.handle({ method: 'subscribe', params: { channel: 'claude:/ember' } }))
        .rejects.toMatchObject({ code: -32001 });
      expect((await list(client)).items.map((one) => one.resource)).not.toContain('claude:/ember');
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('says a backend that failed to load apart from a conversation nobody has', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-unlisted-'));
    try {
      const { client } = await watching([unlisted(async () => { throw new Error('the ACP server exited'); })], stored(dir));
      await expect(client.handle({ method: 'subscribe', params: { channel: 'claude:/ember' } }))
        .rejects.toMatchObject({ code: -32603, message: expect.stringContaining('could not load session ember') });
      expect((await list(client)).items.map((one) => one.resource)).not.toContain('claude:/ember');
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

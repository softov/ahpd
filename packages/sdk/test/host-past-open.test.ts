import { describe, expect, it, vi } from 'vitest';
import { createHost, hello, machine, peer, settle } from './support/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { memorySessions } from '../src/sessions.js';
import type { Agent, Listed } from '@ahpd/sdk';
import type { SessionStore } from '../src/types/sessions.js';

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

const DIR = '/home/softov/project';

const row = (id: string, title: string): Listed => ({
  id,
  title,
  createdAt: '2026-09-27T00:00:00.000Z',
  modifiedAt: '2026-09-27T09:00:00.000Z',
  workingDirectories: [`file://${DIR}`],
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
    items: { resource: string }[];
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

    expect((await opened(client, 'claude:/one')).snapshot?.resource).toBe('claude:/one');
    // Opening the session a client is looking at is the one thing that must not
    // cost a pass over the machine: it is the case every window does on open.
    expect(counted.lists).toBe(passes);
    expect(counted.asked).toEqual([]);
  });

  it('asks for one id rather than listing everything, and says the row it found', async () => {
    const counted = counting();
    const here: Store = { listed: [], known: (id) => (id === 'late' ? row('late', 'Late') : undefined) };
    const { client, notes } = await watching([backend('claude', here, counted)]);
    await list(client);
    await settle(4);
    const passes = counted.lists;

    expect((await opened(client, 'claude:/late')).snapshot?.resource).toBe('claude:/late');
    expect(counted.asked).toEqual(['claude']);
    // No listing: one file rather than a pass over every transcript, which is
    // the whole of what `find` is for.
    expect(counted.lists).toBe(passes);

    const added = notes.filter((one) => one.method === 'root/sessionAdded')
      .map((one) => (one.params as { summary?: { resource: string; title: string } }).summary);
    expect(added.map((one) => [one?.resource, one?.title])).toEqual([['claude:/late', 'Late']]);

    // And it is held now, so a second opening asks nothing of anybody.
    expect((await opened(client, 'claude:/late')).snapshot?.resource).toBe('claude:/late');
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

    expect((await opened(client, 'claude:/late')).snapshot?.resource).toBe('claude:/late');
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
    expect((await opened(client, 'claude:/late')).snapshot?.resource).toBe('claude:/late');
    expect(counted.lists).toBe(passes + 1);
  });

  it('answers as today for an id nobody has', async () => {
    const counted = counting();
    const here: Store = { listed: [row('one', 'One')], known: () => undefined };
    const { client } = await watching([backend('claude', here, counted)]);
    await list(client);
    await settle(4);
    const passes = counted.lists;

    await expect(client.handle({ method: 'subscribe', params: { channel: 'claude:/never' } }))
      .rejects.toMatchObject({ code: -32001 });
    // Nothing here has it and nothing here can be asked again, so a listing
    // would be a pass over the machine for nothing.
    expect(counted.lists).toBe(passes);
    expect(counted.asked).toEqual(['claude']);
  });
});

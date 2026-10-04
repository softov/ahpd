/*
 * What a delete reaches.
 *
 * `disposeSession` used to tear down what the daemon held and leave the
 * backend's own copy exactly where it was, so the next listing offered the
 * same session again, under whichever agent read its directory first - and a
 * row the daemon only listed could not be deleted at all. What is here is the
 * other half: the agent that owns a row is asked to remove its copy, for a
 * session the daemon is running and for one it is not.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Listed } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-delete-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => { notes.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

/** What one session was deleted as, in the order the host did it. */
type Deleted = { id: string; directory: string | undefined };

/**
 * An echo backend that records the order of a disposal, and lists `rows`.
 *
 * The order is the whole of the first case: a transcript written again by a
 * backend that is still running is a session that comes back on the next
 * listing, which is the whole reason the delete is asked for after the teardown
 * rather than before it.
 */
const recording = (
  order: string[],
  deleted: Deleted[],
  rows: Listed[] = [],
): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    list: async () => rows,
    delete: async (id, directory) => {
      order.push(`delete ${id}`);
      deleted.push({ id, directory });
      // A store that has been asked to delete stops offering the row, which
      // is the whole of what "deleted" means for the next listing.
      const at = rows.findIndex((one) => one.id === id);
      if (at >= 0) rows.splice(at, 1);
    },
    create: (start) => {
      const session = base.create(start);
      return { ...session, close: () => { order.push(`close ${start.uri}`); session.close(); } };
    },
  };
};

/** A host on this directory, with the backend given, and a client connected. */
const serving = async (agent: Agent, onEvent?: (line: string) => void) => {
  const host = createHost({
    path: dir,
    agents: [agent],
    ...(onEvent === undefined ? {} : { onEvent }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  return { host, client, peer: p };
};

const open = (client: Awaited<ReturnType<typeof serving>>['client'], uri: string): Promise<unknown> =>
  client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', workingDirectories: [`file://${dir}`] } });

const dispose = (client: Awaited<ReturnType<typeof serving>>['client'], uri: string): Promise<unknown> =>
  client.handle({ method: 'disposeSession', params: { channel: uri } });

/** What the catalogue says, by the name each row is held under. */
const listing = async (client: Awaited<ReturnType<typeof serving>>['client']): Promise<string[]> => {
  const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string }[];
  };
  return rows.items.map((one) => one.resource);
};

it('asks the backend to delete a running session, once the chat has closed', async () => {
  const order: string[] = [];
  const deleted: Deleted[] = [];
  const { client } = await serving(recording(order, deleted));
  await open(client, 'ahp-session:/held');

  await dispose(client, 'ahp-session:/held');

  expect(order).toEqual(['close echo:/held', 'delete held']);
  expect(deleted).toEqual([{ id: 'held', directory: dir }]);
  client.close();
});

it('deletes a row it only listed, through the agent that owns it, and tells every client', async () => {
  const order: string[] = [];
  const deleted: Deleted[] = [];
  const row: Listed = {
    id: 'listed',
    title: 'Listed',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    workingDirectories: [`file://${dir}`],
  };
  const { client, peer: p } = await serving(recording(order, deleted, [row]));
  // Listed first, which is the only thing that gives the host an owner for it.
  const listed = await listing(client);
  expect(listed).toContain('echo:/listed');

  await dispose(client, 'echo:/listed');

  // No chat of this row ever ran here, so nothing is closed - only the
  // backend's copy goes, and every client is told the row is gone.
  expect(order).toEqual(['delete listed']);
  expect(deleted).toEqual([{ id: 'listed', directory: dir }]);
  expect(p.notes.some((one) => one.method === 'root/sessionRemoved'
    && (one.params as { session?: string }).session === 'echo:/listed')).toBe(true);
  // And it is not offered again, because the store that answered has nothing
  // to answer with now.
  expect(await listing(client)).not.toContain('echo:/listed');
  client.close();
});

it('passes no directory for a row that ran in none', async () => {
  const order: string[] = [];
  const deleted: Deleted[] = [];
  const row: Listed = {
    id: 'nowhere',
    title: 'Nowhere',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    // A store records a session that never had a workspace this way.
    workingDirectories: [],
  };
  const { client } = await serving(recording(order, deleted, [row]));
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });

  await dispose(client, 'echo:/nowhere');

  expect(deleted).toEqual([{ id: 'nowhere', directory: undefined }]);
  client.close();
});

it('answers a delete that failed, and the session is gone all the same', async () => {
  const said: string[] = [];
  const base = echo({ path: dir, pace: 0 });
  const agent: Agent = {
    ...base,
    delete: async () => { throw new Error('the store would not let go of it'); },
  };
  const { client, peer: p } = await serving(agent, (line) => said.push(line));
  await open(client, 'ahp-session:/held');

  await expect(dispose(client, 'ahp-session:/held')).rejects.toThrow('the store would not let go of it');

  // The failure is logged with the session it was about, and the client is
  // still told the session is gone: the teardown happened before the store was
  // touched, and nothing undoes it.
  expect(said.some((line) => line.includes('could not delete echo:/held from echo: the store would not let go of it'))).toBe(true);
  expect(p.notes.some((one) => one.method === 'root/sessionRemoved'
    && (one.params as { session?: string }).session === 'echo:/held')).toBe(true);
  // A name in neither map: it is out of `sessions`, and out of `owners`.
  await expect(dispose(client, 'ahp-session:/held')).rejects.toThrow('No agent for session ahp-session:/held');
  client.close();
});

it('does not read a refusal itself: a store that says the session is not there says so by resolving', async () => {
  const said: string[] = [];
  const base = echo({ path: dir, pace: 0 });
  // The Claude SDK throws for a session whose file is not there. Which errors
  // count as "not there" is the store's own reading, so the backend turns that
  // one into a resolve and lets everything else through - the host has no
  // store to read a message against and does not guess at one.
  const missing = new Set(['held']);
  const store: Agent = {
    ...base,
    delete: async (id) => { if (!missing.has(id)) throw new Error('session not found'); },
  };
  const { client } = await serving(store, (line) => said.push(line));
  await open(client, 'ahp-session:/held');

  await expect(dispose(client, 'ahp-session:/held')).resolves.toEqual({});
  expect(said.some((line) => line.includes('could not delete'))).toBe(false);

  // And the same store refusing a session it does have is not read as deleted.
  await open(client, 'ahp-session:/kept');
  await expect(dispose(client, 'ahp-session:/kept')).rejects.toThrow('session not found');
  client.close();
});

it('disposes under an agent that cannot delete, and says once that the session may come back', async () => {
  const said: string[] = [];
  const { client } = await serving(echo({ path: dir, pace: 0 }), (line) => said.push(line));
  await open(client, 'ahp-session:/one');
  await open(client, 'ahp-session:/two');

  await expect(dispose(client, 'ahp-session:/one')).resolves.toEqual({});
  await expect(dispose(client, 'ahp-session:/two')).resolves.toEqual({});

  // Once per provider, not once per session: a line that repeats itself on
  // every disposal is a line nobody reads.
  const said_ = said.filter((line) => line.includes('may be listed again'));
  expect(said_).toEqual(['echo keeps its own copy of a deleted session, so it may be listed again']);
  client.close();
});

it('refuses a name it has never heard of, in either map', async () => {
  const order: string[] = [];
  const deleted: Deleted[] = [];
  const { client } = await serving(recording(order, deleted));

  await expect(dispose(client, 'echo:/nobody')).rejects.toThrow('No agent for session echo:/nobody');

  // Nothing was deleted, because nothing was found to ask about.
  expect(order).toEqual([]);
  expect(deleted).toEqual([]);
  client.close();
});

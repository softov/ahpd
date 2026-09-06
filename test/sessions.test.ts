/*
 * What a host keeps about a session, and whether it survives a restart.
 *
 * The bits every client shares - `IsRead`, `IsArchived` - and the settings a
 * session runs under. Held in memory this host forgot them, and a restart
 * returned every archived session to the catalogue and marked every read one
 * unread, for everybody, with nothing said about it. So the tests that matter
 * here are the ones that build a host, stop it, and build another on the same
 * file.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileSessions, memorySessions } from '../packages/sdk/src/sessions.js';
import { echo } from '../examples/echo/agent.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';
import type { SessionStore } from '../packages/sdk/src/types/sessions.js';

const ROOT = 'ahp-root://';
const SESSION = 'ahp-session:/one';
/** `Status.IsArchived`, which is what a client sets when it puts a row away. */
const ARCHIVED = 64;
const READ = 32;

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-store-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** A host on this store, with one echo session open. */
async function running(store: SessionStore) {
  const host = createHost({ path: root, agents: [echo({ path: root, pace: 0 })], sessions: store });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: SESSION } });
  return { host, client };
}

const archive = (client: Awaited<ReturnType<typeof running>>['client']) => client.handle({
  method: 'dispatchAction',
  params: { channel: SESSION, action: { type: 'session/isArchivedChanged', isArchived: true } },
});

const statusOf = async (client: Awaited<ReturnType<typeof running>>['client']): Promise<number> => {
  const answer = await client.handle({ method: 'subscribe', params: { channel: SESSION } }) as {
    snapshot: { state: { status: number } };
  };
  return answer.snapshot.state.status;
};

it('carries the archived bit into the status a client reads', async () => {
  const { client } = await running(memorySessions());
  expect(await statusOf(client) & ARCHIVED).toBe(0);
  await archive(client);
  expect(await statusOf(client) & ARCHIVED).toBe(ARCHIVED);
});

it('forgets it when the store is the one that forgets', async () => {
  const store = memorySessions();
  const first = await running(store);
  await archive(first.client);

  // A second host on a *fresh* memory store, which is what a restart is.
  const second = await running(memorySessions());
  expect(await statusOf(second.client) & ARCHIVED).toBe(0);
});

it('remembers it across a restart when the store writes it down', async () => {
  const file = join(root, 'sessions.json');
  const first = await running(fileSessions({ file }));
  await archive(first.client);
  // The write is coalesced onto the next tick, so this is the restart
  // happening after it rather than a test waiting for nothing.
  await new Promise((tick) => { setTimeout(tick, 5); });

  const second = await running(fileSessions({ file }));
  expect(await statusOf(second.client) & ARCHIVED).toBe(ARCHIVED);
});

it('writes nothing for a session nobody flagged', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  // Read and then cleared: back where it started, so there is nothing about
  // this session worth a line in a file a daemon carries for months.
  store.setFlags('a', READ);
  store.setFlags('a', 0);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([]);
});

it('forgets a session that was disposed, rather than keeping its bits for ever', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  const { client } = await running(store);
  await archive(client);
  await client.handle({ method: 'disposeSession', params: { channel: SESSION } });
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([]);
});

it('keeps the settings a session was given, so a resumed one still has them', async () => {
  const store = memorySessions();
  store.setConfig('one', { voice: 'shouty' });
  expect(store.config('one')).toEqual({ voice: 'shouty' });
  store.forget('one');
  expect(store.config('one')).toBeUndefined();
});

it('starts empty and says so when the file cannot be read', () => {
  const file = join(root, 'sessions.json');
  writeFileSync(file, 'this is not json');
  const said: string[] = [];
  const store = fileSessions({ file, onProblem: (message) => said.push(message) });
  // A warning and an empty store, never a refusal: losing which rows were
  // archived is worth saying out loud, and is not worth refusing to start over.
  expect(store.flags('anything')).toBe(0);
  expect(said.join(' ')).toContain('Could not read');
});

it('ignores a file written by a version that shaped it differently', () => {
  const file = join(root, 'sessions.json');
  writeFileSync(file, JSON.stringify({ version: 2, sessions: [{ id: 'a', flags: 64 }] }));
  const said: string[] = [];
  const store = fileSessions({ file, onProblem: (message) => said.push(message) });
  expect(store.flags('a')).toBe(0);
  expect(said.join(' ')).toContain('not a session store this version can read');
});

it('says a write failed rather than throwing out of a flag being set', async () => {
  /*
   * A file underneath where the directory has to be, so `mkdir` answers
   * ENOTDIR and nothing can be written there.
   *
   * What must not happen is the throw reaching the caller: `setFlags` is
   * called from inside a dispatched action, and a store that threw would turn
   * somebody archiving a row into a refused action - which is a worse answer
   * than a bit that was not written down.
   */
  writeFileSync(join(root, 'blocked'), 'not a directory');
  const said: string[] = [];
  const store = fileSessions({ file: join(root, 'blocked', 'sessions.json'), onProblem: (m) => said.push(m) });
  expect(() => store.setFlags('a', ARCHIVED)).not.toThrow();
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(said.join(' ')).toContain('Could not write');
  // And it is still usable: the bit is in memory even though the file is not.
  expect(store.flags('a')).toBe(ARCHIVED);
});

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
import { createHost } from '../src/host.js';
import { fileSessions, memorySessions } from '../src/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { Principal, Users } from '../src/types/users.js';

const ROOT = 'ahp-root://';
const SESSION = 'ahp-session:/one';
/** `Status.IsArchived`, which is what a client sets when it puts a row away. */
const ARCHIVED = 64;
const READ = 32;
/** The name the daemon would pass from the machine's hostname. */
const HOST = 'builder';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-store-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/** One person, and no teams: enough for a session to have somebody to belong to. */
const ana: Principal = { id: 'ana', roles: [], can: () => true, teams: [{ id: 'backend' }] };

const people = (): Users => ({
  resource: RECORD,
  verify: async (token) => (token === 'ana' ? ana : undefined),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  teams: async () => [{ id: 'backend' }],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

/** A host on this store, with one echo session open, as whoever was asked for. */
async function running(store: SessionStore, who?: { principal?: Principal; root?: boolean }) {
  const host = createHost({
    path: root,
    agents: [echo({ path: root, pace: 0 })],
    sessions: store,
    ...(who === undefined ? {} : { users: people(), hostName: HOST }),
  });
  const client = host.accept(peer(), who?.principal, who?.root === true);
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

it('keeps what the agent recorded, and drops the slot when the last entry goes', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  const one = { id: 'a1', type: 'website', label: 'Docs', isArtifact: false, link: 'https://example.com' };
  store.setArtifacts('a', [one]);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([{ id: 'a', artifacts: [one] }]);
  // Read back by a second store on the same file, which is what a restart is.
  expect(fileSessions({ file }).artifacts('a')).toEqual([one]);
  store.setArtifacts('a', []);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([]);
  expect(memorySessions().artifacts('a')).toBeUndefined();
});

it('keeps the settings a session was given, so a resumed one still has them', async () => {
  const store = memorySessions();
  store.setConfig('one', { voice: 'shouty' });
  expect(store.config('one')).toEqual({ voice: 'shouty' });
  store.forget('one');
  expect(store.config('one')).toBeUndefined();
});

it('keeps the scope a session is charged to across a restart, and forgets it with the session', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  store.setScope('a', { team: 'backend', project: 'ahpd' });
  store.setScope('b', { team: 'frontend' });
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([
    { id: 'a', scope: { team: 'backend', project: 'ahpd' } },
    { id: 'b', scope: { team: 'frontend' } },
  ]);
  // Read back by a second store on the same file, which is what a restart is.
  const second = fileSessions({ file });
  expect(second.scope('a')).toEqual({ team: 'backend', project: 'ahpd' });
  expect(second.scope('b')).toEqual({ team: 'frontend' });
  expect(second.scope('nobody')).toBeUndefined();
  // Charged to nothing on purpose is kept as `null`, apart from never decided.
  second.setScope('c', null);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ file }).scope('c')).toBeNull();
  second.setScope('a', undefined);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ file }).scope('a')).toBeUndefined();
  second.forget('b');
  second.forget('c');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([]);
});

it('keeps a session\'s pull request baseline across a restart, empty included, and forgets it with the session', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  const inherited = { initialPullRequestUrls: ['https://github.com/softov/ahpd/pull/7'], associatedPullRequestUrls: [] };
  // An all-empty baseline is a captured answer - the branch had none - and is
  // not the same as a session nobody asked about.
  const none = { initialPullRequestUrls: [], associatedPullRequestUrls: ['https://github.com/softov/ahpd/pull/9'] };
  store.setPullRequests('a', inherited);
  store.setPullRequests('b', none);
  store.setPullRequests('c', { initialPullRequestUrls: [], associatedPullRequestUrls: [] });
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([
    { id: 'a', pullRequests: inherited },
    { id: 'b', pullRequests: none },
    { id: 'c', pullRequests: { initialPullRequestUrls: [], associatedPullRequestUrls: [] } },
  ]);
  // Read back by a second store on the same file, which is what a restart is.
  const second = fileSessions({ file });
  expect(second.pullRequests('a')).toEqual(inherited);
  expect(second.pullRequests('b')).toEqual(none);
  expect(second.pullRequests('c')).toEqual({ initialPullRequestUrls: [], associatedPullRequestUrls: [] });
  expect(second.pullRequests('nobody')).toBeUndefined();
  second.forget('a');
  await new Promise((tick) => { setTimeout(tick, 5); });
  const after = fileSessions({ file });
  expect(after.pullRequests('a')).toBeUndefined();
  expect(after.pullRequests('b')).toEqual(none);
});

it('keeps whose work a session is across a restart, and forgets it with the session', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  store.setOwner('a', 'user:ana');
  store.setOwner('b', 'root:builder');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([
    { id: 'a', owner: 'user:ana' },
    { id: 'b', owner: 'root:builder' },
  ]);
  // Read back by a second store on the same file, which is what a restart is.
  const second = fileSessions({ file });
  expect(second.owner('a')).toBe('user:ana');
  expect(second.owner('b')).toBe('root:builder');
  expect(second.owner('nobody')).toBeUndefined();
  second.setOwner('a', undefined);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ file }).owner('a')).toBeUndefined();
  second.forget('b');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([]);
  expect(memorySessions().owner('a')).toBeUndefined();
});

it('keeps which harness a session runs on across a restart, and forgets it with the session', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  store.setProvider('a', 'claude');
  store.setProvider('b', 'claude-openrouter');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([
    { id: 'a', provider: 'claude' },
    { id: 'b', provider: 'claude-openrouter' },
  ]);
  // Read back by a second store on the same file, which is what a restart is.
  const second = fileSessions({ file });
  expect(second.provider('a')).toBe('claude');
  expect(second.provider('b')).toBe('claude-openrouter');
  expect(second.provider('nobody')).toBeUndefined();
  second.setProvider('a', undefined);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ file }).provider('a')).toBeUndefined();
  second.forget('b');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([]);
  expect(memorySessions().provider('a')).toBeUndefined();
});

it('reads a row written before harnesses were kept as one nothing was recorded for', () => {
  const file = join(root, 'sessions.json');
  // A version 1 file from a host that had never heard of two harnesses. An
  // upgrade must not drop the sessions in it, so the missing field is read as
  // no answer rather than as a refusal.
  writeFileSync(file, JSON.stringify({ version: 1, sessions: [{ id: 'a', flags: READ }] }));
  const store = fileSessions({ file });
  expect(store.flags('a')).toBe(READ);
  expect(store.provider('a')).toBeUndefined();
  // And one that is not a name at all is ignored rather than guessed at.
  writeFileSync(file, JSON.stringify({ version: 1, sessions: [{ id: 'b', provider: '' }, { id: 'c', provider: 7 }] }));
  const other = fileSessions({ file });
  expect(other.provider('b')).toBeUndefined();
  expect(other.provider('c')).toBeUndefined();
});

it('records no harness on a host with no session yet', () => {
  const store = memorySessions();
  expect(store.provider('one')).toBeUndefined();
});

it('reads a row that names no owner as one nobody owns', () => {
  const file = join(root, 'sessions.json');
  // What a version that did not record owners wrote, and a row whose owner is
  // not a typed reference: both are ignored rather than guessed at.
  writeFileSync(file, JSON.stringify({
    version: 1,
    sessions: [{ id: 'a', flags: READ }, { id: 'b', owner: 'ana' }, { id: 'c', owner: 'user:' }],
  }));
  const store = fileSessions({ file });
  expect(store.flags('a')).toBe(READ);
  expect(store.owner('a')).toBeUndefined();
  expect(store.owner('b')).toBeUndefined();
  expect(store.owner('c')).toBeUndefined();
});

it('records no owner on a host with no directory to name somebody in', async () => {
  const store = memorySessions();
  await running(store);
  expect(store.owner('one')).toBeUndefined();
});

it('names the person who created a session, and the host itself for a root connection', async () => {
  const signed = memorySessions();
  await running(signed, { principal: ana });
  expect(signed.owner('one')).toBe('user:ana');

  // The deployment's own token is the host rather than somebody, and it is
  // named after the daemon so the owner is one a reader can act on.
  const root = memorySessions();
  await running(root, { root: true });
  expect(root.owner('one')).toBe('root:builder');
});

it('keeps the owner beside a session a later daemon resumes', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  await running(store, { principal: ana });
  // The write is coalesced onto the next tick, so this is the restart happening
  // after it rather than a test waiting for nothing.
  await new Promise((tick) => { setTimeout(tick, 5); });

  // A second host on the same file is a daemon that came back, and the session
  // it was asked about still says who it belongs to.
  expect(fileSessions({ file }).owner('one')).toBe('user:ana');
});

it('keeps the titles chats were given, and forgets them with the session', async () => {
  const file = join(root, 'sessions.json');
  const store = fileSessions({ file });
  store.setChatTitle('a', 'ahp-chat:/one', 'Kqueue port');
  store.setChatTitle('a', 'ahp-chat:/two', 'Tests');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([
    { id: 'a', chatTitles: { 'ahp-chat:/one': 'Kqueue port', 'ahp-chat:/two': 'Tests' } },
  ]);
  // Read back by a second store on the same file, which is what a restart is.
  const second = fileSessions({ file });
  expect(second.chatTitle('a', 'ahp-chat:/one')).toBe('Kqueue port');
  expect(second.chatTitle('a', 'ahp-chat:/two')).toBe('Tests');
  expect(second.chatTitle('a', 'ahp-chat:/nobody')).toBeUndefined();
  second.forget('a');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(JSON.parse(readFileSync(file, 'utf8')).sessions).toEqual([]);
  expect(fileSessions({ file }).chatTitle('a', 'ahp-chat:/one')).toBeUndefined();
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

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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { PAGE } from '../src/paging.js';
import { fileSessions, memorySessions } from '../src/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { Bag } from '../src/types/common.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { Principal, Users } from '../src/types/users.js';
import type { Agent, Listed } from '../src/types/agent.js';
import type { MessageAttachment, MessageFrom } from '../src/types/session.js';

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

/**
 * What one session's own file holds, or nothing when it has no file.
 *
 * One file per session is the store's whole shape, so what a case asserts is
 * the file itself - its name included, since the name is what the id had to be
 * made safe for.
 */
const row = (dir: string, id: string): unknown => {
  try { return JSON.parse(readFileSync(join(dir, `${encodeURIComponent(id)}.json`), 'utf8')); }
  catch { return undefined; }
};

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    // A notification is a frame as it goes, which is what a client reads.
    notify: (method, params) => { notes.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/**
 * One person, with a team to charge to: enough for a session to have somebody
 * to belong to, and for a turn of hers to be sent rather than refused.
 */
const ana: Principal = {
  id: 'ana', roles: [], can: () => true, memberships: ['backend'], teams: [{ id: 'backend' }],
};

const people = (): Users => ({
  resource: RECORD,
  verify: async (token) => (token === 'ana' ? ana : undefined),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
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
async function running(
  store: SessionStore,
  who?: { principal?: Principal; root?: boolean },
  agent: Agent = echo({ path: root, pace: 0 }),
) {
  const host = createHost({
    path: root,
    agents: [agent],
    sessions: store,
    ...(who === undefined ? {} : { users: people(), hostName: HOST }),
  });
  const p = peer();
  const client = host.accept(p, who?.principal, who?.root === true);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: SESSION } });
  return { host, client, peer: p };
}

/** The chat the session opened, which the host names and a client may not. */
async function chatOf(
  client: Awaited<ReturnType<typeof running>>['client'],
): Promise<string> {
  const answer = await client.handle({ method: 'subscribe', params: { channel: SESSION } }) as {
    snapshot: { state: { defaultChat?: string } };
  };
  return answer.snapshot.state.defaultChat as string;
}

/** One turn said into a chat, under the id the test calls it. */
const ask = (
  client: Awaited<ReturnType<typeof running>>['client'],
  chat: string,
  turnId: string,
): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: chat, action: { type: 'chat/turnStarted', turnId, message: { text: 'hello there' } } },
});

/** The turns of a chat as a fresh subscribe answer carries them. */
async function turnsOn(
  client: Awaited<ReturnType<typeof running>>['client'],
  chat: string,
): Promise<Bag[]> {
  const answer = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: { turns?: Bag[] } };
  };
  return answer.snapshot.state.turns ?? [];
}

/** The sender a turn's message says it was sent by, or nothing. */
const senderOn = (turn: Bag | undefined): unknown =>
  ((turn?.message as Bag | undefined)?._meta as Bag | undefined)?.['ahpd.sender'];

/**
 * Echo under a backend that writes its turns down its own way.
 *
 * The turn runs as the id the client chose and is written down as one of the
 * backend's own, which it says once through `onTurnRecorded` - the whole of
 * what a backend whose own record names turns its own way, as the Claude
 * CLI's transcript names every turn by its frame uuid, owes the host for a
 * sender to outlive the turn it was sent on.
 */
const naming = (agent: Agent): Agent => ({
  ...agent,
  create: (start) => {
    const written = new Map<string, string>();
    const session = agent.create(start);
    const own = (turn: Bag): Bag => ({ ...turn, id: written.get(String(turn.id)) ?? turn.id });
    return {
      ...session,
      begin: (turnId, text, model, from) => {
        session.begin(turnId, text, model, from);
        // Said after the turn began, because that is when the host knows who
        // sent it - and after in Claude too, where the uuid arrives with the
        // prompt's first echo rather than before the turn was ever announced.
        const id = `x${written.size + 1}`;
        written.set(turnId, id);
        start.onTurnRecorded?.(turnId, id);
      },
      allTurns: () => session.allTurns().map(own),
      chatState: () => {
        const state = session.chatState();
        return { ...state, turns: ((state.turns as Bag[] | undefined) ?? []).map(own) };
      },
    };
  },
});

/**
 * Echo under a backend that writes down what each turn was handed.
 *
 * The words of a message reach a backend as `begin`'s `text` and what was
 * attached to it as an argument of its own, so the record a test reads is what
 * says the host passed the attachment on rather than writing it into the
 * prose - which is the only thing a backend that can see an image would notice.
 */
const watching = (agent: Agent, seen: (MessageAttachment[] | undefined)[]): Agent => ({
  ...agent,
  create: (start) => {
    const session = agent.create(start);
    return {
      ...session,
      begin: (turnId, text, model, from, attachments) => {
        seen.push(attachments);
        session.begin(turnId, text, model, from, attachments);
      },
    };
  },
});

/**
 * Echo under a backend that records what each message was handed about itself.
 *
 * The agent a person picked rides on the message rather than on the action, so
 * the record a test reads is what says the host passed the pick on rather than
 * picking for the person. Read on both `begin` and `queue`, because a message
 * that waited its turn was picked at the moment it was sent, not the moment it
 * ran.
 */
const picking = (agent: Agent, seen: (MessageFrom | undefined)[]): Agent => ({
  ...agent,
  create: (start) => {
    const session = agent.create(start);
    return {
      ...session,
      begin: (turnId, text, model, from, attachments) => {
        seen.push(from);
        session.begin(turnId, text, model, from, attachments);
      },
      queue: (id, text, model, from) => {
        seen.push(from);
        session.queue(id, text, model, from);
      },
    };
  },
});

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

it('hands the attachments on a client\'s message to the backend that begins the turn', async () => {
  const seen: (MessageAttachment[] | undefined)[] = [];
  const { client } = await running(memorySessions(), undefined, watching(echo({ path: root, pace: 0 }), seen));
  const chat = await chatOf(client);
  const shot = { type: 'embeddedResource', label: 'shot.png', data: 'AAAA', contentType: 'image/png' };
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chat,
      action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'what is this?', attachments: [shot] } },
    },
  });
  await new Promise((tick) => { setTimeout(tick, 100); });
  expect(seen).toEqual([[shot]]);
});

it('hands over no attachment at all for a message that carried none', async () => {
  const seen: (MessageAttachment[] | undefined)[] = [];
  const { client } = await running(memorySessions(), undefined, watching(echo({ path: root, pace: 0 }), seen));
  const chat = await chatOf(client);
  await ask(client, chat, 't1');
  await new Promise((tick) => { setTimeout(tick, 100); });
  // Absent rather than an empty list, so a backend can tell a message that
  // carried nothing from one it was handed nothing to look at.
  expect(seen).toEqual([undefined]);
});

it('hands the agent a live message picked to the backend that begins the turn', async () => {
  const seen: (MessageFrom | undefined)[] = [];
  const { client } = await running(memorySessions(), undefined, picking(echo({ path: root, pace: 0 }), seen));
  const chat = await chatOf(client);
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chat,
      action: {
        type: 'chat/turnStarted',
        turnId: 't1',
        message: { text: 'what is this?', origin: { kind: 'user' }, agent: { uri: 'file:///home/ana/.claude/agents/Plan.md' } },
      },
    },
  });
  await new Promise((tick) => { setTimeout(tick, 100); });
  expect(seen).toEqual([{ origin: { kind: 'user' }, agent: { uri: 'file:///home/ana/.claude/agents/Plan.md' } }]);
});

it('hands the agent of a message that carried nothing else but the pick on', async () => {
  const seen: (MessageFrom | undefined)[] = [];
  const { client } = await running(memorySessions(), undefined, picking(echo({ path: root, pace: 0 }), seen));
  const chat = await chatOf(client);
  // Neither `origin` nor `_meta`, which is what a client that only picked an
  // agent and said nothing else sends. Answering undefined here would drop the
  // pick on the one message that was nothing but a pick.
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chat,
      action: {
        type: 'chat/turnStarted',
        turnId: 't1',
        message: { text: 'what is this?', agent: { uri: 'claude-internal:/agent/Explore' } },
      },
    },
  });
  await new Promise((tick) => { setTimeout(tick, 100); });
  expect(seen).toEqual([{ agent: { uri: 'claude-internal:/agent/Explore' } }]);
});

it('hands over nothing at all for a message that picked no agent', async () => {
  const seen: (MessageFrom | undefined)[] = [];
  const { client } = await running(memorySessions(), undefined, picking(echo({ path: root, pace: 0 }), seen));
  const chat = await chatOf(client);
  await ask(client, chat, 't1');
  await new Promise((tick) => { setTimeout(tick, 100); });
  // An `agent` of no uri is no pick, and the message said nothing else either.
  expect(seen).toEqual([undefined]);
});

it('hands the agent of a queued message to the backend before the turn runs', async () => {
  const seen: (MessageFrom | undefined)[] = [];
  const { client } = await running(memorySessions(), undefined, picking(echo({ path: root, pace: 0 }), seen));
  const chat = await chatOf(client);
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chat,
      action: {
        type: 'chat/pendingMessageSet',
        kind: 'queued',
        id: 'q1',
        message: { text: 'and then this', agent: { uri: 'claude-internal:/agent/Plan' } },
      },
    },
  });
  await new Promise((tick) => { setTimeout(tick, 100); });
  expect(seen).toEqual([{ agent: { uri: 'claude-internal:/agent/Plan' } }]);
});

it('hands the agent of the first message of a session that was not running to the backend that resumes it', async () => {
  const seen: (MessageFrom | undefined)[] = [];
  const store = memorySessions();
  const agent = picking(echo({ path: root, pace: 0 }), seen);
  const first = await running(store, undefined, agent);
  const chat = await chatOf(first.client);
  await ask(first.client, chat, 't1');
  await new Promise((tick) => { setTimeout(tick, 100); });
  await first.client.handle({ method: 'disposeSession', params: { channel: SESSION } });
  await new Promise((tick) => { setTimeout(tick, 20); });
  seen.length = 0;

  // A daemon that came back, said the first thing about a row it has never
  // listed: the catalogue teaches it whose the row is and the turn starts it.
  const second = await running(store, undefined, agent);
  await second.client.handle({ method: 'listSessions', params: { channel: ROOT } });
  await second.client.handle({
    method: 'dispatchAction',
    params: {
      channel: `ahp-chat:/one`,
      action: {
        type: 'chat/turnStarted',
        turnId: 't2',
        message: { text: 'again', agent: { uri: 'claude-internal:/agent/Plan' } },
      },
    },
  });
  await new Promise((tick) => { setTimeout(tick, 100); });
  expect(seen).toEqual([{ agent: { uri: 'claude-internal:/agent/Plan' } }]);
});

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
  const dir = join(root, 'sessions');
  const first = await running(fileSessions({ dir }));
  await archive(first.client);
  // The write is coalesced onto the next tick, so this is the restart
  // happening after it rather than a test waiting for nothing.
  await new Promise((tick) => { setTimeout(tick, 5); });

  const second = await running(fileSessions({ dir }));
  expect(await statusOf(second.client) & ARCHIVED).toBe(ARCHIVED);
});

it('keeps one file per session, and writes only the one that changed', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  store.setFlags('a', READ);
  store.setFlags('b', ARCHIVED);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(readdirSync(dir).sort()).toEqual(['a.json', 'b.json']);

  // A change to one is one write: what the daemon keeps follows the sessions
  // that exist, and rewriting every row to say one of them moved is what this
  // store stopped doing.
  const before = statSync(join(dir, 'b.json')).mtimeMs;
  await new Promise((tick) => { setTimeout(tick, 20); });
  store.setFlags('a', READ | ARCHIVED);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({ version: 1, id: 'a', flags: READ | ARCHIVED });
  expect(statSync(join(dir, 'b.json')).mtimeMs).toBe(before);
});

it('reads back an id that is not a file name as it stands', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  // An id is an opaque key, and these are the two a backend is most likely to
  // hand out: a fragment and a URI.
  for (const id of ['claude:/one', 'agent-host:session/two', 'a b']) store.setProvider(id, 'claude');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(readdirSync(dir).sort()).toEqual(['a%20b.json', 'agent-host%3Asession%2Ftwo.json', 'claude%3A%2Fone.json']);

  const second = fileSessions({ dir });
  for (const id of ['claude:/one', 'agent-host:session/two', 'a b']) expect(second.provider(id)).toBe('claude');
});

it('writes nothing for a session nobody flagged', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  // Read and then cleared: back where it started, so there is nothing about
  // this session worth a file a daemon carries for months.
  store.setFlags('a', READ);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({ version: 1, id: 'a', flags: READ });
  store.setFlags('a', 0);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toBeUndefined();
});

/**
 * A row the version before this plan wrote, with every field it could hold.
 *
 * The bytes are the point of the case below: a store that reads this writes it
 * back the same way, so a row is not quietly reordered by being read.
 */
const WRITTEN = `{
  "version": 1,
  "id": "a",
  "flags": 64,
  "config": {
    "voice": "shouty"
  },
  "scope": {
    "team": "backend",
    "project": "ahpd"
  },
  "owner": "user:ana",
  "senders": {
    "turn-1": "user:ana"
  },
  "provider": "claude",
  "artifacts": [
    {
      "id": "a1",
      "type": "website",
      "label": "Docs",
      "isArtifact": false,
      "link": "https://example.com"
    }
  ],
  "pullRequests": {
    "initialPullRequestUrls": [
      "https://github.com/softov/ahpd/pull/7"
    ],
    "associatedPullRequestUrls": []
  },
  "chatTitles": {
    "ahp-chat:/one": "Kqueue port"
  },
  "parent": "parent-1",
  "nested": {
    "provider": "cofold",
    "machine": "box",
    "inner": "n1",
    "title": "In the box",
    "createdAt": "2026-10-06T10:00:00.000Z",
    "modifiedAt": "2026-10-06T10:05:00.000Z",
    "workingDirectories": [
      "file:///srv/app"
    ]
  }
}
`;

it('reads a row written before this version whole, and writes it back as it was', async () => {
  const dir = join(root, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.json'), WRITTEN);

  const store = fileSessions({ dir });
  expect(store.flags('a')).toBe(ARCHIVED);
  expect(store.config('a')).toEqual({ voice: 'shouty' });
  expect(store.scope('a')).toEqual({ team: 'backend', project: 'ahpd' });
  expect(store.owner('a')).toBe('user:ana');
  expect(store.sender('a', 'turn-1')).toBe('user:ana');
  expect(store.provider('a')).toBe('claude');
  expect(store.artifacts('a')).toEqual([
    { id: 'a1', type: 'website', label: 'Docs', isArtifact: false, link: 'https://example.com' },
  ]);
  expect(store.pullRequests('a')).toEqual({
    initialPullRequestUrls: ['https://github.com/softov/ahpd/pull/7'],
    associatedPullRequestUrls: [],
  });
  expect(store.chatTitle('a', 'ahp-chat:/one')).toBe('Kqueue port');
  expect(store.parent?.('a')).toBe('parent-1');
  expect(store.nested?.('a')?.machine).toBe('box');

  // A change that leaves the row as it was is still a write of it, and what it
  // writes is the bytes it read: the field order on disk is the file's rather
  // than the order the fields happened to be set in.
  store.setFlags('a', ARCHIVED);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe(WRITTEN);
});

it('forgets a session that was disposed, rather than keeping its bits for ever', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  const { client } = await running(store);
  await archive(client);
  await client.handle({ method: 'disposeSession', params: { channel: SESSION } });
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'one')).toBeUndefined();
});

it('keeps what the agent recorded, and drops the file when the last entry goes', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  const one = { id: 'a1', type: 'website', label: 'Docs', isArtifact: false, link: 'https://example.com' };
  store.setArtifacts('a', [one]);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({ version: 1, id: 'a', artifacts: [one] });
  // Read back by a second store on the same folder, which is what a restart is.
  expect(fileSessions({ dir }).artifacts('a')).toEqual([one]);
  store.setArtifacts('a', []);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toBeUndefined();
  expect(memorySessions().artifacts('a')).toBeUndefined();
});

it('keeps the settings a session was given, so a resumed one still has them', async () => {
  const store = memorySessions();
  store.setConfig('one', { voice: 'shouty' });
  expect(store.config('one')).toEqual({ voice: 'shouty' });
  store.forget('one');
  expect(store.config('one')).toBeUndefined();
});

it('keeps no row for a session whose every field was set back to nothing', () => {
  const store = memorySessions();
  // A flag read and cleared, and a sender taken back: back where it started, so
  // there is no row left for a listing to carry for months.
  store.setFlags('a', READ);
  store.setFlags('a', 0);
  store.setSender('a', 'turn-1', 'user:ana');
  store.setSender('a', 'turn-1', undefined);

  // A session nothing is left about is not one a prune sees at all, and an
  // always-true predicate is asked about every id the store holds.
  const asked: string[] = [];
  store.prune?.((id) => { asked.push(id); return true; });
  expect(asked).toEqual([]);
  expect(store.flags('a')).toBe(0);
});

it('forgets a session entirely, whatever was set on it', () => {
  const store = memorySessions();
  store.setFlags('a', ARCHIVED);
  store.setConfig('a', { voice: 'shouty' });
  store.setScope('a', { team: 'backend', project: 'ahpd' });
  store.setOwner('a', 'user:ana');
  store.setSender('a', 'turn-1', 'user:ana');
  store.setProvider('a', 'claude');

  store.forget('a');

  expect(store.flags('a')).toBe(0);
  expect(store.config('a')).toBeUndefined();
  expect(store.scope('a')).toBeUndefined();
  expect(store.owner('a')).toBeUndefined();
  expect(store.sender('a', 'turn-1')).toBeUndefined();
  expect(store.provider('a')).toBeUndefined();
});

it('keeps the scope a session is charged to across a restart, and forgets it with the session', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  store.setScope('a', { team: 'backend', project: 'ahpd' });
  store.setScope('b', { team: 'frontend' });
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({ version: 1, id: 'a', scope: { team: 'backend', project: 'ahpd' } });
  expect(row(dir, 'b')).toEqual({ version: 1, id: 'b', scope: { team: 'frontend' } });
  // Read back by a second store on the same folder, which is what a restart is.
  const second = fileSessions({ dir });
  expect(second.scope('a')).toEqual({ team: 'backend', project: 'ahpd' });
  expect(second.scope('b')).toEqual({ team: 'frontend' });
  expect(second.scope('nobody')).toBeUndefined();
  // Charged to nothing on purpose is kept as `null`, apart from never decided.
  second.setScope('c', null);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ dir }).scope('c')).toBeNull();
  second.setScope('a', undefined);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ dir }).scope('a')).toBeUndefined();
  second.forget('b');
  second.forget('c');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'b')).toBeUndefined();
  expect(row(dir, 'c')).toBeUndefined();
});

it('keeps a session\'s pull request baseline across a restart, empty included, and forgets it with the session', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  const inherited = { initialPullRequestUrls: ['https://github.com/softov/ahpd/pull/7'], associatedPullRequestUrls: [] };
  // An all-empty baseline is a captured answer - the branch had none - and is
  // not the same as a session nobody asked about.
  const none = { initialPullRequestUrls: [], associatedPullRequestUrls: ['https://github.com/softov/ahpd/pull/9'] };
  store.setPullRequests('a', inherited);
  store.setPullRequests('b', none);
  store.setPullRequests('c', { initialPullRequestUrls: [], associatedPullRequestUrls: [] });
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({ version: 1, id: 'a', pullRequests: inherited });
  expect(row(dir, 'b')).toEqual({ version: 1, id: 'b', pullRequests: none });
  expect(row(dir, 'c')).toEqual({
    version: 1, id: 'c', pullRequests: { initialPullRequestUrls: [], associatedPullRequestUrls: [] },
  });
  // Read back by a second store on the same folder, which is what a restart is.
  const second = fileSessions({ dir });
  expect(second.pullRequests('a')).toEqual(inherited);
  expect(second.pullRequests('b')).toEqual(none);
  expect(second.pullRequests('c')).toEqual({ initialPullRequestUrls: [], associatedPullRequestUrls: [] });
  expect(second.pullRequests('nobody')).toBeUndefined();
  second.forget('a');
  await new Promise((tick) => { setTimeout(tick, 5); });
  const after = fileSessions({ dir });
  expect(after.pullRequests('a')).toBeUndefined();
  expect(after.pullRequests('b')).toEqual(none);
});

it('keeps whose work a session is across a restart, and forgets it with the session', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  store.setOwner('a', 'user:ana');
  store.setOwner('b', 'root:builder');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({ version: 1, id: 'a', owner: 'user:ana' });
  expect(row(dir, 'b')).toEqual({ version: 1, id: 'b', owner: 'root:builder' });
  // Read back by a second store on the same folder, which is what a restart is.
  const second = fileSessions({ dir });
  expect(second.owner('a')).toBe('user:ana');
  expect(second.owner('b')).toBe('root:builder');
  expect(second.owner('nobody')).toBeUndefined();
  second.setOwner('a', undefined);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ dir }).owner('a')).toBeUndefined();
  second.forget('b');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'b')).toBeUndefined();
  expect(memorySessions().owner('a')).toBeUndefined();
});

it('keeps who sent each turn across a restart, and forgets it with the session', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  store.setOwner('a', 'user:ana');
  // Two turns, two people, one session: the turn is the only thing that says
  // which of them it was.
  store.setSender('a', 'turn-1', 'user:ana');
  store.setSender('a', 'turn-2', 'user:bo');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({
    version: 1, id: 'a', owner: 'user:ana', senders: { 'turn-1': 'user:ana', 'turn-2': 'user:bo' },
  });
  // Read back by a second store on the same folder, which is what a restart is.
  const second = fileSessions({ dir });
  expect(second.sender('a', 'turn-1')).toBe('user:ana');
  expect(second.sender('a', 'turn-2')).toBe('user:bo');
  expect(second.sender('a', 'turn-never')).toBeUndefined();
  expect(second.sender('nobody', 'turn-1')).toBeUndefined();
  // A sender cleared with `undefined` leaves nothing worth a file, the way a
  // flag read and cleared does.
  second.setSender('a', 'turn-1', undefined);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ dir }).sender('a', 'turn-1')).toBeUndefined();
  second.forget('a');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toBeUndefined();
  expect(memorySessions().sender('a', 'turn-2')).toBeUndefined();
});

it('keeps which harness a session runs on across a restart, and forgets it with the session', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  store.setProvider('a', 'claude');
  store.setProvider('b', 'claude-openrouter');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({ version: 1, id: 'a', provider: 'claude' });
  expect(row(dir, 'b')).toEqual({ version: 1, id: 'b', provider: 'claude-openrouter' });
  // Read back by a second store on the same folder, which is what a restart is.
  const second = fileSessions({ dir });
  expect(second.provider('a')).toBe('claude');
  expect(second.provider('b')).toBe('claude-openrouter');
  expect(second.provider('nobody')).toBeUndefined();
  second.setProvider('a', undefined);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(fileSessions({ dir }).provider('a')).toBeUndefined();
  second.forget('b');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'b')).toBeUndefined();
  expect(memorySessions().provider('a')).toBeUndefined();
});

it('keeps a session\'s attachments in a folder of its own, whatever the id says', () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  const attachments = join(dir, 'attachments');
  /*
   * An id is an opaque key, and three of them name the folder they are written
   * in rather than one under it: `.` is that folder, `..` is the one above it,
   * and an empty id names the folder itself. A session called any of the three
   * keeps its attachments among every session's, or beside the sessions
   * directory, where removing it takes the lot. So each gets a folder of its
   * own, and a name no other id produces.
   */
  const ids = ['..', '.', 'a/../..', ''];
  const folders = ids.map((id) => store.attachmentsDir?.(id));
  for (const folder of folders) {
    expect(typeof folder).toBe('string');
    // Directly under the root, which is what strictly inside it means.
    expect(dirname(folder as string)).toBe(attachments);
  }
  expect(new Set(folders).size).toBe(ids.length);
});

it('removes a session\'s own attachments with it, and no other session\'s', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  // One session nobody removes: its row, its folder and the file in it are what
  // a removal of another session has to leave where they are.
  store.setFlags('keep', READ);
  const kept = store.attachmentsDir?.('keep') as string;
  mkdirSync(kept, { recursive: true });
  writeFileSync(join(kept, 'shot.png'), 'png');
  await new Promise((tick) => { setTimeout(tick, 5); });

  const ids = ['..', '.', 'a/../..', ''];
  for (const id of ids) {
    const folder = store.attachmentsDir?.(id) as string;
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'shot.png'), 'png');
    store.forget(id);
  }
  await new Promise((tick) => { setTimeout(tick, 5); });

  expect(existsSync(dir)).toBe(true);
  expect(existsSync(join(dir, 'keep.json'))).toBe(true);
  expect(existsSync(join(kept, 'shot.png'))).toBe(true);
  for (const id of ids) {
    expect(existsSync(store.attachmentsDir?.(id) as string)).toBe(false);
  }
});

it('reads a row written before harnesses were kept as one nothing was recorded for', () => {
  const dir = join(root, 'sessions');
  mkdirSync(dir, { recursive: true });
  // A version 1 row from a host that had never heard of two harnesses. An
  // upgrade must not drop the sessions in it, so the missing field is read as
  // no answer rather than as a refusal.
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ version: 1, id: 'a', flags: READ }));
  const store = fileSessions({ dir });
  expect(store.flags('a')).toBe(READ);
  expect(store.provider('a')).toBeUndefined();
  // And one that is not a name at all is ignored rather than guessed at.
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ version: 1, id: 'b', provider: '' }));
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ version: 1, id: 'c', provider: 7 }));
  const other = fileSessions({ dir });
  expect(other.provider('b')).toBeUndefined();
  expect(other.provider('c')).toBeUndefined();
});

it('records no harness on a host with no session yet', () => {
  const store = memorySessions();
  expect(store.provider('one')).toBeUndefined();
});

it('reads a row that names no owner as one nobody owns', () => {
  const dir = join(root, 'sessions');
  mkdirSync(dir, { recursive: true });
  // What a version that did not record owners wrote, and a row whose owner is
  // not a typed reference: both are ignored rather than guessed at. A turn's
  // sender is held to the same rule, one value at a time.
  const write = (id: string, one: Record<string, unknown>): void => {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ version: 1, id, ...one }));
  };
  write('a', { flags: READ });
  write('b', { owner: 'ana' });
  write('c', { owner: 'user:' });
  write('d', { owner: 'user:ana', senders: { t1: 'ana', t2: 'user:', t3: 'user:bo' } });
  const store = fileSessions({ dir });
  expect(store.flags('a')).toBe(READ);
  expect(store.owner('a')).toBeUndefined();
  expect(store.owner('b')).toBeUndefined();
  expect(store.owner('c')).toBeUndefined();
  expect(store.sender('d', 't1')).toBeUndefined();
  expect(store.sender('d', 't2')).toBeUndefined();
  expect(store.sender('d', 't3')).toBe('user:bo');
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
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  await running(store, { principal: ana });
  // The write is coalesced onto the next tick, so this is the restart happening
  // after it rather than a test waiting for nothing.
  await new Promise((tick) => { setTimeout(tick, 5); });

  // A second host on the same file is a daemon that came back, and the session
  // it was asked about still says who it belongs to.
  expect(fileSessions({ dir }).owner('one')).toBe('user:ana');
});

it('says on the wire who sent a turn and whose a session is, and keeps it past a restart', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  const { client } = await running(store, { principal: ana });
  const chat = await chatOf(client);
  await client.handle({ method: 'subscribe', params: { channel: chat } });

  // The row says whose work this is, before a word has been said in it.
  const row = (await client.handle({ method: 'subscribe', params: { channel: SESSION } }) as {
    snapshot: { state: { _meta?: Bag } };
  }).snapshot.state;
  expect(row._meta?.['ahpd.owner']).toBe('user:ana');

  await ask(client, chat, 'turn-1');
  await new Promise((tick) => { setTimeout(tick, 100); });
  const turns = await turnsOn(client, chat);
  expect(senderOn(turns[0])).toBe('user:ana');

  /*
   * And the answer outlives the process, which is the whole of what the store
   * is for: a session read out of its transcript after a restart asks a second
   * store on this file, and not the map this host let go of at turn end.
   */
  await new Promise((tick) => { setTimeout(tick, 5); });
  const after = fileSessions({ dir });
  expect(after.owner('one')).toBe('user:ana');
  expect(after.sender('one', 'turn-1')).toBe('user:ana');
});

it('keeps a turn\'s sender under the id the backend wrote it down as, so a history read back still names it', async () => {
  const store = memorySessions();
  const { client } = await running(store, { principal: ana }, naming(echo({ path: root, pace: 0 })));
  const chat = await chatOf(client);
  await client.handle({ method: 'subscribe', params: { channel: chat } });

  await ask(client, chat, 't1');
  await new Promise((tick) => { setTimeout(tick, 100); });

  /*
   * The turn read back under the id this backend wrote it as, which is what a
   * Claude turn is named by once the daemon has restarted. Kept there as well
   * as under `t1`, so the sender is still there to be found.
   */
  const turns = await turnsOn(client, chat);
  expect(turns.map((turn) => String(turn.id))).toEqual(['x1']);
  expect(senderOn(turns[0])).toBe('user:ana');
  expect(store.sender('one', 'x1')).toBe('user:ana');
  // And the id the client chose still finds it, for a turn read while the
  // daemon is the one that ran it.
  expect(store.sender('one', 't1')).toBe('user:ana');
});

it('says neither who sent a turn nor whose a session is when the host has no directory', async () => {
  const store = memorySessions();
  const { client } = await running(store);
  const chat = await chatOf(client);
  await client.handle({ method: 'subscribe', params: { channel: chat } });

  const row = (await client.handle({ method: 'subscribe', params: { channel: SESSION } }) as {
    snapshot: { state: { _meta?: Bag } };
  }).snapshot.state;
  expect(row._meta).toBeUndefined();

  await ask(client, chat, 'turn-1');
  await new Promise((tick) => { setTimeout(tick, 100); });
  const turns = await turnsOn(client, chat);
  expect(turns).toHaveLength(1);
  expect((turns[0]?.message as Bag | undefined)?._meta).toBeUndefined();
});

it('says who sent a turn on the oldest page too, not only on the tail window', async () => {
  const store = memorySessions();
  const { client, peer: on } = await running(store, { principal: ana });
  const chat = await chatOf(client);
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  // More than a snapshot's worth, so there is a page before the one it carried.
  const said = PAGE + 10;
  for (let at = 0; at < said; at++) await ask(client, chat, `turn-${at}`);
  await new Promise((tick) => { setTimeout(tick, 200); });
  expect(await turnsOn(client, chat)).toHaveLength(said);

  await client.handle({ method: 'fetchTurns', params: { channel: chat } });
  await new Promise((tick) => { setTimeout(tick, 20); });
  const page = on.notes
    .filter((note) => note.method === 'action')
    .map((note) => (note.params as { action: Bag }).action)
    .find((action) => action.type === 'chat/turnsLoaded') as { turns?: Bag[] } | undefined;
  expect(page?.turns).toHaveLength(10);
  // The ten oldest, which is the whole of what this case is about.
  expect(page?.turns?.map((turn) => String(turn.id))).toEqual(Array.from({ length: 10 }, (_, at) => `turn-${at}`));
  expect(page?.turns?.map(senderOn)).toEqual(Array(10).fill('user:ana'));
});

it('keeps the titles chats were given, and forgets them with the session', async () => {
  const dir = join(root, 'sessions');
  const store = fileSessions({ dir });
  store.setChatTitle('a', 'ahp-chat:/one', 'Kqueue port');
  store.setChatTitle('a', 'ahp-chat:/two', 'Tests');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toEqual({
    version: 1, id: 'a', chatTitles: { 'ahp-chat:/one': 'Kqueue port', 'ahp-chat:/two': 'Tests' },
  });
  // Read back by a second store on the same folder, which is what a restart is.
  const second = fileSessions({ dir });
  expect(second.chatTitle('a', 'ahp-chat:/one')).toBe('Kqueue port');
  expect(second.chatTitle('a', 'ahp-chat:/two')).toBe('Tests');
  expect(second.chatTitle('a', 'ahp-chat:/nobody')).toBeUndefined();
  second.forget('a');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'a')).toBeUndefined();
  expect(fileSessions({ dir }).chatTitle('a', 'ahp-chat:/one')).toBeUndefined();
});

it('keeps the record of a nested session across a restart, lists it, and forgets it with the session', async () => {
  const dir = join(root, 'sessions');
  const record = {
    provider: 'cofold', machine: 'box', inner: 'n1', title: 'In the box',
    createdAt: '2026-10-06T10:00:00.000Z', modifiedAt: '2026-10-06T10:05:00.000Z', workingDirectories: ['file:///srv/app'],
  };
  const store = fileSessions({ dir });
  store.setNested?.('n1', record);
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'n1')).toEqual({ version: 1, id: 'n1', nested: record });
  const second = fileSessions({ dir });
  expect(second.nested?.('n1')).toEqual(record);
  expect(second.nestedSessions?.()).toEqual([['n1', record]]);
  // A file a version before this one wrote has no record, and still reads.
  writeFileSync(join(dir, 'old.json'), JSON.stringify({ version: 1, id: 'old', provider: 'cofold' }));
  const third = fileSessions({ dir });
  expect(third.nested?.('old')).toBeUndefined();
  expect(third.provider('old')).toBe('cofold');
  // A record missing what a listing needs is ignored rather than guessed at.
  writeFileSync(join(dir, 'half.json'), JSON.stringify({ version: 1, id: 'half', nested: { provider: 'cofold' } }));
  expect(fileSessions({ dir }).nested?.('half')).toBeUndefined();
  third.forget('n1');
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'n1')).toBeUndefined();
});

it('starts empty and says so when a file cannot be read', () => {
  const dir = join(root, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.json'), 'this is not json');
  const said: string[] = [];
  const store = fileSessions({ dir, onProblem: (message) => said.push(message) });
  // A warning and an empty store, never a refusal: losing which rows were
  // archived is worth saying out loud, and is not worth refusing to start over.
  expect(store.flags('anything')).toBe(0);
  expect(said.join(' ')).toContain('Could not read');
});

it('skips a file it cannot read and reads the others', () => {
  const dir = join(root, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.json'), 'this is not json');
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ version: 1, id: 'b', flags: READ }));
  const said: string[] = [];
  const store = fileSessions({ dir, onProblem: (message) => said.push(message) });
  expect(store.flags('a')).toBe(0);
  expect(store.flags('b')).toBe(READ);
  expect(said.join(' ')).toContain('Could not read');
});

it('ignores a file written by a version that shaped it differently', () => {
  const dir = join(root, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ version: 2, id: 'a', flags: 64 }));
  const said: string[] = [];
  const store = fileSessions({ dir, onProblem: (message) => said.push(message) });
  expect(store.flags('a')).toBe(0);
  expect(said.join(' ')).toContain('not a session store this version can read');
});

it('forgets a session in a directory it read, and keeps one in a directory it did not', async () => {
  const dir = join(root, 'sessions');
  const worktree = join(root, '.worktrees', 'ahpd');
  // Two rows a daemon that ran both of these sessions carries, with the provider
  // it recorded for each: one opened here, one opened in a git worktree.
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'near.json'), JSON.stringify({ version: 1, id: 'near', flags: ARCHIVED, provider: 'echo' }));
  writeFileSync(join(dir, 'far.json'), JSON.stringify({ version: 1, id: 'far', flags: ARCHIVED, provider: 'echo' }));
  const store = fileSessions({ dir });

  /*
   * What a real catalogue is: the paths the harness was configured with, and
   * nothing else. A session opened in a worktree ran somewhere no listing has
   * ever read, which is why its row must not be read as a session that went.
   */
  let offered: Listed[] = [
    { id: 'near', title: 'Near', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', workingDirectories: [`file://${root}`] },
    { id: 'far', title: 'Far', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', workingDirectories: [`file://${worktree}`] },
  ];
  const { client } = await running(store, undefined, { ...echo({ path: root, pace: 0 }), list: async () => offered });
  // Both listed once, so this host knows where each of them ran.
  await client.handle({ method: 'listSessions', params: { channel: ROOT } });
  // Then both transcripts are deleted outside ahpd, and no backend lists either.
  offered = [];
  await client.handle({ method: 'listSessions', params: { channel: ROOT } });
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'near')).toBeUndefined();
  expect(store.flags('near')).toBe(0);
  // The one in the worktree was never in anything this host read, so its owner
  // and its bits are still worth keeping.
  expect(row(dir, 'far')).toMatchObject({ version: 1, id: 'far', flags: ARCHIVED });
  expect(store.flags('far')).toBe(ARCHIVED);
});

it('forgets nothing when a backend refused to list', async () => {
  const dir = join(root, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'gone.json'), JSON.stringify({ version: 1, id: 'gone', flags: ARCHIVED }));
  const store = fileSessions({ dir });
  // A second harness that is not signed in lists nothing, and says so by
  // refusing: every row it would have offered would look like a transcript
  // deleted outside this host, so nothing at all may go.
  const offline: Agent = {
    ...echo({ path: root, pace: 0 }),
    provider: 'offline',
    list: async () => { throw new Error('not signed in'); },
  };
  const host = createHost({ path: root, agents: [echo({ path: root, pace: 0 }), offline], sessions: store });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'listSessions', params: { channel: ROOT } });
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(row(dir, 'gone')).toEqual({ version: 1, id: 'gone', flags: ARCHIVED });
  expect(store.flags('gone')).toBe(ARCHIVED);
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
  const store = fileSessions({ dir: join(root, 'blocked', 'sessions'), onProblem: (m) => said.push(m) });
  expect(() => store.setFlags('a', ARCHIVED)).not.toThrow();
  await new Promise((tick) => { setTimeout(tick, 5); });
  expect(said.join(' ')).toContain('Could not write');
  // And it is still usable: the bit is in memory even though the file is not.
  expect(store.flags('a')).toBe(ARCHIVED);
});

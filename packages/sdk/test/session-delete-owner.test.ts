import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { chatUriFor } from '../src/host/channels.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import { hostTools } from '../src/tools/index.js';
import type { Agent, BoundTool, Start } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { Principal, Users } from '../src/types/users.js';

/*
 * Whose session a delete may end.
 *
 * `session:write` is a group of operations on sessions, and `session:dispose` is
 * one of them, so a member of a shared host passes the gate on `disposeSession`
 * without ever being asked whose the session is. A delete is not a write: it
 * cannot be undone, and the backend's own transcript goes with it.
 *
 * So it takes the owner or `session:*`. Every member in this file holds the
 * write half, and what differs between them is only whose the session is -
 * the one case that must not go through is a member deleting a colleague's.
 */

// Resolved, as the host spells the folder it serves: `C:\tmp\...` on Windows.
const DIR = resolve('/tmp/ahpd-delete-owner');
const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/** A person whose role hands out these grants, groups and wildcards included. */
const holding = (id: string, grants: readonly string[]): Principal => ({
  id,
  roles: grants,
  can: (grant) => grants.includes(grant)
    // `session:dispose` is one operation of the `session:write` group, which is
    // how an ordinary member reaches the command at all.
    || (grant === 'session:dispose' && grants.includes('session:write'))
    // And a chat's group is its session's, which is how the same member says a
    // turn - the one thing a case that wants a tool to carry a person has to be
    // able to do.
    || (grant.startsWith('chat:') && grants.includes('session:write'))
    // `session:*` is every operation on sessions, as an administrator's role
    // resolves it.
    || (grants.includes('session:*') && grant.startsWith('session:')),
});

/** The owner: writes and disposes, and holds no wildcard over sessions. */
const ana = holding('ana', ['session:write', 'session:read', 'session:create', 'session:list']);
/** A colleague, on the same member role, so the gate admits them identically. */
const bob = holding('bob', ['session:write', 'session:read', 'session:create', 'session:list']);
/** Whoever administers the host, whose role resolves to the wildcard. */
const admin = holding('admin', ['session:*']);

const directory = (): Users => ({
  resource: RECORD,
  verify: async (token) => (token === 'ana' ? ana : token === 'bob' ? bob : token === 'admin' ? admin : undefined),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => { notes.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/**
 * The example backend with a record of what it was asked to delete.
 *
 * It also keeps the tools its last `create` was handed, because a session's
 * tools are bound per session and that is how a case calls one.
 *
 * `pace` is how long the echo backend takes between words. It is zero for every
 * case that never runs a turn, and a whole number of milliseconds for the ones
 * that do: a turn is what a tool call carries, and a turn that answered all at
 * once would be over before the call was made.
 */
function backend(pace = 0) {
  const base = echo({ path: DIR, pace });
  const deleted: { id: string; directory: string | undefined }[] = [];
  let offered: BoundTool[] = [];
  const agent: Agent = {
    ...base,
    provider: 'echo',
    displayName: 'Echo backend',
    delete: async (id, directory) => { deleted.push({ id, directory }); },
    create: (start: Start) => {
      offered = start.tools ?? [];
      return base.create(start);
    },
  };
  return {
    agent,
    deleted,
    /** The tools the session this backend last started was handed, by name. */
    tools: (): Record<string, BoundTool> => Object.fromEntries(offered.map((one) => [one.definition.name, one])),
  };
}

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** A host with people in it, and a signed-in client for each token. */
async function serving(tokens: readonly string[], pace = 0) {
  const back = backend(pace);
  const host = createHost({ path: DIR, agents: [back.agent], users: directory(), tools: hostTools() });
  const clients: Record<string, Client> = {};
  for (const token of tokens) clients[token] = await signedIn(host, token);
  return { host, back, clients };
}

/** One connection, introduced and signed in as whoever the token names. */
async function signedIn(host: ReturnType<typeof createHost>, token?: string): Promise<Client> {
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: token ?? 'anon', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  if (token === undefined) return client;
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token },
  });
  return client;
}

const open = (client: Client, name: string): Promise<unknown> =>
  client.handle({ method: 'createSession', params: { channel: `ahp-session:/${name}`, provider: 'echo' } });

/**
 * A client says a turn has begun in one session, which is what a tool carries.
 *
 * A session tool acts as the person of the turn it runs in, so a case that
 * wants a tool to act as somebody has to put that somebody in a turn. The turn
 * is left running: the backend is paced, and the call is made while its words
 * are still arriving. The channel is the session's default chat, the chat a
 * client says something to the session as a whole in.
 */
const saying = (client: Client, name: string, text: string): Promise<unknown> =>
  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUriFor(`ahp-session:/${name}`),
      action: { type: 'chat/turnStarted', turnId: crypto.randomUUID(), message: { text } },
    },
  });

const dispose = (client: Client, name: string): Promise<unknown> =>
  client.handle({ method: 'disposeSession', params: { channel: `ahp-session:/${name}` } });

/** The sessions a client is shown, as the names a tool would be given. */
const listed = async (client: Client): Promise<string[]> =>
  ((await client.handle({ method: 'listSessions', params: { channel: ROOT } })) as { items?: { resource?: string }[] })
    .items?.map((one) => one.resource ?? '') ?? [];

it('lets the owner delete their own session', async () => {
  const { back, clients } = await serving(['ana']);
  await open(clients.ana!, 'mine');

  await dispose(clients.ana!, 'mine');

  expect(back.deleted).toEqual([{ id: 'mine', directory: DIR }]);
  expect(await listed(clients.ana!)).not.toContain('ahp-session:/mine');
});

it('lets a caller holding session:* delete a session that is not theirs', async () => {
  const { back, clients } = await serving(['ana', 'admin']);
  await open(clients.ana!, 'theirs');

  await dispose(clients.admin!, 'theirs');

  expect(back.deleted).toEqual([{ id: 'theirs', directory: DIR }]);
});

it('refuses a member who is neither the owner nor a session:* holder, and deletes nothing', async () => {
  const { back, clients } = await serving(['ana', 'bob']);
  await open(clients.ana!, 'theirs');

  // Bob holds `session:write`, so the gate admits him and this check is the
  // only thing standing between a colleague and a permanent delete.
  await expect(dispose(clients.bob!, 'theirs')).rejects.toMatchObject({
    code: -32009,
    message: "Only the session's owner can delete it.",
  });

  expect(back.deleted).toEqual([]);
  // And the session is whole, since the refusal comes before the teardown.
  expect(await listed(clients.ana!)).toContain('ahp-session:/theirs');
});

it('refuses nothing on a host with no users directory', async () => {
  // No directory means no principal means nobody to name, so this host is
  // exactly as open as it was before there was an owner to check.
  const back = backend();
  const host = createHost({ path: DIR, agents: [back.agent], tools: hostTools() });
  const client = await signedIn(host);
  await open(client, 'anyones');

  await dispose(client, 'anyones');

  expect(back.deleted).toEqual([{ id: 'anyones', directory: DIR }]);
});

it('lets the delete_session tool delete a session its own owner made', async () => {
  const { back, clients } = await serving(['ana'], 40);
  // Two of Ana's sessions: one runs the tools, one is the target. The one that
  // runs them starts last, because a backend is handed the tools of the session
  // it is starting and `delete_session` refuses to delete its own.
  await open(clients.ana!, 'doomed');
  await open(clients.ana!, 'runner');
  await settle();

  // The call acts as the person of the turn it runs in, and the session's own
  // owner is not asked instead: Ana has to be in a turn for her tool to be hers.
  await saying(clients.ana!, 'runner', 'delete the other one now, please');

  const tools = back.tools();
  expect(await tools.delete_session?.run?.({ session: 'ahp-session:/doomed' }))
    .toContain('Deleted session ahp-session:/doomed');

  expect(back.deleted).toEqual([{ id: 'doomed', directory: DIR }]);
});

it('refuses the delete_session tool for a session its owner does not own', async () => {
  const { back, clients } = await serving(['ana', 'bob'], 40);
  // Ana's session is the target; Bob's is the one whose tools would run the
  // delete, so the tool acts for Bob and the target is not his.
  await open(clients.ana!, 'theirs');
  await open(clients.bob!, 'runner');
  await settle();

  await saying(clients.bob!, 'runner', 'delete the other one now, please');

  const tools = back.tools();
  await expect(tools.delete_session?.run?.({ session: 'ahp-session:/theirs' }))
    .rejects.toMatchObject({ message: "Only the session's owner can delete it." });

  expect(back.deleted).toEqual([]);
});

it('refuses the delete_session tool with no turn running, whatever the record says', async () => {
  // Bob's session runs, but Bob has not signed in since the daemon started, so
  // this process knows his name as the owner and not what he holds. The store
  // says so: whoever starts `runner`, it is Bob's.
  //
  // None of that is reached. A call with no turn behind it is nobody's, and the
  // record's owner is not asked at all: it reads and it writes nothing, which
  // is what closes the door a window left open by outliving its turn.
  const store = memorySessions();
  const back = backend();
  const host = createHost({
    path: DIR, agents: [back.agent], users: directory(), tools: hostTools(),
    sessions: {
      ...store,
      owner: (id) => (id === 'runner' ? 'user:bob' : store.owner(id)),
    },
  });
  const ana = await signedIn(host, 'ana');
  const admin = await signedIn(host, 'admin');
  await open(ana, 'theirs');
  await open(admin, 'runner');
  await settle();

  const tools = back.tools();
  await expect(tools.delete_session?.run?.({ session: 'ahp-session:/theirs' }))
    .rejects.toMatchObject({ message: 'this turn may not session:write here' });
  expect(back.deleted).toEqual([]);
});

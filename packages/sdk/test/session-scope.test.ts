import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';
import type { Principal, Users } from '../src/types/users.js';
import { memorySessions } from '../src/sessions.js';
import type { SessionStore } from '../src/types/sessions.js';

/*
 * Which team and project a session's work is charged to.
 *
 * A picker of the asking person's own memberships, preset to their primary,
 * settled when the session is created and refused afterwards - and kept beside
 * the session, so a daemon that restarts does not decide again for a session
 * somebody else created.
 *
 * The backend here is the example, with a record of what each start was handed,
 * because what is under test is which half of the config reaches a backend.
 */

const DIR = '/tmp/ahpd-scope';
const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/** What the install names, and what one person belongs to. */
const PROJECTS = [{ id: 'ahpd' }, { id: 'controllr' }];

const ana: Principal = {
  id: 'ana',
  roles: [],
  can: () => true,
  // Any project of one team, and one project of another.
  memberships: ['backend:*', 'frontend:controllr'],
  primary: 'backend:ahpd',
  projects: PROJECTS,
  teams: [{ id: 'backend' }, { id: 'frontend' }],
};

/** Somebody with no memberships, which is a refusal rather than a default. */
const bob: Principal = { id: 'bob', roles: [], can: () => true, teams: [{ id: 'backend' }] };

/** Somebody who may name one scope and no other, so a session's owner is not a superset of theirs. */
const dan: Principal = {
  id: 'dan',
  roles: [],
  can: () => true,
  memberships: ['frontend:controllr'],
  projects: PROJECTS,
  teams: [{ id: 'backend' }, { id: 'frontend' }],
};

const directory = (): Users => ({
  resource: RECORD,
  verify: async (token) => (token === 'ana' ? ana : token === 'bob' ? bob : token === 'dan' ? dan : undefined),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  teams: async () => [{ id: 'backend' }, { id: 'frontend' }],
  projects: async () => PROJECTS,
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

type Note = { channel: string; action: Record<string, unknown>; rejectionReason?: string };

/** The example backend, with a record of what each start was handed. */
function backend() {
  const base = echo({ path: DIR, pace: 0 });
  const spawns: Record<string, unknown>[] = [];
  const began: string[] = [];
  const agent: Agent = {
    ...base,
    provider: 'echo',
    displayName: 'Echo backend',
    create: (start: Start) => {
      spawns.push({ ...start.settings });
      const session = base.create(start);
      return {
        ...session,
        begin: (turnId, text, model, from) => {
          began.push(text);
          session.begin(turnId, text, model, from);
        },
      };
    },
  };
  return { agent, spawns, began };
}

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** A host on one store, with the backend behind it. */
function serving(store: SessionStore, agent: Agent) {
  const host = createHost({ path: DIR, agents: [agent], users: directory(), sessions: store });
  const wire = peer();
  const client = host.accept(wire);
  void (async () => {
    await client.handle({
      method: 'initialize',
      params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
    });
    await client.handle({
      method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'ana' },
    });
  })();
  return { host, client, wire };
}

/** Somebody else, on the host that is already running. */
async function colleague(host: ReturnType<typeof createHost>, token: string) {
  const wire = peer();
  const client = host.accept(wire);
  await client.handle({
    method: 'initialize',
    params: { clientId: token, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token },
  });
  return { client, wire };
}

const uri = 'ahp-session:/scoped';
const chatUri = 'ahp-chat:/scoped';

const turn = (client: Client, text = 'go') => client.handle({
  method: 'dispatchAction',
  params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text } } },
});

const change = (client: Client, config: Record<string, unknown>) => client.handle({
  method: 'dispatchAction',
  params: { channel: uri, action: { type: 'session/configChanged', config } },
});

/** What a client was offered for the new session form. */
const offered = async (client: Client): Promise<Bag> => (await client.handle({
  method: 'resolveSessionConfig',
  params: { channel: ROOT, provider: 'echo' },
}) as { schema: { properties: Record<string, Bag> } }).schema.properties;

/** What a session is holding, from its snapshot. */
const stateOf = async (client: Client): Promise<{
  values: Record<string, unknown>;
  properties: Record<string, Bag>;
}> => {
  const config = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { config: { schema?: { properties?: Record<string, Bag> }; values: Record<string, unknown> } } };
  }).snapshot.state.config;
  return { values: config.values, properties: config.schema?.properties ?? {} };
};

/** Every refusal one connection was sent, in the order it arrived. */
const refusedIn = (wire: ReturnType<typeof peer>): string[] => wire.notes
  .filter((one) => one.method === 'action')
  .map((one) => one.params as Note)
  .filter((one) => one.rejectionReason !== undefined)
  .map((one) => one.rejectionReason ?? '');

it('offers the asking person their own memberships, starting on their primary', async () => {
  const store = memorySessions();
  const { agent, spawns } = backend();
  const { client } = serving(store, agent);
  await settle();

  const properties = await offered(client);
  // The `team:*` is one choice per project this install names, because a
  // membership is not a place to work in.
  expect(properties.scope).toMatchObject({
    type: 'string',
    enum: ['backend:ahpd', 'backend:controllr', 'frontend:controllr'],
    enumLabels: ['backend:ahpd', 'backend:controllr', 'frontend:controllr'],
    default: 'backend:ahpd',
    sessionMutable: false,
  });

  const items = await client.handle({
    method: 'sessionConfigCompletions',
    params: { channel: ROOT, provider: 'echo', property: 'scope', query: 'front' },
  }) as { items: { value: string }[] };
  expect(items.items).toEqual([{ value: 'frontend:controllr', label: 'frontend:controllr' }]);

  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  const state = await stateOf(client);
  expect(state.values.scope).toBe('backend:ahpd');
  expect(state.properties.scope?.enum).toEqual(['backend:ahpd', 'backend:controllr', 'frontend:controllr']);
  // A backend is handed a folder to work in, not a bill.
  expect(spawns[0]?.scope).toBeUndefined();
  expect(store.scope('scoped')).toEqual({ team: 'backend', project: 'ahpd' });
});

it('charges the session what the picker chose, before the first turn', async () => {
  const store = memorySessions();
  const { agent, began, spawns } = backend();
  const { client } = serving(store, agent);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });

  await change(client, { scope: 'frontend:controllr' });
  await turn(client);
  await settle();

  expect(began).toEqual(['go']);
  expect(store.scope('scoped')).toEqual({ team: 'frontend', project: 'controllr' });
  expect((await stateOf(client)).values.scope).toBe('frontend:controllr');
  // A scope is this host's own and the backend never sees it, so changing it
  // is not a reason to throw the backend away and start another.
  expect(spawns).toHaveLength(1);
});

it('settles a scope and a key that starts a backend in one action, with one start', async () => {
  const store = memorySessions();
  const { agent, began, spawns } = backend();
  const { client } = serving(store, agent);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  expect(spawns).toHaveLength(1);

  // One action, one decision: the scope moves and so does a key a session is
  // built around, and there is one start rather than two.
  await change(client, { scope: 'frontend:controllr', branch: 'elsewhere' });
  await settle();
  expect(spawns).toHaveLength(2);
  // The restarted backend is handed what the first start was: no host keys.
  expect(spawns[1]?.scope).toBeUndefined();
  expect(spawns[1]?.branch).toBeUndefined();

  await turn(client);
  await settle();
  expect(began).toEqual(['go']);
  expect(store.scope('scoped')).toEqual({ team: 'frontend', project: 'controllr' });
});

it('resolves a resumed session that was never charged, and refuses the turn when it cannot', async () => {
  const store = memorySessions();
  const { agent, began } = backend();
  // A session created by a host that had no directory and so charged nothing:
  // the backend is running and the store holds no scope for it.
  const first = createHost({ path: DIR, agents: [agent], sessions: store });
  const early = first.accept(peer());
  await early.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await early.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  await turn(early);
  await settle();
  expect(store.scope('scoped')).toBeUndefined();

  // A daemon that knows about teams resumes it, and the scope is decided now,
  // by whoever is asking, exactly as it is for a session's first turn.
  const host = createHost({ path: DIR, agents: [agent], users: directory(), sessions: store });
  const wire = peer();
  const client = host.accept(wire);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'later', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'ana' },
  });
  await turn(client, 'again');
  await settle();

  expect(began).toEqual(['go', 'again']);
  expect(store.scope('scoped')).toEqual({ team: 'backend', project: 'ahpd' });
});

it('refuses the first turn of a resumed session nobody can charge for', async () => {
  const store = memorySessions();
  const { agent, began } = backend();
  const first = createHost({ path: DIR, agents: [agent], sessions: store });
  const early = first.accept(peer());
  await early.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await early.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  await turn(early);
  await settle();
  expect(began).toEqual(['go']);

  const host = createHost({ path: DIR, agents: [agent], users: directory(), sessions: store });
  const wire = peer();
  const client = host.accept(wire);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'later', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'bob' },
  });
  await turn(client, 'again');
  await settle();

  // Fails closed rather than running the turn with no charge, which is what a
  // session settled before this host charged anything would otherwise do.
  expect(began).toEqual(['go']);
  expect(refusedIn(wire)).toEqual(['bob belongs to no team and project, so there is nothing to charge']);
});

it('charges a session of the same name afresh after the last one was disposed', async () => {
  const store = memorySessions();
  const { agent, began } = backend();
  const { client, wire } = serving(store, agent);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  // A name nobody can charge for is refused, and what it said is remembered
  // beside the session rather than asked again on every turn.
  await change(client, { scope: 'frontend:other' });
  await turn(client);
  await settle();
  expect(refusedIn(wire)).toHaveLength(1);

  await client.handle({ method: 'disposeSession', params: { channel: uri } });
  await settle();

  // A new session under the same name answers for itself and not for the one
  // that went, so what is left of it cannot refuse this turn.
  const again = serving(store, agent);
  await settle();
  await again.client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  await turn(again.client);
  await settle();

  expect(began).toEqual(['go']);
  expect(store.scope('scoped')).toEqual({ team: 'backend', project: 'ahpd' });
});

it('fails the first turn with the list when the scope names something the person may not', async () => {
  const store = memorySessions();
  const { agent, began } = backend();
  const { client, wire } = serving(store, agent);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });

  await change(client, { scope: 'frontend:other' });
  await turn(client);
  await settle();

  expect(began).toEqual([]);
  expect(refusedIn(wire)).toEqual([
    'ana may name backend:ahpd, backend:controllr, frontend:controllr',
  ]);
  // A name that resolves to nothing leaves the session with no charge at all,
  // rather than with the one it had and a different name in its config.
  expect(store.scope('scoped')).toBeUndefined();
});

it('takes a scope it could not resolve back, before the first turn', async () => {
  const store = memorySessions();
  const { agent, began } = backend();
  const { client, wire } = serving(store, agent);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });

  await change(client, { scope: 'backend:other' });
  await turn(client);
  await settle();
  expect(began).toEqual([]);

  // The window is still open, so this is the same picker again rather than a
  // session that has to be disposed.
  await change(client, { scope: 'backend:controllr' });
  await turn(client);
  await settle();
  expect(began).toEqual(['go']);
  expect(store.scope('scoped')).toEqual({ team: 'backend', project: 'controllr' });
});

it('resolves a scope somebody else sends against the session\'s owner', async () => {
  const store = memorySessions();
  const { agent, began } = backend();
  const started = serving(store, agent);
  await settle();
  await started.client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });

  // A second person at the same session, who may name one scope and no other.
  const other = await colleague(started.host, 'dan');

  // A refusal quotes the owner's choices rather than the sender's.
  await change(other.client, { scope: 'backend:other' });
  await turn(other.client);
  await settle();
  expect(began).toEqual([]);
  expect(refusedIn(other.wire)).toEqual(['ana may name backend:ahpd, backend:controllr, frontend:controllr']);

  // And a name dan may not name is still accepted, because the session's owner
  // decides what its work may be charged to and not whoever has it open.
  await change(other.client, { scope: 'backend:controllr' });
  await turn(other.client);
  await settle();

  expect(began).toEqual(['go']);
  expect(store.scope('scoped')).toEqual({ team: 'backend', project: 'controllr' });
});

it('refuses a change after the first turn, and keeps the scope it had', async () => {
  const store = memorySessions();
  const { agent } = backend();
  const { client, wire } = serving(store, agent);
  await settle();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  await turn(client);
  await settle();

  await change(client, { scope: 'frontend:controllr' });
  await settle();

  expect(refusedIn(wire)).toContain('scope is fixed once the session has started');
  expect(store.scope('scoped')).toEqual({ team: 'backend', project: 'ahpd' });
});

it('fails the first turn of somebody who belongs to nowhere', async () => {
  const store = memorySessions();
  const { agent, began } = backend();
  const host = createHost({ path: DIR, agents: [agent], users: directory(), sessions: store });
  const wire = peer();
  const client = host.accept(wire);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'bob' },
  });

  // No picker at all: a control with no choices is one every client has to draw.
  expect((await offered(client)).scope).toBeUndefined();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  await turn(client);
  await settle();

  expect(began).toEqual([]);
  expect(refusedIn(wire)).toEqual(['bob belongs to no team and project, so there is nothing to charge']);
});

it('offers nothing and refuses nothing on a host with no directory', async () => {
  const store = memorySessions();
  const { agent, began } = backend();
  const host = createHost({ path: DIR, agents: [agent], sessions: store });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });

  expect((await offered(client)).scope).toBeUndefined();
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  await turn(client);
  await settle();

  // There is nobody to resolve a scope for, so nothing is charged and nothing
  // is refused: a host without people is every session it had before this.
  expect(began).toEqual(['go']);
  expect(store.scope('scoped')).toBeUndefined();
});

it('keeps the scope beside the session a later daemon resumes', async () => {
  const store = memorySessions();
  // One backend for both, which is what a restart is: the catalogue of
  // finished sessions lives in the backend and the charge lives in the store.
  const { agent, began } = backend();
  const started = serving(store, agent);
  await settle();
  await started.client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  await turn(started.client);
  await settle();
  expect(began).toEqual(['go']);

  const host = createHost({ path: DIR, agents: [agent], users: directory(), sessions: store });
  const wire = peer();
  const client = host.accept(wire);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'later', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  // Signed in as somebody who belongs to nowhere, on purpose: the session's
  // charge was settled by whoever created it, and a resume does not re-decide
  // it for whoever is asking now.
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'bob' },
  });
  await turn(client, 'again');
  await settle();

  expect(began).toEqual(['go', 'again']);
  expect(refusedIn(wire)).toEqual([]);
  // And the charge is still what it was settled as, rather than nothing now
  // that somebody with nothing has said something.
  expect(store.scope('scoped')).toEqual({ team: 'backend', project: 'ahpd' });
});
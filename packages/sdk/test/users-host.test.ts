import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { createHost, ROOT } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { peopleProviders } from '../src/people.js';
import { policyProviders } from '../src/policy.js';
import { filePolicies } from '../src/policies.js';
import { grantProblem, isGrant, OPERATIONS } from '../src/users.js';
import type { HostEvent } from '../src/types/events.js';
import type { HostOptions } from '../src/types/host.js';
import type { Offered } from '../src/types/probe.js';
import type { Peer } from '../src/types/rpc.js';
import type { Grant, Users } from '../src/types/users.js';

/*
 * The host half: a sign-in resource, and the one credential it checks.
 *
 * Every case is built from a directory that is a plain object, so what is under
 * test is the host's branch and not the file. The file has its own suite.
 */

const DIR = '/tmp/users-host';
const BACKEND = 'https://backend.test';

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/** The same record with the field the format defaults to, which is what a real directory sends. */
const REQUIRED = { ...RECORD, required: true };

const directory = (good = 'good-token', resource: Users['resource'] = RECORD): Users => ({
  resource,
  verify: async (token) => (token === good ? { id: 'ana', roles: ['admin'], can: () => true } : undefined),
  list: async () => [{ id: 'ana', roles: ['admin'], grants: ['*:*'] as const, trusted: false }],
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
  mint: async () => good,
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

/** One agent, so the advertised resource has somewhere to appear. */
const agents = (): HostOptions['agents'] => [
  { ...echo({ path: DIR, pace: 0 }), protectedResources: [{ resource: BACKEND }] },
];

/** A host, with the `authenticated` event recorded the way a plugin records it. */
function served(extra: Partial<HostOptions> = {}) {
  const seen: HostEvent[] = [];
  const { host: plugin, contribution } = pluginHost('probe', { path: DIR, paths: [DIR], version: '0.0.0', hostName: 'test', configDir: DIR, log: () => {}, say: () => {} });
  plugin.on('authenticated', (event) => { seen.push(event); });
  const { options } = foldHostOptions({ path: DIR, agents: agents(), ...extra }, [contribution]);
  return { host: createHost(options), seen };
}

const hello = (client: ReturnType<ReturnType<typeof createHost>['accept']>, clientId = 'probe') => client.handle({
  method: 'initialize',
  params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
});

const advertised = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<string[]> => {
  const state = (await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
    snapshot: { state: { agents: { protectedResources?: { resource: string }[] }[] } };
  }).snapshot.state;
  return (state.agents[0]?.protectedResources ?? []).map((one) => one.resource);
};

/** One advertised agent, as much of it as these cases read. */
interface Agentish {
  protectedResources?: { resource: string; required?: boolean }[];
}

/** The `agents` a connection reads from a fresh root snapshot. */
const agentsOf = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<Agentish[]> => {
  const state = (await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
    snapshot: { state: { agents: Agentish[] } };
  }).snapshot.state;
  return state.agents;
};

/** One protected resource, by the identifier it is pushed under. */
const resourceIn = (agents: Agentish[], id: string) =>
  (agents[0]?.protectedResources ?? []).find((one) => one.resource === id);

/** Every `root/agentsChanged` one connection was sent, in the order it arrived. */
const changedIn = (wire: ReturnType<typeof peer>): Agentish[][] => wire.notes
  .filter((one) => one.method === 'action' && (one.params as { action?: { type?: string } }).action?.type === 'root/agentsChanged')
  .map((one) => (one.params as { action: { agents: Agentish[] } }).action.agents);

const until = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((done) => { setTimeout(done, 5); });
  }
};

/**
 * A backend whose probe answers when the test says so.
 *
 * The root list is announced once at startup and once when a probe answers,
 * so a case about the live and replayed copies has to hold the answer rather
 * than race it.
 */
const slowAgent = (gate: Promise<void>, offered: Offered): HostOptions['agents'][number] => ({
  ...echo({ path: DIR, pace: 0 }),
  // A backend's own resource, which is not the one that may be rewritten.
  protectedResources: [{ resource: BACKEND, required: true }],
  probe: async () => { await gate; return offered; },
});

it('advertises nothing new with no directory, and the sign-in resource with one', async () => {
  const plain = served();
  const first = plain.host.accept(peer());
  await hello(first);
  expect(await advertised(first)).toEqual([BACKEND]);

  const withUsers = served({ users: directory() });
  const second = withUsers.host.accept(peer());
  await hello(second);
  expect(await advertised(second)).toEqual([BACKEND, RECORD.resource]);
});

it('attaches a person for a token the directory knows, and fires authenticated', async () => {
  const { host, seen } = served({ users: directory() });
  const client = host.accept(peer());
  await hello(client);

  await expect(client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'good-token' },
  })).resolves.toEqual({});
  expect(seen).toHaveLength(1);
  // The person's id, not the clientId this host never checked.
  expect(seen[0]).toMatchObject({ type: 'authenticated', client: 'ana', resource: RECORD.resource });
});

it('refuses a token the directory does not know, carrying the record to sign in against', async () => {
  const { host, seen } = served({ users: directory() });
  const client = host.accept(peer());
  await hello(client);

  const refused = await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'wrong' },
  }).then(() => 'served', (error: { code: number; data?: unknown }) => error);

  expect(refused).toMatchObject({ code: -32007 });
  expect((refused as { data: { resources: { resource: string }[] } }).data.resources)
    .toEqual([expect.objectContaining({ resource: RECORD.resource })]);
  expect(seen).toEqual([]);
});

it('signs out on an empty token', async () => {
  const { host } = served({ users: directory() });
  const client = host.accept(peer());
  await hello(client);
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'good-token' } });
  await expect(client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: '' },
  })).resolves.toEqual({});
});

it('still holds a backend\'s token unverified, which is what the Anthropic path needs', async () => {
  const { host } = served({ users: directory() });
  const client = host.accept(peer());
  await hello(client);

  // Nonsense for a backend's resource is accepted, because the host cannot
  // check it and never claimed to; the same nonsense for the host's own
  // resource is the -32007 above.
  await expect(client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: BACKEND, token: 'nonsense' },
  })).resolves.toEqual({});
  await expect(client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: 'https://nobody.test', token: 'x' },
  })).rejects.toMatchObject({ code: -32602 });
});

it('takes the credential away when it runs out, and says so', async () => {
  vi.useFakeTimers();
  try {
    const { host } = served({ users: directory() });
    const wire = peer();
    const client = host.accept(wire);
    await hello(client);
    await client.handle({
      method: 'authenticate',
      params: { channel: ROOT, resource: RECORD.resource, token: 'good-token', expiresIn: 30 },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(wire.notes.filter((one) => one.method === 'auth/required')).toEqual([{
      method: 'auth/required',
      params: {
        channel: ROOT,
        resource: expect.objectContaining({ resource: RECORD.resource }),
        reason: 'expired',
      },
    }]);
  }
  finally {
    vi.useRealTimers();
  }
});

/*
 * What a connection is told about the host's sign-in.
 *
 * The field is `required`, and a client reads it to decide whether to prompt
 * before it sends anything. It is `true` for a connection whose commands would
 * be refused without a credential, and `false` for one the host already treats
 * as somebody - root, or carrying a principal - because a prompt for a token
 * nothing needs is a client that never creates a session - decision
 * `an-authorized-connection-is-told-sign-in-is-not-required`.
 */

it('tells a root connection the host\'s sign-in is not required, and a personal one that it is', async () => {
  const { host } = served({ users: directory('good-token', REQUIRED) });
  const root = host.accept(peer(), undefined, true);
  const personal = host.accept(peer());
  await hello(root, 'root');
  await hello(personal, 'personal');

  expect(resourceIn(await agentsOf(root), RECORD.resource)?.required).toBe(false);
  expect(resourceIn(await agentsOf(personal), RECORD.resource)?.required).toBe(true);

  // Signing in changes the next delivery, without a fresh agentsChanged: the
  // client only reads this at session creation, and it already has a token.
  await personal.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'good-token' } });
  expect(resourceIn(await agentsOf(personal), RECORD.resource)?.required).toBe(false);
});

it('sends each connection its own required in a live root/agentsChanged', async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { host } = served({
    users: directory('good-token', REQUIRED),
    agents: [slowAgent(gate, { models: [], commands: [], customizations: [] })],
  });
  const rootWire = peer();
  const personalWire = peer();
  const root = host.accept(rootWire, undefined, true);
  const personal = host.accept(personalWire);
  await hello(root, 'root');
  await hello(personal, 'personal');

  release();
  await until(() => changedIn(rootWire).length > 0 && changedIn(personalWire).length > 0);
  expect(resourceIn(changedIn(rootWire).at(-1) ?? [], RECORD.resource)?.required).toBe(false);
  expect(resourceIn(changedIn(personalWire).at(-1) ?? [], RECORD.resource)?.required).toBe(true);
});

it('replays root/agentsChanged to a root connection with its own required', async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { host } = served({
    users: directory('good-token', REQUIRED),
    agents: [slowAgent(gate, { models: [], commands: [], customizations: [] })],
  });
  const firstWire = peer();
  const first = host.accept(firstWire);
  await hello(first, 'first');
  release();
  await until(() => changedIn(firstWire).length > 0);

  // Back from sequence 0, so the held envelope is replayed rather than a fresh
  // snapshot taken - and it is rewritten for the connection it reaches.
  const backWire = peer();
  const back = host.accept(backWire, undefined, true);
  const answer = await back.handle({
    method: 'reconnect',
    params: { clientId: 'first', subscriptions: [ROOT], lastSeenServerSeq: 0 },
  }) as { type: string; actions: { action: { type: string; agents: Agentish[] } }[] };

  expect(answer.type).toBe('replay');
  const held = answer.actions.find((one) => one.action.type === 'root/agentsChanged');
  expect(held).toBeDefined();
  expect(resourceIn(held?.action.agents ?? [], RECORD.resource)?.required).toBe(false);
});

it('rewrites only the host\'s own sign-in resource', async () => {
  const github = {
    resource: { resource: 'https://github.test', required: true },
    forBranch: async () => [],
    create: async () => ({ url: 'https://github.test/pr/1', state: 'open' }),
  } as unknown as NonNullable<HostOptions['github']>;
  const { host } = served({
    users: directory('good-token', REQUIRED),
    github,
    agents: [{ ...echo({ path: DIR, pace: 0 }), protectedResources: [{ resource: BACKEND, required: true }] }],
  });
  const client = host.accept(peer(), undefined, true);
  await hello(client, 'root');

  const list = await agentsOf(client);
  // A backend's own resource and GitHub's are listed as the host was given
  // them; only the resource whose identifier is the directory's changes.
  expect(resourceIn(list, BACKEND)?.required).toBe(true);
  expect(resourceIn(list, 'https://github.test')?.required).toBe(true);
  expect(resourceIn(list, RECORD.resource)?.required).toBe(false);
});

it('sends the same list to every connection when there is no directory', async () => {
  const { host } = served();
  const root = host.accept(peer(), undefined, true);
  const personal = host.accept(peer());
  await hello(root, 'root');
  await hello(personal, 'personal');

  const one = await agentsOf(root);
  const two = await agentsOf(personal);
  expect(one).toEqual(two);
  // There is no sign-in resource to rewrite when there is nobody to sign in.
  expect(resourceIn(one, RECORD.resource)).toBeUndefined();
});

/*
 * `ahpd.grants`, the operations a role may name, on the handshake and on the
 * root snapshot.
 *
 * It is read off the same table the gate asks against, so the test asserts the
 * shape and the two invariants a client drawing a role editor depends on: a
 * subject's operations are its two groups and nothing else, and no operation
 * is in both.
 */

interface Subject {
  title: string;
  description: string;
  operations: string[];
  groups: { read: string[]; write: string[] };
}
type Grants = Record<string, Subject>;

/** The handshake's `ahpd.grants`, as this test reads it. */
const grantsOf = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<Grants> =>
  ((await hello(client)) as { _meta?: { 'ahpd.grants'?: Grants } })._meta?.['ahpd.grants'] as Grants;

/** The same key off the root snapshot, which is where a client that subscribes later reads it. */
const snapshotGrants = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<Grants> =>
  (await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
    snapshot: { state: { _meta?: { 'ahpd.grants'?: Grants } } };
  }).snapshot.state._meta?.['ahpd.grants'] as Grants;

it('advertises the operations of every subject it gates, on both blocks', async () => {
  const { host } = served({ users: directory() });
  const client = host.accept(peer(), undefined, true);
  const grants = await grantsOf(client);

  expect(Object.keys(grants)).toEqual([
    'session', 'chat', 'terminal', 'automation', 'file', 'config', 'diagnostics', 'container', 'trust', 'proxy',
  ]);
  // The root snapshot says the same thing the handshake said, to a client that
  // only ever subscribes.
  expect(await snapshotGrants(client)).toEqual(grants);

  for (const [subject, one] of Object.entries(grants)) {
    expect(one.title, subject).not.toBe('');
    expect(one.description, subject).not.toBe('');
    // Every operation is in exactly one group, and the groups are the whole of
    // it: a client that offers these lists cannot offer an operation the host
    // would refuse, and cannot leave one out.
    expect([...one.groups.read, ...one.groups.write].sort(), subject).toEqual([...one.operations].sort());
    expect(one.groups.read.filter((op) => one.groups.write.includes(op)), subject).toEqual([]);
    // And the advertised words are grants the directory accepts.
    for (const op of one.operations) expect(isGrant(`${subject}:${op}` as Grant), `${subject}:${op}`).toBe(true);
  }

  // `dispose` is a session's write and `list` is not: the groups a client draws
  // are the groups `holds` answers from.
  expect(grants['session']?.groups.write).toContain('dispose');
  expect(grants['session']?.groups.write).not.toContain('list');
  expect(grants['session']?.groups.read).toContain('list');
  // A description is what the table says, whole: a client shows it to a person
  // deciding what a grant is for, and this host adds nothing to it.
  expect(grants['chat']?.description).toBe(OPERATIONS['chat']?.description);
});

it('advertises trust and proxy, which the gate asks about through no method', async () => {
  const { host } = served({ users: directory() });
  const client = host.accept(peer(), undefined, true);
  const grants = await grantsOf(client);

  // Both are asked for outside `GATE.NEEDS`: a `workspaceTrust` push on the
  // root config, and a call or a model list on the proxy. Neither has a scheme
  // of its own, so before these entries a client drawing a role editor had no
  // way to offer either word.
  expect(grants['trust']).toEqual({
    title: expect.any(String),
    description: expect.any(String),
    operations: ['push'],
    groups: { read: [], write: ['push'] },
  });
  expect(grants['proxy']).toEqual({
    title: expect.any(String),
    description: expect.any(String),
    operations: ['models', 'call'],
    groups: { read: ['models'], write: ['call'] },
  });

  // The advertised words are words a role may hold, which is what makes the
  // entry drawable: the groups the gate asks for, and each operation under its
  // own name.
  expect(grantProblem('trust:write')).toBeUndefined();
  expect(grantProblem('trust:push')).toBeUndefined();
  expect(grantProblem('proxy:read')).toBeUndefined();
  expect(grantProblem('proxy:write')).toBeUndefined();
  expect(grantProblem('proxy:models')).toBeUndefined();
  expect(grantProblem('proxy:call')).toBeUndefined();
  // A word the subject does not have is refused, and the refusal names what it
  // does have, which is how a person writing a role learns what to write.
  expect(grantProblem('trust:get')).toBe("trust:get is not one of trust's operations (push), read or write or a *");
  expect(grantProblem('proxy:list')).toMatch(/^proxy:list is not one of proxy's operations \(models, call\), read or write or a \*$/u);
});

it('advertises the schemes it serves beside the built-ins, so a role editor reads one key', async () => {
  const people = directory();
  const { host } = served({ users: people, resourceProviders: peopleProviders(people) });
  const client = host.accept(peer(), undefined, true);
  const grants = await grantsOf(client);

  // The ten the table decides still lead, in its order, and every scheme
  // follows under its own name: `team:put` is written into a role the way
  // `file:put` is.
  expect(Object.keys(grants)).toEqual([
    'session', 'chat', 'terminal', 'automation', 'file', 'config', 'diagnostics', 'container', 'trust', 'proxy',
    'user', 'team', 'project', 'role',
  ]);
  // The root snapshot says the same thing the handshake said.
  expect(await snapshotGrants(client)).toEqual(grants);

  const PEOPLE = ['user', 'team', 'project', 'role'];
  for (const [scheme, one] of Object.entries(grants).filter(([key]) => PEOPLE.includes(key))) {
    expect(one.title, scheme).not.toBe('');
    expect(one.description, scheme).not.toBe('');
    // What these four providers implement, and the resource groups those
    // operations fall into - the groups the gate answers `team:put` from.
    expect(one.operations, scheme).toEqual(['get', 'list', 'resolve', 'put', 'delete']);
    expect(one.groups.read, scheme).toEqual(['get', 'list', 'resolve']);
    expect(one.groups.write, scheme).toEqual(['put', 'delete']);
    // A scheme entry carries the same invariant a built-in one does, so a
    // client draws a form off either without asking which it is reading.
    expect([...one.groups.read, ...one.groups.write].sort(), scheme).toEqual([...one.operations].sort());
    for (const op of one.operations) expect(isGrant(`${scheme}:${op}` as Grant), `${scheme}:${op}`).toBe(true);
  }

  // `file` keeps the table's entry: a built-in subject wins a name a provider
  // shares with it, and `file`'s own operations are the ten rather than the five
  // a file provider would say.
  expect(grants['file']?.operations).toEqual(OPERATIONS['file']?.operations);
});

it('advertises the policy scheme beside them too, since a host serves it either way', async () => {
  const store = filePolicies({ file: join(DIR, 'policies.json') });
  const { host } = served({ resourceProviders: policyProviders(store) });
  const client = host.accept(peer(), undefined, true);
  const grants = await grantsOf(client);

  expect(grants['policy']).toEqual({
    title: 'Policies',
    description: expect.any(String),
    operations: ['get', 'list', 'resolve', 'put', 'delete'],
    groups: { read: ['get', 'list', 'resolve'], write: ['put', 'delete'] },
  });
});

it('advertises the subjects on a host with no directory, because a role could still be held', async () => {
  const with_ = await grantsOf(served({ users: directory() }).host.accept(peer(), undefined, true));
  const without = await grantsOf(served().host.accept(peer(), undefined, true));
  expect(Object.keys(without)).toEqual(Object.keys(with_));
  expect(without).toEqual(with_);
});

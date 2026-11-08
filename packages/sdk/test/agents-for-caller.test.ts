import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { mayUseAgentFor } from '../src/agents/usable.js';
import { fileUsers } from '../src/access/users.js';
import { fileResources } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { AgentOwner } from '../src/types/agents.js';
import type { Principal } from '../src/types/users.js';
import type { HostOptions, Users } from '../src/types/index.js';

/*
 * Who a caller is told about and who may start a session.
 *
 * A host with a real users file, four agents - one the daemon serves, one a
 * team's, and one for each of two people - and three callers: a person holding
 * `session:write`, a member of the team who holds it not, and another person.
 * The list a caller is sent holds every agent, one it may not use with no
 * models, as VS Code's host lists a provider it does not advertise, and a
 * start on such an agent answers as one on a provider this host does not
 * serve.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3288-L3291
 */

let root = '';
let usersFile = '';

const write = (users: unknown[]): void => {
  writeFileSync(usersFile, JSON.stringify({
    teams: [{ id: 'backend' }],
    roles: {
      writer: ['session:read', 'session:write', 'session:create'],
      reader: ['session:read'],
      'team-member': ['session:read', 'session:create'],
    },
    users,
  }));
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-caller-agents-'));
  usersFile = join(root, 'users.json');
  write([
    { id: 'ana', roles: ['writer'] },
    { id: 'bo', roles: ['team-member'], memberships: ['backend'] },
    { id: 'cy', roles: ['writer'] },
  ]);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

type Bag = Record<string, any>;

/** Whose each stored record says it is. `base` has none, so it is the host's. */
const OWNERS: [string, AgentOwner][] = [
  ['crew', 'team:backend'],
  ['mine', 'user:ana'],
  ['theirs', 'user:cy'],
];

const backend = (id: string): Agent => {
  // The echo backend probes for what it offers, and an answer moves the root
  // list again: this host's agents say nothing, so one notification is one.
  const base = { ...echo({ path: root, pace: 0 }), provider: id, displayName: id === 'base' ? 'Base' : id };
  delete base.probe;
  // `mine` and `crew` offer one model each, which a caller who may not use the
  // agent is told it has none of.
  return id === 'mine' || id === 'crew'
    ? { ...base, probe: async () => ({ models: [{ id: `${id}-model`, name: id }], commands: [], customizations: [] }) }
    : base;
};

/**
 * A host over the agents a real users file and an owners map describe.
 *
 * `base` is the daemon's own, with no entry in the map; every id the map names
 * is a stored record, whose owner is the one it names.
 */
const serving = (
  users: Users = fileUsers({ path: usersFile }),
  owners: ReadonlyMap<string, AgentOwner | undefined> = new Map(OWNERS),
) => {
  const agents = ['base', ...owners.keys()].map(backend);
  const options: HostOptions = {
    path: root,
    agents,
    resources: fileResources(),
    users,
    agentOwners: () => owners,
  };
  return createHost(options);
};

type Client = ReturnType<ReturnType<typeof serving>['accept']>;

/** A client signed in as `id`, keeping what it is told. */
const as = async (host: ReturnType<typeof serving>, users: Users, id: string) => {
  const token = await users.mint(id);
  const seen: { method: string; params: Bag }[] = [];
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  });
  await client.handle({
    method: 'initialize', params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  /** The `agents` the root state holds now, by provider, in order. */
  const agents = async (): Promise<string[]> => {
    const answer = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as Bag;
    return ((answer['snapshot'] as Bag).state.agents as { provider: string }[]).map((one) => one.provider);
  };
  /** The ids of the models the root state lists for one agent now. */
  const models = async (provider: string): Promise<string[]> => {
    const answer = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as Bag;
    const agent = ((answer['snapshot'] as Bag).state.agents as { provider: string; models?: { id: string }[] }[])
      .find((one) => one.provider === provider);
    return (agent?.models ?? []).map((one) => one.id);
  };
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => ({ code: error.code, message: error.message }),
  );
  const changed = (): number => seen.filter((one) => one.method === 'action' && (one.params['action'] as Bag)?.type === 'root/agentsChanged').length;
  /** Wait until another `root/agentsChanged` has arrived, or give up. */
  const after = async (was: number): Promise<void> => {
    for (let i = 0; i < 400 && changed() === was; i++) await new Promise((done) => { setTimeout(done, 5); });
  };
  return { client, agents, models, call, changed, after, seen };
};

/** Every agent the host serves, by provider. */
const ALL = ['base', 'crew', 'mine', 'theirs'];

it('tells each caller every agent, and one it may not use with no models', async () => {
  const users = fileUsers({ path: usersFile });
  const host = serving(users);
  const ana = await as(host, users, 'ana');
  const bo = await as(host, users, 'bo');
  const cy = await as(host, users, 'cy');

  // Every caller is told every agent, whichever it may use.
  expect((await ana.agents()).sort()).toEqual(ALL);
  expect((await bo.agents()).sort()).toEqual(ALL);
  expect((await cy.agents()).sort()).toEqual(ALL);
  // `mine` is ana's: she is told its model once it is offered, and cy, who
  // may not use it, is told it has none.
  for (let i = 0; i < 400 && (await ana.models('mine')).length === 0; i++) await new Promise((done) => { setTimeout(done, 5); });
  expect(await ana.models('mine')).toEqual(['mine-model']);
  expect(await cy.models('mine')).toEqual([]);
  await host.close();
});

it('answers a start on another person\'s agent as it does an agent it does not serve', async () => {
  const users = fileUsers({ path: usersFile });
  const host = serving(users);
  const ana = await as(host, users, 'ana');
  const bo = await as(host, users, 'bo');
  const cy = await as(host, users, 'cy');

  // Somebody else's agent, refused, and an id nobody has, refused the same way.
  const notOurs = await cy.call('createSession', { channel: 'ahp-session:/one', provider: 'mine' });
  const nobody = await cy.call('createSession', { channel: 'ahp-session:/two', provider: 'nobody' });
  expect(notOurs).toEqual({ code: -32002, message: 'No agent provider registered for: mine' });
  expect(nobody).toEqual({ code: -32002, message: 'No agent provider registered for: nobody' });

  // A team agent takes a membership, and the member starts on it.
  expect(await bo.call('createSession', { channel: 'ahp-session:/three', provider: 'crew' })).toHaveProperty('result');
  // A person's own agent is theirs to start on.
  expect(await ana.call('createSession', { channel: 'ahp-session:/four', provider: 'mine' })).toHaveProperty('result');
  // And neither of them started the refused ones.
  expect(await cy.call('createSession', { channel: 'ahp-session:/five', provider: 'base' })).toHaveProperty('result');
  await host.close();
});

it('refuses an agent a record holds with no owner, to every caller', async () => {
  const users = fileUsers({ path: usersFile });
  // The map says a record holds `nameless` and no owner comes with it: an
  // agent that is nobody's, which is not the host's own.
  const owners = new Map<string, AgentOwner | undefined>([...OWNERS, ['nameless', undefined]]);
  const host = serving(users, owners);
  const ana = await as(host, users, 'ana');

  // `session:write` is what a host agent takes, and it is not enough here:
  // the agent is listed, with no models, and a start on it is refused.
  expect((await ana.agents()).sort()).toEqual([...ALL, 'nameless'].sort());
  expect(await ana.models('nameless')).toEqual([]);
  expect(await ana.call('createSession', { channel: 'ahp-session:/nameless', provider: 'nameless' }))
    .toEqual({ code: -32002, message: 'No agent provider registered for: nameless' });
  // An id no record holds is still the host's, and `ana` starts on it.
  expect(await ana.call('createSession', { channel: 'ahp-session:/base', provider: 'base' }))
    .toHaveProperty('result');
  await host.close();
});

it("does not lend an owner's work another person's teams", () => {
  const person = (id: string, team: string): Principal => ({ id, roles: [], can: () => false, memberships: [team] });
  const theirs = { recorded: true, owner: 'team:backend' } as const;

  /*
   * The work is `ana`'s and the principal this host met is `cy`, of the team
   * that holds the agent. `forWhom` may hand over whoever asked now, and
   * another person's memberships are not the owner's, so they lend nothing.
   */
  expect(mayUseAgentFor({ owner: 'user:ana', principal: person('cy', 'backend') }, theirs, { hasDirectory: true }))
    .toBe(false);
  // The person the owner names keeps the teams they hold.
  expect(mayUseAgentFor({ owner: 'user:ana', principal: person('ana', 'backend') }, theirs, { hasDirectory: true }))
    .toBe(true);
});

it('sends the list again when a membership change alters what a caller may use', async () => {
  const users = fileUsers({ path: usersFile });
  const host = serving(users);
  const bo = await as(host, users, 'bo');
  for (let i = 0; i < 400 && (await bo.models('crew')).length === 0; i++) await new Promise((done) => { setTimeout(done, 5); });
  expect(await bo.models('crew')).toEqual(['crew-model']);

  // Bo leaves the team: the same connection may use nothing s/he could
  // before, and is still told every agent, the team's with no models.
  const was = bo.changed();
  write([{ id: 'ana', roles: ['writer'] }, { id: 'bo', roles: ['team-member'] }, { id: 'cy', roles: ['writer'] }]);
  await bo.after(was);
  expect((await bo.agents()).sort()).toEqual(ALL);
  expect(await bo.models('crew')).toEqual([]);
  await host.close();
});

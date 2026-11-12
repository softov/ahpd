import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { ComputerPort, MachineSource } from '../src/types/computers.js';
import type { Read, ResourceProvider, Write } from '../src/types/resources.js';
import type { Owner } from '../src/types/usage.js';
import type { Peer } from '../src/types/rpc.js';
import type { Principal, Users } from '../src/types/users.js';

/*
 * Whose the machine is, and what a client that follows a create is told.
 *
 * A machine a session asked for belongs to the session, and a machine a person
 * made directly belongs to whoever was signed in when they made it. Either way
 * the creator's owner reaches the plugin that makes the machine, which is what
 * the time it spends up is charged to. A create a client follows under a
 * progress token says each step through that token, and one with no token
 * says nothing.
 */

const DIR = '/tmp/ahpd-machine-owner';

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

const ana: Principal = {
  id: 'ana',
  roles: [],
  can: () => true,
  memberships: ['backend:*'],
  primary: 'backend:ahpd',
  projects: [{ id: 'ahpd' }],
  teams: [{ id: 'backend' }],
};

const directory = (): Users => ({
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
  projects: async () => [{ id: 'ahpd' }],
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
    send: () => {}, notify: (method, params) => notes.push({ method, params }), request: async () => ({}), answered: () => {}, close: () => {},
  };
};

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A port that makes every source the same machine and remembers what it was asked. */
function port(): { computers: ComputerPort; asked: MachineSource[] } {
  const asked: MachineSource[] = [];
  return {
    asked,
    computers: {
      how: async () => undefined,
      create: async (source) => {
        asked.push(source);
        return 'box';
      },
    },
  };
}

/** The `computer:` scheme, remembering who each write was made by. */
function scheme(): { computer: ResourceProvider; owners: (Owner | undefined)[] } {
  const owners: (Owner | undefined)[] = [];
  const computer: ResourceProvider = {
    read: async (uri): Promise<Read> => ({ data: `status of ${uri}`, encoding: 'utf-8' }),
    write: async (_uri: string, _content: Write, owner?: Owner) => { owners.push(owner); },
  };
  return { computer, owners };
}

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** A host with the given machines behind it, opened and signed in as ana. */
async function serving(options: {
  computers?: ComputerPort;
  computer?: ResourceProvider;
  disabledAgents?: () => ReadonlySet<string>;
}) {
  const agent: Agent = echo({ path: DIR, pace: 0 });
  const host = createHost({
    path: DIR,
    agents: [agent],
    users: directory(),
    ...(options.disabledAgents === undefined ? {} : { disabledAgents: options.disabledAgents }),
    ...(options.computers === undefined ? {} : { computers: options.computers }),
    ...(options.computer === undefined
      ? {}
      : { resourceProviders: { computer: options.computer } }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'ana' },
  });
  return { client, peer: p };
}

const created = async (client: Client, config: Record<string, unknown>) => {
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/owned', provider: 'echo', config } });
  await settle();
};

it('hands a session-made machine the session\'s owner and scope', async () => {
  const { computers, asked } = port();
  const { client } = await serving({ computers });

  await created(client, { computer: 'disposable:box' });

  // Whoever asked, and what their session's work is charged under: a machine
  // made for a session carries the charge beside the owner.
  expect(asked[0]).toMatchObject({
    source: 'disposable:box',
    session: 'ahp-session:/owned',
    provider: 'echo',
    owner: 'user:ana',
    team: 'backend',
    project: 'ahpd',
  });
});

it('hands a machine a person made directly the connection\'s owner', async () => {
  const { computer, owners } = scheme();
  const { client } = await serving({ computer });

  await client.handle({
    method: 'resourceWrite',
    params: { channel: ROOT, uri: 'computer://box', data: '{}', encoding: 'utf-8' },
  });

  // No session behind it, so no scope: what a machine made directly has is
  // whose it is.
  expect(owners).toEqual(['user:ana']);
});

it('says each step of a create under the client\'s progress token, and closes it with a total', async () => {
  const computers: ComputerPort = {
    how: async () => undefined,
    create: async (source) => {
      source.progress?.('Making the machine');
      source.progress?.('Seeding the checkout');
      return 'box';
    },
  };
  const { client, peer: p } = await serving({ computers });

  await client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/steps',
      provider: 'echo',
      config: { computer: 'disposable:box' },
      progressToken: 'p1',
    },
  });
  await settle();

  const said = p.notes
    .filter((one) => one.method === 'root/progress')
    .map((one) => one.params as Record<string, unknown>);
  // The steps in the words the machine maker and the host use, each with a
  // rising count, then the one that says the wait is over: `progress` and
  // `total` the same number, and no message.
  expect(said).toEqual([
    { channel: ROOT, progressToken: 'p1', progress: 1, message: 'Making the machine' },
    { channel: ROOT, progressToken: 'p1', progress: 2, message: 'Seeding the checkout' },
    { channel: ROOT, progressToken: 'p1', progress: 3, message: 'Starting the agent' },
    { channel: ROOT, progressToken: 'p1', progress: 3, total: 3 },
  ]);
});

it('says nothing of a create no token follows', async () => {
  const computers: ComputerPort = {
    how: async () => undefined,
    create: async (source) => { source.progress?.('Making the machine'); return 'box'; },
  };
  const { client, peer: p } = await serving({ computers });

  await created(client, { computer: 'disposable:box' });

  expect(p.notes.some((one) => one.method === 'root/progress')).toBe(false);
});

it('closes the progress of a create refused before it claims the name, and still answers with the refusal', async () => {
  // The host does not serve this agent at all, so it refuses before anything
  // is claimed or made: no step is taken, and the error is still the answer.
  const { client, peer: p } = await serving({ disabledAgents: () => new Set(['echo']) });

  const refused = client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/off',
      provider: 'echo',
      // A machine is asked for, so this create follows progress at all; the
      // refusal comes before it is made.
      config: { computer: 'disposable:box' },
      progressToken: 'p1',
    },
  });
  await expect(refused).rejects.toMatchObject({ code: -32002 });

  const said = p.notes
    .filter((one) => one.method === 'root/progress')
    .map((one) => one.params as Record<string, unknown>);
  expect(said).toEqual([{ channel: ROOT, progressToken: 'p1', progress: 0, total: 0 }]);
});

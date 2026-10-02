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
 * Whose the machine is.
 *
 * A machine a session asked for belongs to the session, and a machine a person
 * made directly belongs to whoever was signed in when they made it. Either way
 * the creator's owner reaches the plugin that makes the machine, which is what
 * the time it spends up is charged to - decision
 * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`.
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
  teams: async () => [{ id: 'backend' }],
  projects: async () => [{ id: 'ahpd' }],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

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
async function serving(options: { computers?: ComputerPort; computer?: ResourceProvider }) {
  const agent: Agent = echo({ path: DIR, pace: 0 });
  const host = createHost({
    path: DIR,
    agents: [agent],
    users: directory(),
    ...(options.computers === undefined ? {} : { computers: options.computers }),
    ...(options.computer === undefined
      ? {}
      : { resourceProviders: { computer: options.computer } }),
  });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({
    method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'ana' },
  });
  return client;
}

const created = async (client: Client, config: Record<string, unknown>) => {
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/owned', provider: 'echo', config } });
  await settle();
};

it('hands a session-made machine the session\'s owner and scope', async () => {
  const { computers, asked } = port();
  const client = await serving({ computers });

  await created(client, { computer: 'disposable:box' });

  // Whoever asked, and what their session's work is charged under: a machine
  // made for a session carries the charge beside the owner.
  expect(asked[0]).toMatchObject({
    source: 'disposable:box',
    session: 'echo:/owned',
    provider: 'echo',
    owner: 'user:ana',
    team: 'backend',
    project: 'ahpd',
  });
});

it('hands a machine a person made directly the connection\'s owner', async () => {
  const { computer, owners } = scheme();
  const client = await serving({ computer });

  await client.handle({
    method: 'resourceWrite',
    params: { channel: ROOT, uri: 'computer://box', data: '{}', encoding: 'utf-8' },
  });

  // No session behind it, so no scope: what a machine made directly has is
  // whose it is.
  expect(owners).toEqual(['user:ana']);
});

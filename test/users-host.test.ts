import { expect, it, vi } from 'vitest';
import { createHost, ROOT } from '../packages/sdk/src/host.js';
import { foldHostOptions, pluginHost } from '../packages/sdk/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { HostEvent } from '../packages/sdk/src/types/events.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';
import type { Users } from '../packages/sdk/src/types/users.js';

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

const directory = (good = 'good-token'): Users => ({
  resource: RECORD,
  verify: async (token) => (token === good ? { id: 'ana', roles: ['admin'], can: () => true } : undefined),
  list: async () => [{ id: 'ana', roles: ['admin'], grants: ['*:*'] as const, trusted: false }],
  add: async () => {},
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
  const { host: plugin, contribution } = pluginHost('probe', { path: DIR, paths: [DIR], version: '0.0.0', log: () => {}, say: () => {} });
  plugin.on('authenticated', (event) => { seen.push(event); });
  const { options } = foldHostOptions({ path: DIR, agents: agents(), ...extra }, [contribution]);
  return { host: createHost(options), seen };
}

const hello = (client: ReturnType<ReturnType<typeof createHost>['accept']>) => client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
});

const advertised = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<string[]> => {
  const state = (await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
    snapshot: { state: { agents: { protectedResources?: { resource: string }[] }[] } };
  }).snapshot.state;
  return (state.agents[0]?.protectedResources ?? []).map((one) => one.resource);
};

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

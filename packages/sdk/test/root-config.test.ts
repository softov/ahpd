import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Users } from '../src/types/users.js';

/*
 * The daemon's own keys in root config.
 *
 * The host has no business in a daemon's `config.json`, so the daemon hands one
 * over as a port: `schema`, `values` and `write`. What is under test is the
 * host's half - who is shown those keys, who may write them, what happens to
 * the echo, and what an answer saying a restart is needed puts in root state.
 */

const DIR = '/tmp/root-config';
const RESOURCE = 'ahpd://users';

/** A directory that knows one admin and one member, by the token each presents. */
const directory = (): Users => ({
  resource: { resource: RESOURCE, resource_name: 'ahpd users', authorization_servers: [RESOURCE], required: false },
  verify: async (token) => {
    if (token === 'admin') return { id: 'ana', roles: ['admin'], can: () => true };
    if (token === 'member') return { id: 'bo', roles: ['member'], can: (grant: string) => grant === 'session:read' };
    return undefined;
  },
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
  mint: async () => 'admin',
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

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** Let the notification a dispatch sends, and the write behind it, come to. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** A tool that only a host permitting advanced permission offers. */
const ADVANCED = {
  definition: { name: 'launch_missiles', description: 'Not without saying so', inputSchema: { type: 'object' as const, properties: {} } },
  advancedPermission: true,
  run: () => 'launched',
};

/** A host with a port that says what it was asked, and holds its schema. */
function served() {
  const writes: Record<string, unknown>[] = [];
  let refuseWith: string | undefined;
  let restartNeeded = false;
  // What the daemon's file holds, and what it answers: a `writeOnly` key is
  // held in clear and answered as `<set>`, which is the port's own business.
  let held: Record<string, unknown> = { daemonPort: 9187, advancedTools: false, apiKey: 'sk-secret' };
  const rootConfig: NonNullable<HostOptions['rootConfig']> = {
    schema: () => ({
      type: 'object',
      properties: {
        daemonPort: { type: 'integer', title: 'Daemon Port', description: 'Where this daemon listens.' },
        advancedTools: { type: 'boolean', title: 'Advanced Tools', description: 'Offer the tools that need advanced permission.' },
        apiKey: { type: 'string', title: 'API Key', description: 'A credential.', writeOnly: true },
      },
    }),
    values: async () => ({ ...held, apiKey: held['apiKey'] === undefined ? undefined : '<set>' }),
    write: async (values) => {
      if (refuseWith !== undefined) throw new Error(refuseWith);
      writes.push(values);
      held = { ...held, ...values };
      const answer = restartNeeded;
      restartNeeded = false;
      return answer ? { restartNeeded: true } : {};
    },
  };
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    users: directory(),
    rootConfig,
    tools: [ADVANCED],
  });
  const signedIn = async (token: string, clientId: string): Promise<{ client: Client; heard: Peer & { notes: { method: string; params: unknown }[] } }> => {
    const heard = peer();
    const client = host.accept(heard);
    await client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RESOURCE, token } });
    return { client, heard };
  };
  const rootOf = async (client: Client): Promise<Record<string, unknown>> => {
    const { snapshot } = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as { snapshot: { state: Record<string, unknown> } };
    return snapshot.state;
  };
  /** Every root action this client was sent, the refusal among them included. */
  const heardOnRoot = (heard: Peer & { notes: { method: string; params: unknown }[] }): { action: Record<string, unknown>; rejectionReason?: string }[] =>
    heard.notes.filter((one) => one.method === 'action' && (one.params as { channel?: string }).channel === ROOT)
      .map((one) => one.params as { action: Record<string, unknown>; rejectionReason?: string });
  return { signedIn, rootOf, heardOnRoot, writes, refuseWith: (why: string) => { refuseWith = why; }, answerRestart: (yes: boolean) => { restartNeeded = yes; } };
}

it('shows the daemon its keys beside the host own, and nobody else', async () => {
  const { signedIn, rootOf } = served();
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');

  const adminConfig = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(adminConfig.schema.properties)).toEqual(['defaultShell', 'artifactToolsCompactPrompts', 'deferredTitleGeneration', 'daemonPort', 'advancedTools', 'apiKey']);
  expect(adminConfig.values).toMatchObject({ daemonPort: 9187, advancedTools: false, apiKey: '<set>' });

  const memberConfig = (await rootOf(member.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(memberConfig.schema.properties)).toEqual(['defaultShell', 'artifactToolsCompactPrompts', 'deferredTitleGeneration']);
  expect(memberConfig.values.daemonPort).toBeUndefined();
});

it('refuses a write from a member, and never asks the daemon', async () => {
  const { signedIn, heardOnRoot, writes } = served();
  const member = await signedIn('member', 'member');
  await member.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();
  expect(writes).toEqual([]);
  expect(heardOnRoot(member.heard)).toEqual([expect.objectContaining({ rejectionReason: expect.stringContaining('config:write') })]);
});

it('sends an admin write to the daemon, and its echo to the admins only', async () => {
  const { signedIn, heardOnRoot, writes } = served();
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();
  expect(writes).toEqual([{ daemonPort: 9000 }]);
  expect(heardOnRoot(admin.heard)).toEqual([expect.objectContaining({ action: { type: 'root/configChanged', config: { daemonPort: 9000 } } })]);
  // The envelope is one per host, so the member is sent the same one with the
  // daemon's key taken out of it rather than not sent it at all.
  expect(heardOnRoot(member.heard)).toEqual([expect.objectContaining({ action: { type: 'root/configChanged', config: {} } })]);
});

it('keeps a written daemon key out of the host half, so a member reads none of it', async () => {
  const { signedIn, rootOf } = served();
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { apiKey: 'sk-secret', daemonPort: 1234 } } },
  });
  await settle();
  // The port is the only holder of a daemon key, and the member is shown this
  // map whatever the daemon says, so nothing of the write may have landed in it.
  const seen = (await rootOf(member.client)).config as { values: Record<string, unknown> };
  expect(seen.values.daemonPort).toBeUndefined();
  expect(seen.values.apiKey).toBeUndefined();
  expect(JSON.stringify(seen.values)).not.toContain('sk-secret');
  // The admin is answered the same question, one connection later, and gets
  // the daemon's own answer rather than what it pushed.
  const mine = (await rootOf(admin.client)).config as { values: Record<string, unknown> };
  expect(mine.values).toMatchObject({ daemonPort: 1234, apiKey: '<set>' });
});

it('echoes what the port answers, so a second admin is not sent the credential', async () => {
  const { signedIn, heardOnRoot } = served();
  const ana = await signedIn('admin', 'ana');
  const ben = await signedIn('admin', 'ben');
  await ana.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { apiKey: 'sk-secret', daemonPort: 1234 } } },
  });
  await settle();
  for (const admin of [ana, ben]) {
    expect(heardOnRoot(admin.heard)).toEqual([
      expect.objectContaining({ action: { type: 'root/configChanged', config: { apiKey: '<set>', daemonPort: 1234 } } }),
    ]);
    expect(JSON.stringify(heardOnRoot(admin.heard))).not.toContain('sk-secret');
  }
});

it('refuses what the daemon would not take, naming the key', async () => {
  const { signedIn, heardOnRoot, refuseWith } = served();
  const admin = await signedIn('admin', 'admin');
  refuseWith('daemonPort must be an integer');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 'x' } } },
  });
  await settle();
  expect(heardOnRoot(admin.heard)).toEqual([expect.objectContaining({ rejectionReason: 'daemonPort must be an integer' })]);
});

it('answers restartNeeded in the _meta of every root state, and only once asked', async () => {
  const { signedIn, rootOf, answerRestart } = served();
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');
  expect((await rootOf(admin.client))._meta).toBeUndefined();

  answerRestart(true);
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();
  // Held until the daemon restarts, and said to whoever reads the root, so a
  // member sees the notice without seeing the keys it is about.
  expect((await rootOf(admin.client))._meta).toEqual({ 'ahpd.restartNeeded': true });
  expect((await rootOf(member.client))._meta).toEqual({ 'ahpd.restartNeeded': true });
});

it('gives a running session the advanced tools as soon as the daemon key is written', async () => {
  const { signedIn } = served();
  const admin = await signedIn('admin', 'admin');
  const uri = 'ahp-session:/live';
  await admin.client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const offered = async (): Promise<string[]> => {
    const { snapshot } = await admin.client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { serverTools?: { name: string }[] } };
    };
    return snapshot.state.serverTools?.map((one) => one.name) ?? [];
  };
  expect(await offered()).not.toContain('launch_missiles');

  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { advancedTools: true } } },
  });
  await settle();
  expect(await offered()).toContain('launch_missiles');

  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { advancedTools: false } } },
  });
  await settle();
  expect(await offered()).not.toContain('launch_missiles');
});
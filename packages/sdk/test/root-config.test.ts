import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { uriOf } from '../src/fileuri.js';
import { trusted } from '../src/host/trust.js';
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
  /** The host's own root, admitted by the door token and signed in as nobody. */
  const asRoot = async (clientId: string): Promise<{ client: Client; heard: Peer & { notes: { method: string; params: unknown }[] } }> => {
    const heard = peer();
    const client = host.accept(heard, undefined, true);
    await client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
    return { client, heard };
  };
  return { signedIn, asRoot, rootOf, heardOnRoot, writes, refuseWith: (why: string) => { refuseWith = why; }, answerRestart: (yes: boolean) => { restartNeeded = yes; } };
}

it('shows the daemon its keys beside the host own, and nobody else', async () => {
  const { signedIn, rootOf } = served();
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');

  const adminConfig = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(adminConfig.schema.properties)).toEqual(['defaultShell', 'workspaceTrust', 'artifactToolsCompactPrompts', 'deferredTitleGeneration', 'daemonPort', 'advancedTools', 'apiKey']);
  expect(adminConfig.values).toMatchObject({ daemonPort: 9187, advancedTools: false, apiKey: '<set>' });

  const memberConfig = (await rootOf(member.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(memberConfig.schema.properties)).toEqual(['defaultShell', 'workspaceTrust', 'artifactToolsCompactPrompts', 'deferredTitleGeneration']);
  expect(memberConfig.values.daemonPort).toBeUndefined();
});

it('declares workspaceTrust as VS Code declares it', async () => {
  const { signedIn, rootOf } = served();
  const admin = await signedIn('admin', 'admin');
  const config = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> } };
  // VS Code's own property, `agentHostSchema.ts:864-877`, English strings out
  // of `localize`: a client draws its trust control from this and nothing else.
  expect(config.schema.properties.workspaceTrust).toEqual({
    type: 'object',
    title: 'Workspace Trust',
    properties: {
      enabled: { type: 'boolean', title: 'Enabled' },
      trustedUris: {
        type: 'array',
        title: 'Trusted Folders',
        items: { type: 'string', title: 'Folder URI' },
      },
    },
    required: ['enabled', 'trustedUris'],
    readOnly: true,
  });
});

it('keeps a pushed workspaceTrust on the connection that pushed it', async () => {
  const { signedIn, rootOf } = served();
  const ana = await signedIn('admin', 'ana');
  const ben = await signedIn('admin', 'ben');
  const trust = { enabled: true, trustedUris: [uriOf('/a')] };
  await ana.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { workspaceTrust: trust } } },
  });
  await settle();
  // The person's own, as `defaultShell` is: a window's trust is that window's,
  // and kept in one shared record the last client to connect would set the
  // trust of every session on the host.
  const mine = (await rootOf(ana.client)).config as { values: Record<string, unknown> };
  expect(mine.values.workspaceTrust).toEqual(trust);
  const theirs = (await rootOf(ben.client)).config as { values: Record<string, unknown> };
  expect(theirs.values.workspaceTrust).toBeUndefined();
});

it('reads a folder as trusted from one connection\'s workspaceTrust', () => {
  const ana = { enabled: true, trustedUris: [uriOf('/a')] };
  expect(trusted('/a', ana)).toBe(true);
  // A sibling sharing the first letters is not a child: a bare `startsWith`
  // would open `/ab` under a trusted `/a`.
  expect(trusted('/a/b', ana)).toBe(true);
  expect(trusted('/ab', ana)).toBe(false);
  expect(trusted('/b', ana)).toBe(false);
  // `enabled: false` is VS Code's "workspace trust is turned off", so there is
  // no untrusted folder.
  expect(trusted('/anything', { enabled: false, trustedUris: [] })).toBe(true);
  // And nothing pushed at all, which is an ahpc window, an ahpapp window and
  // every automation - decision
  // `a-folder-is-untrusted-until-a-client-says-otherwise`.
  expect(trusted('/a', undefined)).toBe(false);
  expect(trusted('/a', {})).toBe(false);
});

it('shows the host own root the daemon keys, and the echo of its write', async () => {
  const { asRoot, rootOf, heardOnRoot, writes } = served();
  const root = await asRoot('root');

  const rootConfig = (await rootOf(root.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(rootConfig.schema.properties)).toEqual(['defaultShell', 'workspaceTrust', 'artifactToolsCompactPrompts', 'deferredTitleGeneration', 'daemonPort', 'advancedTools', 'apiKey']);
  expect(rootConfig.values).toMatchObject({ daemonPort: 9187, advancedTools: false, apiKey: '<set>' });

  await root.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();
  expect(writes).toEqual([{ daemonPort: 9000 }]);
  expect(heardOnRoot(root.heard)).toEqual([expect.objectContaining({ action: { type: 'root/configChanged', config: { daemonPort: 9000 } } })]);
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
  expect(heardOnRoot(member.heard)).toEqual([expect.objectContaining({ rejectionReason: expect.stringContaining('config:change') })]);
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
  // The principal is the only thing about the host's own state in there yet:
  // nobody has asked for a restart, and the notice is the whole of what this is
  // about. `ahpd.grants` is beside it and says the same thing to everybody, so
  // it is left out of what these three compare.
  const apart = (meta: unknown): Record<string, unknown> => {
    const { 'ahpd.grants': _grants, ...rest } = (meta ?? {}) as Record<string, unknown>;
    return rest;
  };
  expect(apart((await rootOf(admin.client))._meta)).toEqual({ 'ahpd.principal': 'user:ana' });

  answerRestart(true);
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();
  // Held until the daemon restarts, and said to whoever reads the root, so a
  // member sees the notice without seeing the keys it is about - and each
  // snapshot names the person it was built for rather than the host's.
  expect(apart((await rootOf(admin.client))._meta)).toEqual({ 'ahpd.restartNeeded': true, 'ahpd.principal': 'user:ana' });
  expect(apart((await rootOf(member.client))._meta)).toEqual({ 'ahpd.restartNeeded': true, 'ahpd.principal': 'user:bo' });
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
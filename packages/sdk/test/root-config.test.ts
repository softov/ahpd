import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { uriOf } from '../src/resources/fileuri.js';
import { trusted } from '../src/host/trust.js';
import { CLIENT_QUEUE_BYTES, REPLAY_BYTES, clientQueueBytes, replayBytes } from '../src/host/limits.js';
import { vscodeRootProperties } from '../src/vscoderootconfig.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { HostOptions, RootConfigStore } from '../src/types/host.js';
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

/**
 * The keys of `ROOT_CONFIG_SCHEMA`, in the order the schema writes them.
 *
 * VS Code's keys are spread in first, then the host's own, then the daemon's,
 * and which of the three a key came from is what the cases below read.
 */
const PUSHED_BY_VSCODE = Object.keys(vscodeRootProperties);
const HOST_OWN = ['defaultShell', 'workspaceTrust', 'ahpd.restartNeeded', 'changeWords', 'clientQueueBytes', 'replayBytes'];
const DAEMON_OWN = ['daemonPort', 'advancedTools', 'apiKey'];

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

/**
 * A backend that lists one model, beside the echo one.
 *
 * The check a `model` mode goes through at the push is about a name the host
 * already lists, and the echo backend lists nothing - so a host with only that
 * one accepts any model name, which is the honest answer when there is nothing
 * to contradict it. This is the same backend with one model, so the refusal has
 * a list to read.
 */
const listing = (): Agent => ({
  ...echo({ path: DIR, pace: 0 }),
  provider: 'listing',
  probe: async () => ({ models: [{ id: 'fast', name: 'Fast' }], commands: [], customizations: [] }),
});

/** A tool that only a host permitting advanced permission offers. */
const ADVANCED = {
  definition: { name: 'launch_missiles', description: 'Not without saying so', inputSchema: { type: 'object' as const, properties: {} } },
  advancedPermission: true,
  run: () => 'launched',
};

/**
 * A host with a port that says what it was asked, and holds its schema.
 *
 * `withDaemon` false leaves the port out, which is a host whose `values` is
 * the whole of what was pushed and nothing else.
 */
function served(withDaemon = true) {
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
    agents: [echo({ path: DIR, pace: 0 }), listing()],
    users: directory(),
    ...(withDaemon ? { rootConfig } : {}),
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
  /** What a new connection is told on its handshake's `_meta`. */
  const handshakeOf = async (clientId: string): Promise<Record<string, unknown>> => {
    const client = host.accept(peer());
    const answer = await client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'] } }) as { _meta?: Record<string, unknown> };
    return answer._meta ?? {};
  };
  return {
    host,
    signedIn,
    asRoot,
    rootOf,
    heardOnRoot,
    handshakeOf,
    writes,
    refuseWith: (why: string) => { refuseWith = why; },
    answerRestart: (yes: boolean) => { restartNeeded = yes; },
    /** A key the daemon's file no longer holds, as an edit outside this host makes one. */
    drop: (key: string) => { const { [key]: _gone, ...rest } = held; held = rest; },
  };
}

it('shows the daemon its keys beside the host own, and nobody else', async () => {
  const { signedIn, rootOf } = served();
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');

  const adminConfig = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(adminConfig.schema.properties)).toEqual([...PUSHED_BY_VSCODE, ...HOST_OWN, ...DAEMON_OWN]);
  expect(adminConfig.values).toMatchObject({ daemonPort: 9187, advancedTools: false, apiKey: '<set>' });

  const memberConfig = (await rootOf(member.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(memberConfig.schema.properties)).toEqual([...PUSHED_BY_VSCODE, ...HOST_OWN]);
  expect(memberConfig.values.daemonPort).toBeUndefined();
});

it('declares every key VS Code pushes, as VS Code declares it', async () => {
  // No daemon port, so `values` is the whole of what this host holds: nothing,
  // until a client pushes something. A value with no property is a value a
  // client cannot draw a control for and cannot read back as a setting.
  const { signedIn, rootOf } = served(false);
  const admin = await signedIn('admin', 'admin');
  const config = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };

  /*
   * The keys the checkpoint's client pushes to a remote host, each declared
   * with the property VS Code's agent host gives it at `7516b04bc94`:
   * `common/agentHostSchema.ts`, `common/agentMerge.ts` and
   * `common/automationConfig.ts`.
   *
   * `workspaceTrust` is one of the 44 and is declared by host/66 p1 instead,
   * which its own case reads. The two whose default is a constant of another
   * file are checked below, because copying them is copying a value.
   */
  const PUSHED = [
    'http.proxy', 'http.proxyKerberosServicePrincipal', 'http.noProxy',
    'disableRepoInfoTelemetry', 'telemetryLevel', 'editTelemetryEnabled',
    'sessionSyncEnabled', 'codexAgentEnabled', 'terminalAutoApproveEnabled',
    'globalAutoApproveEnabled', 'autoApprovePolicyRestricted', 'workspaceTrust',
    'autoReplyEnabled', 'systemProxyEnabled', 'githubMcpServerEnabled',
    'mcpToolRoutingEnabled', 'mcpConnectorsEnabled', 'markdownPlanRichLinksEnabled',
    'workspaceSnapshotEnabled', 'agentOrchestrationLimits', 'artifactTools',
    'canvasesEnabled', 'autoAttachPullRequests', 'overlapProviderPreparation',
    'migrateLegacyCopilotCliEnabled', 'sessionCatalogEnabled', 'showExternalSessions',
    'autoArchiveMergedSessionsAfterDays', 'autoDeleteArchivedMergedSessionsAfterDays',
    'copilotMultiRootEnabled', 'claudeMultiRootEnabled', 'codexMultiRootEnabled',
    'editAutoApprovePatterns', 'terminalAutoApproveRules',
    'agentMerge.enabled', 'agentMerge.addressReviews', 'agentMerge.fixCI',
    'agentMerge.resolveConflicts', 'agentMerge.mergePullRequest', 'agentMerge.mergeMethod',
    'agentMerge.replyAttribution', 'automationsEnabled', 'automationRunTimeoutMinutes',
  ];
  // The keys that are missing, rather than a boolean: one left out says which.
  expect(PUSHED.filter((key) => !(key in config.schema.properties))).toEqual([]);
  expect(config.values).toEqual({});

  // `TelemetryConfiguration.ON` and its three siblings, as literals.
  expect(config.schema.properties.telemetryLevel).toEqual({
    type: 'string',
    title: 'Telemetry Level',
    description: 'Most restrictive telemetry level requested by connected clients.',
    enum: ['all', 'error', 'crash', 'off'],
    default: 'all',
  });
  expect(config.schema.properties['agentMerge.mergeMethod']).toEqual({
    type: 'string',
    title: 'Merge Method',
    enum: ['auto', 'squash', 'merge', 'rebase'],
    default: 'auto',
  });
  // `ChatExternalSessionsMode` and `DEFAULT_EDIT_AUTO_APPROVE_PATTERNS` come
  // from https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/chat/common/chatSettings.ts
  // and are resolved here: twenty patterns, the eleven always-checked ones
  // spread after the nine the file writes.
  expect(config.schema.properties.showExternalSessions).toMatchObject({
    enum: ['none', 'recent', 'last24Hours', 'last7Days', 'last30Days'],
    enumDescriptions: [
      'Do not show external sessions.',
      'Show up to the 2 most recent external sessions updated in the last 7 days. At startup, external sessions older than the second-most-recently updated local session are hidden.',
      'Show external sessions updated in the last 24 hours.',
      'Show external sessions updated in the last 7 days.',
      'Show external sessions updated in the last 30 days.',
    ],
    default: 'none',
  });
  const patterns = (config.schema.properties.editAutoApprovePatterns as { default: Record<string, boolean> }).default;
  expect(Object.keys(patterns)).toHaveLength(20);
  expect(Object.keys(patterns)).toContain('**/.mcp.json');
  expect(patterns['**/*']).toBe(true);
});

it('lists globalAutoApproveEnabled in the root config schema with default false', async () => {
  const { signedIn, rootOf } = served();
  const admin = await signedIn('admin', 'admin');
  const config = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> } };
  /*
   * A key `trust.ts` reads, and the reason it is declared at all rather than
   * merely drawn: a host that approves every tool call is one a person has to
   * be able to see and turn off.
   *
   * The property is VS Code's own, `agentHostSchema.ts:852` at `7516b04bc94`,
   * as every key in `vscodeRootProperties` is. Its default is what a client
   * draws before anybody pushes one, and `false` is what the reading of a
   * missing key already does.
   */
  expect(config.schema.properties.globalAutoApproveEnabled).toEqual({
    type: 'boolean',
    title: 'Global Auto Approve',
    description: "Whether VS Code's global auto-approve setting is enabled. When `true`, every tool call is auto-approved, equivalent to a session using Allow all.",
    default: false,
  });
  // Nothing is pushed, so no value is shown: the default above is the client's
  // own to draw, and this host holds no key it was not sent.
  const held = (await rootOf(admin.client)).config as { values: Record<string, unknown> };
  expect(held.values.globalAutoApproveEnabled).toBeUndefined();
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

/*
 * The window's keys are one value for the whole host, which the last push from
 * any window sets and every client reads, as the reference host keeps one root
 * config for every window connected to it.
 * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L47-L55
 */
it('keeps a pushed workspaceTrust for the whole host, the last push the one held', async () => {
  const { signedIn, rootOf } = served();
  const ana = await signedIn('admin', 'ana');
  const ben = await signedIn('admin', 'ben');
  const trust = { enabled: true, trustedUris: [uriOf('/a')] };
  await ana.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { workspaceTrust: trust } } },
  });
  await settle();
  const mine = (await rootOf(ana.client)).config as { values: Record<string, unknown> };
  expect(mine.values.workspaceTrust).toEqual(trust);
  const theirs = (await rootOf(ben.client)).config as { values: Record<string, unknown> };
  expect(theirs.values.workspaceTrust).toEqual(trust);

  const later = { enabled: true, trustedUris: [uriOf('/b')] };
  await ben.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { workspaceTrust: later } } },
  });
  await settle();
  expect(((await rootOf(ana.client)).config as { values: Record<string, unknown> }).values.workspaceTrust).toEqual(later);
});

it('keeps the three approval keys for the whole host', async () => {
  const { signedIn, rootOf } = served();
  const ana = await signedIn('admin', 'ana');
  const ben = await signedIn('admin', 'ben');
  const pushed = {
    terminalAutoApproveEnabled: true,
    terminalAutoApproveRules: { 'make test': true },
    editAutoApprovePatterns: { '**/*': true },
  };
  await ana.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: pushed } },
  });
  await settle();
  const mine = (await rootOf(ana.client)).config as { values: Record<string, unknown> };
  expect(mine.values).toMatchObject(pushed);
  const theirs = (await rootOf(ben.client)).config as { values: Record<string, unknown> };
  expect(theirs.values).toMatchObject(pushed);
});

/*
 * A push that changes nothing is neither applied nor said, as VS Code's host
 * neither reduces nor emits one: a window mirrors its settings again at every
 * connect and save, and an echo of the values the root holds has every window
 * watching the root react to a change that is not one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2882-L2894
 */
it('says nothing for a push that changes nothing, a replace with the values held included, as VS Code\'s host', async () => {
  const { signedIn, rootOf, heardOnRoot } = served(false);
  const ana = await signedIn('admin', 'ana');
  const ben = await signedIn('admin', 'ben');
  const said = (): number => heardOnRoot(ben.heard).filter((one) => one.action.type === 'root/configChanged').length;
  const push = async (action: Record<string, unknown>): Promise<void> => {
    await ana.client.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', ...action } } });
    await settle();
  };
  await push({ config: { terminalAutoApproveEnabled: true } });
  expect(said()).toBe(1);

  await push({ config: { terminalAutoApproveEnabled: true } });
  expect(said()).toBe(1);
  const { values } = (await rootOf(ana.client)).config as { values: Record<string, unknown> };
  await push({ config: values, replace: true });
  expect(said()).toBe(1);
  expect(heardOnRoot(ana.heard).filter((one) => one.action.type === 'root/configChanged')).toHaveLength(1);

  await push({ config: { terminalAutoApproveEnabled: false } });
  expect(said()).toBe(2);
});

/*
 * `eligibleForAutoApproval` is the operator's daemon setting: VS Code's agent
 * host declares no root config key for it, and takes the setting's policy
 * value alone.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L530-L531
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L22-L26
 */
it('declares no eligibleForAutoApproval in root config, as VS Code\'s host declares none, and refuses a push of it', async () => {
  const { signedIn, rootOf, heardOnRoot } = served(false);
  const admin = await signedIn('admin', 'admin');

  const { schema } = (await rootOf(admin.client)).config as { schema: { properties: Record<string, Record<string, unknown>> } };
  expect(schema.properties).not.toHaveProperty('eligibleForAutoApproval');

  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { eligibleForAutoApproval: { 'tracker/create': false } } } },
  });
  await settle();
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ rejectionReason: expect.stringContaining('eligibleForAutoApproval') }),
  ]);
  const held = (await rootOf(admin.client)).config as { values: Record<string, unknown> };
  expect(held.values).not.toHaveProperty('eligibleForAutoApproval');
});

it('takes the three approval keys only with config:change, since they are the host\'s', async () => {
  const { signedIn, rootOf, heardOnRoot } = served(false);
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');
  const pushed = { terminalAutoApproveRules: { 'make test': true }, editAutoApprovePatterns: { '**/*': true } };
  const push = async (client: Client): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: pushed } },
    });
    await settle();
  };
  // The rules every session on the host reads are the host's: saying them
  // changes what everybody's sessions run, so it needs config:change, as a
  // rule about every session's tool calls does.
  await push(member.client);
  expect(heardOnRoot(member.heard)).toEqual([
    expect.objectContaining({ rejectionReason: expect.stringContaining('config:change') }),
  ]);
  await push(admin.client);
  // What the admin was answered, which is its own push taken: a refusal of
  // somebody else's push says nothing about this one.
  expect(heardOnRoot(admin.heard).filter((one) => one.rejectionReason === undefined)).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: pushed } }),
  ]);
  const { values } = (await rootOf(member.client)).config as { values: Record<string, unknown> };
  expect(values).toMatchObject(pushed);
});

it('declares changeWords with its four modes and the session title as the default', async () => {
  const { signedIn, rootOf } = served();
  const admin = await signedIn('admin', 'admin');
  const config = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  /*
   * This host's own key, so the reference client pushes nothing for it and
   * draws whatever is here. The default is the session title because that is
   * what this host wrote before there was a key: a client that never pushes
   * one sees no change at all.
   */
  expect(config.schema.properties.changeWords).toMatchObject({
    type: 'object',
    title: 'Change Words',
    properties: {
      mode: { type: 'string', enum: ['session-title', 'forced', 'model', 'agent'], default: 'session-title' },
      provider: { type: 'string' },
      model: { type: 'string' },
    },
    required: ['mode'],
  });
  // Nothing pushed, so no value is held: the default above is the client's to draw.
  expect(config.values.changeWords).toBeUndefined();
});

it('keeps a changeWords push, and reads it back as a setting', async () => {
  const { signedIn, rootOf, heardOnRoot } = served();
  const admin = await signedIn('admin', 'admin');
  for (const mode of ['session-title', 'forced']) {
    await admin.client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { changeWords: { mode } } } },
    });
    await settle();
    const held = (await rootOf(admin.client)).config as { values: Record<string, unknown> };
    expect(held.values.changeWords).toEqual({ mode });
  }
  // Whole, as it was pushed, and not one key at a time.
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: { changeWords: { mode: 'session-title' } } } }),
    expect.objectContaining({ action: { type: 'root/configChanged', config: { changeWords: { mode: 'forced' } } } }),
  ]);
});

/*
 * A `model` mode names a backend and a model, and the host refuses one it
 * cannot ask.
 *
 * The refusal is at the push rather than at the commit, because a setting that
 * reads back and then does nothing is the worst of the three answers. What the
 * host has to read is what it lists - the boot probe's models - and a provider
 * that lists none is one nothing can contradict, so its models are accepted.
 */
it('refuses a model mode naming a provider this host does not serve', async () => {
  const { signedIn, heardOnRoot } = served();
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { changeWords: { mode: 'model', provider: 'nobody', model: 'fast' } } } },
  });
  await settle();
  // The refusal the sender alone hears, as every refusal is: no state moved for
  // anybody, and no connection was sent a setting this host cannot honour.
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ rejectionReason: 'root config names a provider this host does not serve: nobody' }),
  ]);
});

it('refuses a model mode naming a model the provider does not list', async () => {
  const { signedIn, heardOnRoot } = served();
  const admin = await signedIn('admin', 'admin');
  // The probe is what fills the list, and it is answered after the handshake.
  await settle();
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { changeWords: { mode: 'model', provider: 'listing', model: 'sluggish' } } } },
  });
  await settle();
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ rejectionReason: 'root config names a model listing does not list: sluggish' }),
  ]);
});

it('keeps a model mode naming a model the provider lists, and a provider that lists none', async () => {
  const { signedIn, rootOf } = served();
  const admin = await signedIn('admin', 'admin');
  await settle();
  const listed = { mode: 'model', provider: 'listing', model: 'fast' };
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { changeWords: listed } } },
  });
  await settle();
  expect(((await rootOf(admin.client)).config as { values: Record<string, unknown> }).values.changeWords).toEqual(listed);
  // The echo backend lists no models at all, so there is nothing to refuse it by.
  const quiet = { mode: 'model', provider: 'echo', model: 'anything' };
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { changeWords: quiet } } },
  });
  await settle();
  expect(((await rootOf(admin.client)).config as { values: Record<string, unknown> }).values.changeWords).toEqual(quiet);
});

it('refuses a model mode with no provider only when the provider arrives, so a two-part push works', async () => {
  const { signedIn, rootOf, heardOnRoot } = served();
  const admin = await signedIn('admin', 'admin');
  await settle();
  // The mode alone: nothing named, so nothing to refuse. The commit falls back
  // to the session title and says why, which is a whole answer.
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { changeWords: { mode: 'model' } } } },
  });
  await settle();
  expect(((await rootOf(admin.client)).config as { values: Record<string, unknown> }).values.changeWords).toEqual({ mode: 'model' });
  // And the name in the next push is checked against what the root now holds
  // as well as what this one carries, which is where the refusal lives.
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { changeWords: { provider: 'nobody', model: 'fast' } } } },
  });
  await settle();
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: { changeWords: { mode: 'model' } } } }),
    expect.objectContaining({ rejectionReason: 'root config names a provider this host does not serve: nobody' }),
  ]);
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
  // every automation.
  expect(trusted('/a', undefined)).toBe(false);
  expect(trusted('/a', {})).toBe(false);
});

it('shows the host own root the daemon keys, and the echo of its write', async () => {
  const { asRoot, rootOf, heardOnRoot, writes } = served();
  const root = await asRoot('root');

  const rootConfig = (await rootOf(root.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(rootConfig.schema.properties)).toEqual([...PUSHED_BY_VSCODE, ...HOST_OWN, ...DAEMON_OWN]);
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

/*
 * The two limits on what the host holds for a client that is not reading.
 *
 * Declared as a client reads them - one type, a title, a description and a
 * default - because that is all the protocol's property schema carries: a
 * bound is a sentence in the description rather than a `minimum`, the way the
 * daemon's own keys are declared.
 */
it('declares the two limits, each with its default', async () => {
  const { signedIn, rootOf } = served(false);
  const admin = await signedIn('admin', 'admin');
  const { schema } = (await rootOf(admin.client)).config as { schema: { properties: Record<string, Record<string, unknown>> } };

  expect(schema.properties.clientQueueBytes).toEqual({
    type: 'number',
    title: 'Client Queue Bytes',
    description: expect.stringContaining('At least 1048576; 0 sets no limit'),
    default: 16777216,
  });
  expect(schema.properties.replayBytes).toEqual({
    type: 'number',
    title: 'Replay Bytes',
    description: expect.stringContaining('At least 1048576; 0 sets no limit'),
    default: 33554432,
  });
});

it('reads a pushed limit at the time of use, and its default when it cannot', async () => {
  // No daemon port, so `values` is this host's half alone - which is the map
  // the reader is handed, since a host key is kept where the root shows it.
  const { signedIn, rootOf } = served(false);
  const admin = await signedIn('admin', 'admin');
  const held = async (): Promise<Record<string, unknown>> =>
    ((await rootOf(admin.client)).config as { values: Record<string, unknown> }).values;
  const push = async (config: Record<string, unknown>): Promise<void> => {
    await admin.client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config } },
    });
    await settle();
  };

  // Nothing pushed: the defaults, which is what a host nobody configured runs
  // on, and what a value reads as once it is taken back.
  expect(clientQueueBytes(await held())).toBe(CLIENT_QUEUE_BYTES);
  expect(replayBytes(await held())).toBe(REPLAY_BYTES);

  await push({ clientQueueBytes: 4194304, replayBytes: 8388608 });
  expect(clientQueueBytes(await held())).toBe(4194304);
  expect(replayBytes(await held())).toBe(8388608);

  /*
   * A value under the least either key may be, and one that is not a number:
   * kept as pushed, because a declared key is a setting a client reads back,
   * and read as the default - a host that closed a client under any burst at
   * all is not a limit anybody means.
   */
  await push({ clientQueueBytes: 1024, replayBytes: 'plenty' });
  expect(await held()).toMatchObject({ clientQueueBytes: 1024, replayBytes: 'plenty' });
  expect(clientQueueBytes(await held())).toBe(CLIENT_QUEUE_BYTES);
  expect(replayBytes(await held())).toBe(REPLAY_BYTES);

  /*
   * `0` sets no limit, VS Code's: its host writes to an open socket whatever
   * the socket holds, and replays by the count alone.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/webSocketTransport.ts#L80-L85
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4247-L4250
   */
  await push({ clientQueueBytes: 0, replayBytes: 0 });
  expect(clientQueueBytes(await held())).toBe(Number.POSITIVE_INFINITY);
  expect(replayBytes(await held())).toBe(Number.POSITIVE_INFINITY);
});

it('refuses a limit pushed without config:write, as it does any other host key', async () => {
  const { signedIn, rootOf, heardOnRoot } = served(false);
  const member = await signedIn('member', 'member');
  await member.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { clientQueueBytes: 4194304 } } },
  });
  await settle();
  expect(heardOnRoot(member.heard)).toEqual([
    expect.objectContaining({ rejectionReason: expect.stringContaining('config:change') }),
  ]);
  // And nothing moved: the member may read the host's own keys, and the one it
  // was refused reads as the default.
  const { values } = (await rootOf(member.client)).config as { values: Record<string, unknown> };
  expect(values.clientQueueBytes).toBeUndefined();
  expect(clientQueueBytes(values)).toBe(CLIENT_QUEUE_BYTES);
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

it('gives the echo of a daemon key its writer\'s origin, once the daemon has answered', async () => {
  const { signedIn, heardOnRoot } = served();
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, clientSeq: 6, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();
  // The port answers a write later than the dispatch was applied, and the
  // echo goes out with the answer: the admin is still holding the action.
  expect(heardOnRoot(admin.heard)).toEqual([expect.objectContaining({ origin: { clientId: 'admin', clientSeq: 6 } })]);
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

/*
 * A key nobody declares, applied and kept as a declared one is, as VS Code's
 * host applies a root patch whatever keys it carries: what the host has a
 * client learns from the declared properties.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2878-L2898
 */
it('applies an undeclared key with the rest of the push', async () => {
  const { signedIn, rootOf, heardOnRoot } = served();
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { telemetryLevel: 'off', nonsense: 1 } } },
  });
  await settle();
  expect(heardOnRoot(admin.heard)).toEqual([expect.objectContaining({ action: { type: 'root/configChanged', config: { telemetryLevel: 'off', nonsense: 1 } } })]);
  const held = (await rootOf(admin.client)).config as { values: Record<string, unknown> };
  expect(held.values.telemetryLevel).toBe('off');
  expect(held.values.nonsense).toBe(1);
});

it('applies a push whose every key is undeclared, and asks the daemon for none of them', async () => {
  const { signedIn, rootOf, heardOnRoot, writes } = served();
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { nonsense: 1, moreNonsense: 2 } } },
  });
  await settle();
  const heard = heardOnRoot(admin.heard);
  expect(heard).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: { nonsense: 1, moreNonsense: 2 } } }),
  ]);
  expect(heard[0]).not.toHaveProperty('rejectionReason');
  expect((await rootOf(admin.client)).config).toMatchObject({ values: { nonsense: 1, moreNonsense: 2 } });
  expect(writes).toEqual([]);
});

/*
 * The three keys VS Code 1.140 dropped, which a client older than that still
 * pushes: the compact artifact wording and the two title-generation switches.
 * None is declared, so no client draws a control for one, and each is kept as
 * pushed, as any key is.
 */
it('keeps the keys VS Code dropped as pushed, and declares none of them', async () => {
  // No daemon port, so `values` is this host's half alone.
  const { signedIn, rootOf, heardOnRoot } = served(false);
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { artifactToolsCompactPrompts: true, telemetryLevel: 'off' } } },
  });
  await settle();
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: { artifactToolsCompactPrompts: true, telemetryLevel: 'off' } } }),
  ]);
  const held = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(held.values).toEqual({ artifactToolsCompactPrompts: true, telemetryLevel: 'off' });
  expect(held.schema.properties).not.toHaveProperty('artifactToolsCompactPrompts');
  expect(held.schema.properties).not.toHaveProperty('deferredTitleGeneration');
  expect(held.schema.properties).not.toHaveProperty('activeAgentTitleGeneration');
});

it('keeps every key a push that replaces the lot carries', async () => {
  // No daemon port, so `values` is this host's half alone and the whole of it
  // is what these two pushes left.
  const { signedIn, rootOf } = served(false);
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { defaultShell: '/bin/zsh', telemetryLevel: 'error' } } },
  });
  await settle();
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', replace: true, config: { telemetryLevel: 'off', nonsense: 1 } } },
  });
  await settle();
  // The connection's own shell is cleared by the replace, and `nonsense` is
  // kept beside what it set.
  const held = (await rootOf(admin.client)).config as { values: Record<string, unknown> };
  expect(held.values).toEqual({ telemetryLevel: 'off', nonsense: 1 });
});

/** A store over one bag, as the daemon's file is one, which every host built over it reads. */
const kept = (values: Record<string, unknown> = {}): RootConfigStore & { values: Record<string, unknown> } => {
  const store = {
    values,
    read: () => store.values,
    write: (next: Record<string, unknown>) => { store.values = next; },
  };
  return store;
};

/** The root config values a host built over `store` opens with, as a client subscribing first reads them. */
const startedWith = async (store: RootConfigStore): Promise<Record<string, unknown>> => {
  const host = createHost({ path: DIR, agents: [echo({ path: DIR, pace: 0 })], rootConfigStore: store });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'later', protocolVersions: ['0.9.0'] } });
  const { snapshot } = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as { snapshot: { state: { config: { values: Record<string, unknown> } } } };
  await host.close();
  return snapshot.state.config.values;
};

/*
 * A start brings back the root config a client pushed, the declared keys
 * alone, each with a value its property accepts, as VS Code's host writes
 * every key after a push and restores its persisted values schema by schema.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1284-L1313
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1371-L1399
 */
it('keeps every key a push carries for the next start, which brings back the declared ones its schema accepts', async () => {
  const store = kept();
  const host = createHost({ path: DIR, agents: [echo({ path: DIR, pace: 0 })], rootConfigStore: store });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'one', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  const pushed = { defaultShell: '/bin/zsh', telemetryLevel: 'off', nonsense: 1, clientQueueBytes: 'lots' };
  await client.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', config: pushed } } });
  await settle();
  expect(store.values).toEqual(pushed);
  await host.close();

  // `nonsense` has no property, and `clientQueueBytes` is a number.
  expect(await startedWith(store)).toEqual({ defaultShell: '/bin/zsh', telemetryLevel: 'off' });
});

/*
 * Of the declared keys, a start leaves out the six a window pushes at every
 * connect and that gate a question or a policy, VS Code's
 * `clientOwnedApprovalRootConfigKeys`: restored, a value kept from one window
 * could grant again what was tightened while the host was stopped. The terminal
 * rules and the host's own permissions come back with the rest.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1401-L1416
 */
it('leaves the client-owned approval and policy keys a store kept to the next push, as VS Code\'s host restores none of them', async () => {
  const store = kept({
    globalAutoApproveEnabled: true,
    autoApprovePolicyRestricted: false,
    terminalAutoApproveEnabled: true,
    editAutoApprovePatterns: { '**/*': true },
    autoReplyEnabled: true,
    workspaceTrust: { enabled: true, trustedUris: ['file:///work'] },
    terminalAutoApproveRules: { npm: true },
    permissions: { allow: ['WebFetch(example.com)'], deny: [] },
  });
  expect(await startedWith(store)).toEqual({
    terminalAutoApproveRules: { npm: true },
    permissions: { allow: ['WebFetch(example.com)'], deny: [] },
  });
});

it('asks the daemon for its key alone when an undeclared key is beside it', async () => {
  const { signedIn, heardOnRoot, writes } = served();
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000, nonsense: 1 } } },
  });
  await settle();
  // The port declares `daemonPort`, so it is the one asked; `nonsense` is the
  // host's to keep, and no key the daemon writes into `config.json`.
  expect(writes).toEqual([{ daemonPort: 9000 }]);
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: { daemonPort: 9000, nonsense: 1 } } }),
  ]);
});

/** The root config's values, as one snapshot of the root holds them. */
const valuesOf = (state: Record<string, unknown>): Record<string, unknown> =>
  (state.config as { values: Record<string, unknown> }).values;

/*
 * A key the daemon's file no longer holds is taken back by a replacement of
 * the root's values, which is the protocol's only way to take one back: its
 * reducer merges a config in, "Merges (or replaces) `config.values`", so a
 * `null` sent as a merge is a value every client then holds under that key.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/reducer.ts#L34
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/root-channel.md#L100
 */
it('takes back a daemon key the file no longer holds, by replacing the root\'s values', async () => {
  const { host, signedIn, rootOf, heardOnRoot, drop } = served();
  const admin = await signedIn('admin', 'admin');
  // A key of this host's own beside the daemon's, which the replacement keeps.
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { defaultShell: 'fish' } } },
  });
  await settle();
  expect(valuesOf(await rootOf(admin.client))['daemonPort']).toBe(9187);

  drop('daemonPort');
  await host.daemonValuesChanged();
  await settle();

  const said = heardOnRoot(admin.heard).map((heard) => heard.action).filter((action) => action.type === 'root/configChanged');
  const last = said.at(-1);
  expect(last?.replace).toBe(true);
  // The values it carries are every value the root holds, less the key that went.
  const carried = last?.config as Record<string, unknown>;
  expect(Object.hasOwn(carried, 'daemonPort')).toBe(false);
  expect(carried['advancedTools']).toBe(false);
  expect(carried['defaultShell']).toBe('fish');
  const now = valuesOf(await rootOf(admin.client));
  expect(Object.hasOwn(now, 'daemonPort')).toBe(false);
  expect(now['defaultShell']).toBe('fish');
});

it('says restartNeeded in the root config to every reader of the root, once asked', async () => {
  const { signedIn, rootOf, heardOnRoot, handshakeOf, answerRestart } = served();
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');
  const told = (heard: { notes: { method: string; params: unknown }[] }): unknown[] =>
    heard.notes.filter((one) => one.method === 'x-ahpd/restartNeeded').map((one) => one.params);
  // Declared read-only, so a client shows it and has no control to set it.
  expect(((await rootOf(admin.client)).config as { schema: { properties: Record<string, { readOnly?: boolean }> } })
    .schema.properties['ahpd.restartNeeded']?.readOnly).toBe(true);
  expect(valuesOf(await rootOf(admin.client))['ahpd.restartNeeded']).toBeUndefined();
  expect(told(admin.heard)).toEqual([]);

  answerRestart(true);
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();
  // Held until the daemon restarts, and said to whoever reads the root as the
  // host's own `root/configChanged`, so a member reads the mark without seeing
  // the keys it is about.
  for (const one of [admin, member]) {
    expect(heardOnRoot(one.heard).map((heard) => heard.action)
      .filter((action) => Object.hasOwn((action.config ?? {}) as Record<string, unknown>, 'ahpd.restartNeeded')))
      .toEqual([{ type: 'root/configChanged', config: { 'ahpd.restartNeeded': true } }]);
    expect(told(one.heard)).toEqual([{ channel: ROOT }]);
    expect(valuesOf(await rootOf(one.client))['ahpd.restartNeeded']).toBe(true);
  }
  // The root's config is where the mark is, and the handshake carries no copy.
  expect((await handshakeOf('after'))['ahpd.restartNeeded']).toBeUndefined();
});

/*
 * VS Code's settings editor draws every root config property as editable and
 * saves the whole document as one `replace`, so the mark goes back with it.
 * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSettingsFileSystemProvider.ts#L52-L67
 */
it('keeps the restart mark when a client writes the root config whole with the mark unchanged', async () => {
  const { signedIn, rootOf, heardOnRoot, answerRestart } = served();
  const admin = await signedIn('admin', 'admin');
  answerRestart(true);
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();

  const saved = valuesOf(await rootOf(admin.client));
  expect(saved['ahpd.restartNeeded']).toBe(true);
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, clientSeq: 7, action: { type: 'root/configChanged', replace: true, config: { ...saved } } },
  });
  await settle();

  // The whole root as it is moves nothing, so nothing is kept or said, as VS
  // Code's host drops a root config change that leaves its values as they are.
  const echoed = heardOnRoot(admin.heard).filter((heard) => heard.action.replace === true);
  expect(echoed).toEqual([]);
  expect(valuesOf(await rootOf(admin.client))['ahpd.restartNeeded']).toBe(true);
});

/*
 * A push naming the mark is said as it was sent, as VS Code's host takes a root
 * push as given: it reduces the client's action as the client sent it.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2881-L2899
 */
it('says a client\'s restart mark as it was sent', async () => {
  const { signedIn, rootOf, heardOnRoot, answerRestart } = served();
  const admin = await signedIn('admin', 'admin');
  answerRestart(true);
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000 } } },
  });
  await settle();

  // A save made from a copy read before the mark was set says it is false.
  const stale = { ...valuesOf(await rootOf(admin.client)), 'ahpd.restartNeeded': false };
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, clientSeq: 8, action: { type: 'root/configChanged', replace: true, config: stale } },
  });
  await settle();
  const echoed = heardOnRoot(admin.heard).filter((heard) => heard.action.replace === true);
  expect(echoed.map((heard) => [heard.rejectionReason, (heard.action.config as Record<string, unknown>)['ahpd.restartNeeded']]))
    .toEqual([[undefined, false]]);
  expect(valuesOf(await rootOf(admin.client))['ahpd.restartNeeded']).toBe(false);

  // A push that merges is said as sent the same way.
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, clientSeq: 9, action: { type: 'root/configChanged', config: { 'ahpd.restartNeeded': true } } },
  });
  await settle();
  const merged = heardOnRoot(admin.heard).filter((heard) => heard.action.replace !== true
    && Object.hasOwn((heard.action.config ?? {}) as Record<string, unknown>, 'ahpd.restartNeeded'));
  expect(merged.at(-1)?.action.config).toEqual({ 'ahpd.restartNeeded': true });
  expect(valuesOf(await rootOf(admin.client))['ahpd.restartNeeded']).toBe(true);
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

/*
 * A provider's settings at the top of the root config, as VS Code registers a
 * provider's configuration: its properties join the schema, a default is held
 * where nothing set the key, and the registration without its properties is
 * the root's `_meta['vscode.agentCustomizationSettings']` entry.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1319-L1340
 */
it('declares a provider\'s settings at the top of the root config, its default held, and lists its page in _meta', async () => {
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    providerConfigurations: [{
      provider: 'sandbox',
      title: 'Sandbox',
      description: 'Where commands run.',
      settings: [{ key: 'sandbox.enabled', group: 'Sandbox' }, { key: 'sandbox.allowedDomains', group: 'Network', kind: 'multiline' }],
      properties: {
        'sandbox.enabled': { type: 'boolean', title: 'Sandbox', default: false },
        'sandbox.allowedDomains': { type: 'string', title: 'Allowed domains' },
      },
    }],
  });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'one', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  const root = async (): Promise<{ config: { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> }; _meta?: Record<string, unknown> }> =>
    ((await client.handle({ method: 'subscribe', params: { channel: ROOT } })) as { snapshot: { state: never } }).snapshot.state;

  const before = await root();
  expect(before.config.schema.properties['sandbox.enabled']).toEqual({ type: 'boolean', title: 'Sandbox', default: false });
  expect(before.config.schema.properties['sandbox.allowedDomains']).toEqual({ type: 'string', title: 'Allowed domains' });
  expect(before.config.values['sandbox.enabled']).toBe(false);
  expect(Object.hasOwn(before.config.values, 'sandbox.allowedDomains')).toBe(false);
  expect(before._meta?.['vscode.agentCustomizationSettings']).toEqual([{
    provider: 'sandbox',
    title: 'Sandbox',
    description: 'Where commands run.',
    settings: [{ key: 'sandbox.enabled', group: 'Sandbox' }, { key: 'sandbox.allowedDomains', group: 'Network', kind: 'multiline' }],
  }]);

  // Declared, so a push of it is kept and read back as any root setting.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { 'sandbox.enabled': true, 'sandbox.allowedDomains': 'example.test' } } },
  });
  await settle();
  const after = await root();
  expect(after.config.values['sandbox.enabled']).toBe(true);
  expect(after.config.values['sandbox.allowedDomains']).toBe('example.test');
  await host.close();
});
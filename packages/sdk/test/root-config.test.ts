import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { uriOf } from '../src/resources/fileuri.js';
import { trusted } from '../src/host/trust.js';
import { CLIENT_QUEUE_BYTES, REPLAY_BYTES, clientQueueBytes, replayBytes } from '../src/host/limits.js';
import { vscodeRootProperties } from '../src/vscoderootconfig.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
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
  return { signedIn, asRoot, rootOf, heardOnRoot, handshakeOf, writes, refuseWith: (why: string) => { refuseWith = why; }, answerRestart: (yes: boolean) => { restartNeeded = yes; } };
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
    'editAutoApprovePatterns', 'terminalAutoApproveRules', 'eligibleForAutoApproval',
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

it('keeps the three approval keys on the connection that pushed them', async () => {
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
  // A window's command rules are the window's, like its trust and its shell: a
  // session is started by one window, and the last client to connect must not
  // decide the rules of every session on the host.
  const mine = (await rootOf(ana.client)).config as { values: Record<string, unknown> };
  expect(mine.values).toMatchObject(pushed);
  const theirs = (await rootOf(ben.client)).config as { values: Record<string, unknown> };
  expect(theirs.values.terminalAutoApproveEnabled).toBeUndefined();
  expect(theirs.values.terminalAutoApproveRules).toBeUndefined();
  expect(theirs.values.editAutoApprovePatterns).toBeUndefined();
});

it('declares eligibleForAutoApproval as VS Code does, and keeps it for the whole host', async () => {
  const { signedIn, rootOf, heardOnRoot } = served(false);
  const admin = await signedIn('admin', 'admin');
  const member = await signedIn('member', 'member');

  /*
   * The property is `chat.tools.eligibleForAutoApproval`'s,
   * `chat.shared.contribution.ts:881` at `a959ba62444`, under the name this
   * host reads: a map of tool name to boolean, where `false` means the call
   * asks every time. `additionalProperties` is the value each member carries.
   * `propertyNames`, which the setting fills with the names a client draws, is
   * not copied: a rule for a tool this host has never heard of is still a rule.
   */
  const { schema } = (await rootOf(admin.client)).config as { schema: { properties: Record<string, Record<string, unknown>> } };
  expect(schema.properties.eligibleForAutoApproval).toEqual({
    type: 'object',
    title: 'Eligible for Auto Approval',
    description: "Controls which tools are eligible for automatic approval. Tools set to 'false' will always present a confirmation and will never offer the option to auto-approve. The default behavior (or setting a tool to 'true') may result in the tool offering auto-approval options.",
    default: {},
    additionalProperties: { type: 'boolean', title: 'Eligible' },
  });

  const rules = { 'tracker/create': false };
  const push = async (client: Client): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { eligibleForAutoApproval: rules } } },
    });
    await settle();
  };

  // A rule about every session's tool calls is the host's, not one window's:
  // saying it changes what everybody's sessions do, so it needs config:change.
  await push(member.client);
  expect(heardOnRoot(member.heard)).toEqual([
    expect.objectContaining({ rejectionReason: expect.stringContaining('config:change') }),
  ]);

  await push(admin.client);
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: { eligibleForAutoApproval: rules } } }),
  ]);
  // Kept in the host's half, so the member that could not push it reads it.
  const held = (await rootOf(member.client)).config as { values: Record<string, unknown> };
  expect(held.values.eligibleForAutoApproval).toEqual(rules);
});

it('takes the three approval keys from a member, needing no config:change', async () => {
  const { signedIn, rootOf, heardOnRoot } = served(false);
  const member = await signedIn('member', 'member');
  const pushed = { terminalAutoApproveRules: { 'make test': true }, editAutoApprovePatterns: { '**/*': true } };
  await member.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: pushed } },
  });
  await settle();
  // No rejection: the keys describe what this window's own sessions may run,
  // and saying so is not changing the host.
  expect(heardOnRoot(member.heard)).toEqual([
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
    description: expect.stringContaining('At least 1048576.'),
    default: 16777216,
  });
  expect(schema.properties.replayBytes).toEqual({
    type: 'number',
    title: 'Replay Bytes',
    description: expect.stringContaining('At least 1048576.'),
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
 * A key nobody declares, which is refused where a declared one is kept.
 *
 * A declared key this host does not act on is kept, because `values` is state
 * a client reads back and a setting that silently reverted is worse than one
 * that does nothing. A key with no property is not a setting at all: no client
 * can draw it, and echoing it would report something nobody can explain.
 *
 * Refused key by key rather than action by action, because a client newer than
 * this host sends its whole patch at connect and one unknown key must not lose
 * the other forty.
 */
it('refuses an undeclared key and applies the rest of the push', async () => {
  const { signedIn, rootOf, heardOnRoot } = served();
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { telemetryLevel: 'off', nonsense: 1 } } },
  });
  await settle();
  // The echo carries the declared key alone, so no connection - a member
  // included - hears a value the schema does not describe.
  expect(heardOnRoot(admin.heard)).toEqual([expect.objectContaining({ action: { type: 'root/configChanged', config: { telemetryLevel: 'off' } } })]);
  const held = (await rootOf(admin.client)).config as { values: Record<string, unknown> };
  expect(held.values.telemetryLevel).toBe('off');
  expect(held.values.nonsense).toBeUndefined();
});

it('rejects a push whose every key is undeclared, naming them', async () => {
  const { signedIn, heardOnRoot, writes } = served();
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { nonsense: 1, moreNonsense: 2 } } },
  });
  await settle();
  // Both keys named, in the order the client sent them, and no echo: a refusal
  // is one connection's answer and no state moved for anybody.
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ rejectionReason: 'root config does not declare nonsense, moreNonsense' }),
  ]);
  expect(writes).toEqual([]);
});

/*
 * The three keys VS Code 1.140 dropped, which a client older than that still
 * pushes: the compact artifact wording and the two title-generation switches.
 * None is declared, so each is refused by task 02's rule and the rest of the
 * push goes through.
 */
it('refuses the keys VS Code dropped, key by key', async () => {
  // No daemon port, so `values` is this host's half alone.
  const { signedIn, rootOf, heardOnRoot } = served(false);
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { artifactToolsCompactPrompts: true, telemetryLevel: 'off' } } },
  });
  await settle();
  // The declared key is kept and the removed one never reaches the echo.
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: { telemetryLevel: 'off' } } }),
  ]);
  const held = (await rootOf(admin.client)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(held.values).toEqual({ telemetryLevel: 'off' });
  // Neither key has a property, so no client draws a control for one.
  expect(held.schema.properties).not.toHaveProperty('artifactToolsCompactPrompts');
  expect(held.schema.properties).not.toHaveProperty('deferredTitleGeneration');
  expect(held.schema.properties).not.toHaveProperty('activeAgentTitleGeneration');

  // Pushed alone, each is a refusal that names the key.
  for (const key of ['deferredTitleGeneration', 'activeAgentTitleGeneration']) {
    await admin.client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { [key]: true } } },
    });
    await settle();
    expect(heardOnRoot(admin.heard).at(-1)).toEqual(
      expect.objectContaining({ rejectionReason: `root config does not declare ${key}` }),
    );
  }
});

it('keeps only declared keys when a push replaces the lot', async () => {
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
  // The connection's own shell is cleared by the replace, and `nonsense` never
  // reaches the map they are read from.
  const held = (await rootOf(admin.client)).config as { values: Record<string, unknown> };
  expect(held.values).toEqual({ telemetryLevel: 'off' });
});

it('asks the daemon for its key alone when an undeclared key is beside it', async () => {
  const { signedIn, heardOnRoot, writes } = served();
  const admin = await signedIn('admin', 'admin');
  await admin.client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { daemonPort: 9000, nonsense: 1 } } },
  });
  await settle();
  // The port declares `daemonPort`, so it is the one asked; `nonsense` is not
  // a key this host could write into `config.json` even if the port would take
  // it.
  expect(writes).toEqual([{ daemonPort: 9000 }]);
  expect(heardOnRoot(admin.heard)).toEqual([
    expect.objectContaining({ action: { type: 'root/configChanged', config: { daemonPort: 9000 } } }),
  ]);
});

/** The root config's values, as one snapshot of the root holds them. */
const valuesOf = (state: Record<string, unknown>): Record<string, unknown> =>
  (state.config as { values: Record<string, unknown> }).values;

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

  const echoed = heardOnRoot(admin.heard).filter((heard) => heard.action.replace === true);
  expect(echoed.map((heard) => [heard.rejectionReason, (heard.action.config as Record<string, unknown>)['ahpd.restartNeeded']]))
    .toEqual([[undefined, true]]);
  expect(valuesOf(await rootOf(admin.client))['ahpd.restartNeeded']).toBe(true);
});

it('keeps the restart mark when a client writes the root config whole with the mark changed', async () => {
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

  // The write is taken and its echo says the host's value, so the client puts
  // its own copy back to what the host holds.
  const echoed = heardOnRoot(admin.heard).filter((heard) => heard.action.replace === true);
  expect(echoed.map((heard) => [heard.rejectionReason, (heard.action.config as Record<string, unknown>)['ahpd.restartNeeded']]))
    .toEqual([[undefined, true]]);
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
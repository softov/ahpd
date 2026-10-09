import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { uriOf } from '../src/fileuri.js';
import { trusted } from '../src/host/trust.js';
import { vscodeRootProperties } from '../src/vscoderootconfig.js';
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

/**
 * The keys of `ROOT_CONFIG_SCHEMA`, in the order the schema writes them.
 *
 * VS Code's keys are spread in first, then the host's own, then the daemon's,
 * and which of the three a key came from is what the cases below read.
 */
const PUSHED_BY_VSCODE = Object.keys(vscodeRootProperties);
const HOST_OWN = ['defaultShell', 'workspaceTrust'];
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
    agents: [echo({ path: DIR, pace: 0 })],
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
  return { signedIn, asRoot, rootOf, heardOnRoot, writes, refuseWith: (why: string) => { refuseWith = why; }, answerRestart: (yes: boolean) => { restartNeeded = yes; } };
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
   * `workspaceTrust` is one of the 43 and is declared by host/66 p1 instead,
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
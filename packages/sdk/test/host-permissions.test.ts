/*
 * The questions a backend puts to a person about a tool call, as this host
 * puts them: VS Code's options where the backend offered none, Allow Once and
 * Skip for a tool the operator's rule makes ask, and the session's
 * `permissions`, where an "Allow in this Session" answer is kept and which
 * answer a later question themselves, as VS Code's `SessionPermissionManager`
 * owns them for every agent of its host.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L67-L76
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1684-L1766
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { ROOT } from '../src/host/channels.js';
import { fileResources } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';
import type { Users } from '../src/types/users.js';

const SESSION = 'ahp-session:/one';
/** The session's chat, which the host mints: read off the session's state by `serving`. */
let CHAT = '';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-permissions-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** An envelope as a client reads it. */
interface Heard {
  channel: string;
  action: Bag;
  origin?: { clientId: string; clientSeq: number };
}

/** A client keeping every action envelope it was sent. */
const listening = (): Peer & { heard: Heard[] } => {
  const heard: Heard[] = [];
  return {
    heard,
    send: () => {},
    notify: (method, params) => { if (method === 'action') heard.push(params as Heard); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

const until = async (ready: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 2000; i++) {
    if (ready()) return;
    await settle(1);
  }
  throw new Error(`${what} never happened`);
};

/** One answer a backend was handed: the call, whether it was approved, and the option. */
type Answer = [string, boolean, string | undefined];

/**
 * The echo backend, asking a person about one call of `tool` in every turn it
 * is sent, and keeping every answer it is handed.
 */
const asking = (answers: Answer[], tool = 'bash', server?: { id: string; name: string }, asked: Bag = {}, starts: Start[] = []): Agent => {
  const base = echo({ path: dir, pace: 50 });
  return {
    ...base,
    create: (start: Start): Session => {
      starts.push(start);
      const session = base.create(start) as Session;
      return {
        ...session,
        // An MCP server the backend loaded, which a call's contributor names by its id.
        ...(server === undefined ? {} : {
          sessionState: () => ({
            ...session.sessionState(),
            customizations: [{ type: 'mcpServer', id: server.id, uri: 'file:///servers.json', name: server.name, state: { status: 'ready' } }],
          }),
        }),
        sendMessage: (...args: Parameters<Session['sendMessage']>) => {
          session.sendMessage(...args);
          const turnId = args[0];
          const toolCallId = `call-${turnId}`;
          start.emit('chat', {
            type: 'chat/toolCallStart', turnId, toolCallId, toolName: tool, displayName: 'Bash',
            ...(server === undefined ? {} : { contributor: { kind: 'mcp', customizationId: server.id } }),
          });
          // The question, with whatever the backend says for the host's decision beside it.
          start.emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: 'Run ls', toolInput: 'ls', confirmationTitle: 'Run Bash?', ...asked });
        },
        confirm: (toolCallId: string, approved: boolean, optionId?: string) => {
          answers.push([toolCallId, approved, optionId]);
          return true;
        },
      };
    },
  };
};

/** A host serving `agent`, with one client watching the root, the session and its chat. */
const serving = async (agent: Agent, over: Partial<HostOptions> = {}) => {
  const host = createHost({ path: dir, agents: [agent], resources: fileResources(), ...over });
  const p = listening();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
  CHAT = ((await client.handle({ method: 'subscribe', params: { channel: SESSION } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: CHAT } });
  const dispatch = async (channel: string, action: Bag): Promise<void> => {
    await client.handle({ method: 'dispatchAction', params: { channel, action } });
    await settle();
  };
  /** A turn begun, and the question its backend puts in it. */
  const turn = async (turnId: string): Promise<Bag> => {
    await dispatch(CHAT, { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } });
    await until(() => p.heard.some((one) => one.action.type === 'chat/toolCallReady' && one.action.turnId === turnId), 'the question');
    await settle();
    return p.heard.find((one) => one.action.type === 'chat/toolCallReady' && one.action.turnId === turnId)!.action;
  };
  return { host, p, dispatch, turn };
};

/** VS Code's options, in its words. */
const STANDARD = [
  { id: 'allow-session', label: 'Allow in this Session', kind: 'approve', group: 1 },
  { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
  { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
];

/** VS Code's options for a question nothing may keep an answer to. */
const ONCE = [
  { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
  { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
];

it('offers VS Code\'s options, in its words, on a question its backend put with none', async () => {
  const answers: Answer[] = [];
  const { host, turn } = await serving(asking(answers));
  expect((await turn('t1')).options).toEqual(STANDARD);
  expect(answers).toEqual([]);
  await host.close();
});

/*
 * The operator's rule is the daemon's `eligibleForAutoApproval`, as VS Code's
 * host takes the setting from its policy value alone.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L22-L42
 */
it('offers Allow Once and Skip alone where the operator\'s rule makes the tool ask, whatever the session allows', async () => {
  const answers: Answer[] = [];
  const { host, dispatch, turn } = await serving(asking(answers), { eligibleForAutoApproval: { bash: false } });
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: ['bash'], deny: [] } } });
  const ready = await turn('t1');
  expect(ready.options).toEqual(ONCE);
  expect(ready.confirmed).toBeUndefined();
  expect(answers).toEqual([]);
  await host.close();
});

/*
 * The rule is the daemon's setting alone: VS Code's host takes the setting's
 * policy value and declares no root config key for it, so a client's push of
 * one is kept as any key nobody declares is and asks about nothing.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L22-L26
 */
it('reads the operator\'s rule from the daemon\'s setting alone, a client\'s root push of one asking about nothing', async () => {
  const { host, dispatch, turn } = await serving(asking([]));
  await dispatch(ROOT, { type: 'root/configChanged', config: { eligibleForAutoApproval: { bash: false } } });
  expect((await turn('t1')).options).toEqual(STANDARD);
  await host.close();
});

/*
 * An MCP server's tool is `<server>/<tool>` to the rule, its server the one the
 * call's contributor names among the session's customizations, as AHP names an
 * MCP tool's server on the call.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1338-L1344
 */
it('reads an MCP tool\'s server from the customization its call\'s contributor names', async () => {
  const tracker = { id: 'mcp:tracker', name: 'my.tracker' };
  const named = await serving(asking([], 'mcp__tracker__create', tracker), { eligibleForAutoApproval: { 'my.tracker/create': false } });
  expect((await named.turn('t1')).options).toEqual(ONCE);
  await named.host.close();
  const other = await serving(asking([], 'mcp__tracker__create', tracker), { eligibleForAutoApproval: { 'other.tracker/create': false } });
  expect((await other.turn('t1')).options).toEqual(STANDARD);
  await other.host.close();
});

/* A call no MCP server contributes is named by its full tool name alone. */
it('names an MCP tool a call carries no contributor for by its full tool name alone', async () => {
  const servers = await serving(asking([], 'mcp__my_tracker__create'), { eligibleForAutoApproval: { 'my.tracker/create': false, 'my_tracker/create': false } });
  expect((await servers.turn('t1')).options).toEqual(STANDARD);
  await servers.host.close();
  const full = await serving(asking([], 'mcp__my_tracker__create'), { eligibleForAutoApproval: { 'mcp__my_tracker__create': false } });
  expect((await full.turn('t1')).options).toEqual(ONCE);
  await full.host.close();
});

/*
 * A server a client's plugin contributes is a customization of the list the
 * host lays over the session, which no backend is handed, so the host stamps
 * its customization on the start of a call of it the backend named no
 * contributor for, as VS Code's Claude session stamps a call from the list it
 * holds.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L420-L441
 */
it('stamps the customization of an MCP server the session lists on the start of a call of it no contributor names', async () => {
  const base = echo({ path: dir, pace: 50 });
  const agent: Agent = {
    ...base,
    create: (start: Start): Session => {
      const session = base.create(start) as Session;
      return {
        ...session,
        sessionState: () => ({
          ...session.sessionState(),
          customizations: [{
            type: 'plugin', id: 'plugin:tools', uri: 'file:///plugin', name: 'tools',
            children: [{ type: 'mcpServer', id: 'mcp:tracker', uri: 'file:///plugin/.mcp.json', name: 'tracker', state: { status: 'ready' } }],
          }],
        }),
        sendMessage: (...args: Parameters<Session['sendMessage']>) => {
          session.sendMessage(...args);
          const turnId = args[0];
          start.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: `call-${turnId}`, toolName: 'mcp__tracker__create', displayName: 'Create' });
          start.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: `other-${turnId}`, toolName: 'mcp__other__create', displayName: 'Create' });
        },
      };
    },
  };
  const { host, p, dispatch } = await serving(agent);
  await dispatch(CHAT, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } });
  const started = (id: string): Bag | undefined => p.heard.find((one) => one.action.type === 'chat/toolCallStart' && one.action.toolCallId === id)?.action;
  await until(() => started('other-t1') !== undefined, 'the starts');
  expect(started('call-t1')?.contributor).toEqual({ kind: 'mcp', customizationId: 'mcp:tracker' });
  expect(started('other-t1')).not.toHaveProperty('contributor');
  await host.close();
});

/*
 * A call no client and no MCP server of the session contributes is a
 * server-side tool's, as AHP has a call say whose tool it runs, and one of the
 * tools this host offered is `host/<name>` to the rule, read from the call's
 * tool name as an MCP client names a server's tool: a backend that reaches the
 * host's tools through a server of its own is asked as one that calls them by
 * name.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1321-L1346
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeServerToolMcpServer.ts#L21
 */
it('reads a host tool on a call no client and no MCP server contributes, whatever server its backend names it on', async () => {
  const notify: HostTool = { definition: { name: 'notify', inputSchema: { type: 'object', properties: {} } }, run: () => 'sent' };
  const named = { eligibleForAutoApproval: { 'host/notify': false }, tools: [notify] };
  const prefixed = await serving(asking([], 'mcp__host__notify'), named);
  expect((await prefixed.turn('t1')).options).toEqual(ONCE);
  await prefixed.host.close();
  const bare = await serving(asking([], 'notify'), named);
  expect((await bare.turn('t1')).options).toEqual(ONCE);
  await bare.host.close();
  const other = await serving(asking([], 'mcp__host__notify'), { eligibleForAutoApproval: { 'host/ping': false }, tools: [notify] });
  expect((await other.turn('t1')).options).toEqual(STANDARD);
  await other.host.close();
});

it('keeps an Allow in this Session answer in the session\'s permissions, and answers the next question about the tool itself', async () => {
  const answers: Answer[] = [];
  const { host, p, dispatch, turn } = await serving(asking(answers));
  await turn('t1');
  p.heard.length = 0;
  await dispatch(CHAT, { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-t1', approved: true, confirmed: 'user-action', selectedOptionId: 'allow-session' });
  expect(answers).toEqual([['call-t1', true, 'allow-session']]);
  const kept = p.heard.filter((one) => one.channel === SESSION && one.action.type === 'session/configChanged');
  expect(kept.map((one) => [one.action.config, one.origin])).toEqual([[{ permissions: { allow: ['bash'], deny: [] } }, undefined]]);
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'), 'the first turn');

  const ready = await turn('t2');
  expect(ready).toEqual({ type: 'chat/toolCallReady', turnId: 't2', toolCallId: 'call-t2', invocationMessage: 'Run ls', toolInput: 'ls', confirmed: 'not-needed' });
  expect(answers).toEqual([['call-t1', true, 'allow-session'], ['call-t2', true, undefined]]);
  await host.close();
});

/*
 * A call the permissions deny is refused before its question reaches any
 * client: no question and no confirmation is said, and the backend is handed
 * the refusal, as VS Code's host answers its agent.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1696-L1733
 */
it('refuses a call the session\'s permissions deny before any client is asked, and hands its backend the refusal', async () => {
  const answers: Answer[] = [];
  const { host, p, dispatch } = await serving(asking(answers));
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: ['bash'], deny: ['bash'] } } });
  await dispatch(CHAT, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } });
  await until(() => answers.length > 0, 'the refusal');
  await settle();
  expect(answers).toEqual([['call-t1', false, undefined]]);
  expect(p.heard.filter((one) => one.channel === CHAT
    && (one.action.type === 'chat/toolCallReady' || one.action.type === 'chat/toolCallConfirmed'))).toEqual([]);
  await host.close();
});

/** A turn begun with no question waited for, for the calls the host answers or refuses before any client is asked. */
const begin = async (dispatch: (channel: string, action: Bag) => Promise<void>, turnId: string): Promise<void> => {
  await dispatch(CHAT, { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } });
};

/*
 * What a backend's question says for the host's decision is the host's alone,
 * as VS Code's agents raise a pending confirmation beside the action.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1499-L1541
 */
it('takes a question\'s host-only fields off before any client is sent it', async () => {
  const answers: Answer[] = [];
  const { host, turn } = await serving(asking(answers, 'bash', undefined, {
    permissionKind: 'shell', shellCommand: 'ls -la', shellLanguage: 'bash', requestSandboxBypass: false, managedApprovalRequired: false,
  }));
  const ready = await turn('t1');
  for (const key of ['permissionKind', 'permissionPath', 'permissionUrl', 'shellCommand', 'shellLanguage', 'requestSandboxBypass', 'managedApprovalRequired']) {
    expect(ready).not.toHaveProperty(key);
  }
  await host.close();
});

/*
 * A `Shell` rule with a specifier names the commands of a line, and one that
 * denies refuses the call before anybody is asked, as VS Code's host reads
 * its permission rules.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L397-L425
 */
/** A people directory of two admins, each signed in by the token that names them. */
const people = (): Users => ({
  resource: { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: ['ahpd://users'], required: false },
  verify: async (token) => (token === 'ana' || token === 'bo' ? { id: token, roles: ['admin'], can: () => true } : undefined),
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
  mint: async () => 'ana',
});

/*
 * The terminal rules answer a command whoever sent its turn, the session's
 * owner or anybody else, as VS Code's host reads its one value of each for
 * every question.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L380
 */
it('answers a command by the host\'s terminal rules in a turn somebody other than the session\'s owner sent', async () => {
  const answers: Answer[] = [];
  const host = createHost({
    path: dir, resources: fileResources(), users: people(),
    agents: [asking(answers, 'bash', undefined, { permissionKind: 'shell', shellCommand: 'ls', shellLanguage: 'bash' })],
  });
  const signedIn = async (token: string) => {
    const p = listening();
    const client = host.accept(p);
    await client.handle({ method: 'initialize', params: { clientId: token, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: 'ahpd://users', token } });
    return { p, client };
  };
  const ana = await signedIn('ana');
  const bo = await signedIn('bo');
  await ana.client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
  // The chat the host minted for Ana's session, read off its state.
  const chat = ((await bo.client.handle({ method: 'subscribe', params: { channel: SESSION } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await bo.client.handle({ method: 'subscribe', params: { channel: chat } });
  await bo.client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } } },
  });
  const ready = (): Bag | undefined => bo.p.heard.find((one) => one.action.type === 'chat/toolCallReady' && one.action.turnId === 't1')?.action;
  await until(() => ready() !== undefined, 'the question');
  expect(ready()?.confirmed).toBe('not-needed');
  await until(() => answers.length > 0, 'the approval');
  expect(answers).toEqual([['call-t1', true, undefined]]);
  await host.close();
});

it('refuses a command a session\'s Shell rule denies before any client is asked', async () => {
  const answers: Answer[] = [];
  const { host, p, dispatch } = await serving(asking(answers, 'bash', undefined, { permissionKind: 'shell', shellCommand: 'git status && rm -rf build', shellLanguage: 'bash' }));
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: [], deny: ['Shell(rm *)'] } } });
  await begin(dispatch, 't1');
  await until(() => answers.length > 0, 'the refusal');
  expect(answers).toEqual([['call-t1', false, undefined]]);
  expect(p.heard.some((one) => one.action.type === 'chat/toolCallReady')).toBe(false);
  await host.close();
});

/*
 * A read inside the session's working folder needs no approval, as VS Code's
 * host answers one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L345-L361
 */
it('answers a read inside the session\'s working folder itself', async () => {
  const answers: Answer[] = [];
  const { host, turn } = await serving(asking(answers, 'Read', undefined, { permissionKind: 'read', permissionPath: join(dir, 'notes.txt') }));
  const ready = await turn('t1');
  expect(ready.confirmed).toBe('not-needed');
  expect(ready).not.toHaveProperty('options');
  await until(() => answers.length > 0, 'the approval');
  expect(answers).toEqual([['call-t1', true, undefined]]);
  await host.close();
});

/*
 * A fetch's question offers its host, in the session and always, between
 * Allow Once and Skip, and an Always Allow is kept in the host's own
 * `permissions`, for this start and the next, and answers the next fetch
 * there, as VS Code's host offers and keeps one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L1024-L1036
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L636-L646
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1275-L1282
 */
it('offers a fetch\'s host in the session and always, and keeps an Always Allow in the host\'s permissions', async () => {
  const answers: Answer[] = [];
  let kept: Record<string, unknown> = {};
  const store = { read: () => kept, write: (values: Record<string, unknown>) => { kept = values; } };
  const { host, p, dispatch, turn } = await serving(asking(answers, 'WebFetch', undefined, { permissionKind: 'url', permissionUrl: 'https://example.com/docs' }), { rootConfigStore: store });
  const always = 'allow-always-rules:["WebFetch(example.com)"]';
  expect((await turn('t1')).options).toEqual([
    { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
    { id: 'allow-session-rules:["WebFetch(example.com)"]', label: 'Allow Fetching example.com in this Session', kind: 'approve', group: 1 },
    { id: always, label: 'Always Allow Fetching example.com', kind: 'approve', group: 1 },
    { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
  ]);
  await dispatch(CHAT, { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-t1', approved: true, confirmed: 'user-action', selectedOptionId: always });
  expect(p.heard.filter((one) => one.channel === ROOT && one.action.type === 'root/configChanged').map((one) => one.action.config))
    .toEqual([{ permissions: { allow: ['WebFetch(example.com)'], deny: [] } }]);
  expect(kept).toEqual({ permissions: { allow: ['WebFetch(example.com)'], deny: [] } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnComplete' && one.action.turnId === 't1'), 'the first turn');
  expect((await turn('t2')).confirmed).toBe('not-needed');
  await host.close();
});

/*
 * A `WebFetch` rule is read by VS Code's URL approval, which normalizes a URL
 * for trust before it matches: a GitHub path is read without its case.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L242-L251
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/url/common/trustedDomains.ts#L66-L78
 */
it('answers a fetch a WebFetch rule names as VS Code\'s URL approval reads it, a GitHub path whatever its case', async () => {
  const answers: Answer[] = [];
  const { host, dispatch, turn } = await serving(asking(answers, 'WebFetch', undefined, { permissionKind: 'url', permissionUrl: 'https://github.com/Microsoft/VSCode/issues/1' }));
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: ['WebFetch(github.com/microsoft/vscode)'], deny: [] } } });
  expect((await turn('t1')).confirmed).toBe('not-needed');
  await host.close();
});

/*
 * A `Read` rule's glob is matched by VS Code's glob, where a trailing `/**`
 * names the folder itself as well as everything under it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L254-L287
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/glob.ts#L51-L62
 */
it('answers a read of a folder a Read grant names with VS Code\'s glob, the folder itself included', async () => {
  const answers: Answer[] = [];
  const other = `${realpathSync(dir)}-other`;
  const { host, dispatch, turn } = await serving(asking(answers, 'Read', undefined, { permissionKind: 'read', permissionPath: other }));
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: [`Read(/${other}/**)`], deny: [] } } });
  expect((await turn('t1')).confirmed).toBe('not-needed');
  await host.close();
});

/*
 * A `Shell` rule written as a regular expression that matches the empty
 * string names no command, as VS Code's rules read one, unless it is `.*`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/permissionRules.ts#L141-L161
 */
it('names no command by a Shell regular expression that matches the empty string', async () => {
  const answers: Answer[] = [];
  const { host, dispatch, turn } = await serving(asking(answers, 'bash', undefined, { permissionKind: 'shell', shellCommand: 'frobnicate --all', shellLanguage: 'bash' }));
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: ['Shell(/x*/)'], deny: [] } } });
  expect((await turn('t1')).confirmed).toBeUndefined();
  expect(answers).toEqual([]);
  await host.close();
});

/*
 * The edit patterns are read as VS Code's host reads them: from an approved
 * start, each matching pattern setting the answer, so the last one decides.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L873-L886
 */
it('answers a write inside the folder that the last matching edit pattern allows', async () => {
  const answers: Answer[] = [];
  const { host, dispatch, turn } = await serving(asking(answers, 'Write', undefined, { permissionKind: 'write', permissionPath: join(dir, 'secret', 'ok.txt') }));
  await dispatch(ROOT, { type: 'root/configChanged', config: { editAutoApprovePatterns: { '**/*': true, '**/secret/**': false, '**/secret/ok.txt': true } } });
  expect((await turn('t1')).confirmed).toBe('not-needed');
  await host.close();
});

/*
 * A question that asks to leave the sandbox is put to a person whatever Allow
 * All says, with Allow and Skip, and marked so its answer keeps nothing, as
 * VS Code's host puts one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L268-L273
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L566-L597
 */
it('puts a question that asks to leave the sandbox to a person under Allow All, with Allow and Skip, and keeps nothing from it', async () => {
  const answers: Answer[] = [];
  const { host, p, dispatch, turn } = await serving(asking(answers, 'bash', undefined, { permissionKind: 'shell', shellCommand: 'ls', shellLanguage: 'bash', requestSandboxBypass: true }));
  await dispatch(ROOT, { type: 'root/configChanged', config: { globalAutoApproveEnabled: true } });
  const ready = await turn('t1');
  expect(ready.options).toEqual([{ id: 'allow-once', label: 'Allow', kind: 'approve' }, { id: 'skip', label: 'Skip', kind: 'deny', group: 2 }]);
  expect((ready._meta as Bag | undefined)?.['agentHost.sandboxBypass']).toBe(true);
  p.heard.length = 0;
  await dispatch(CHAT, { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-t1', approved: true, confirmed: 'user-action', selectedOptionId: 'allow-once' });
  expect(p.heard.some((one) => one.action.type === 'session/configChanged' || one.action.type === 'root/configChanged')).toBe(false);
  await host.close();
});

/*
 * Global Allow All answers a question itself, as VS Code's host answers one,
 * and the managed lock takes it away.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L275-L285
 */
it('answers a question under global Allow All, and asks it under the managed lock', async () => {
  const free: Answer[] = [];
  const open = await serving(asking(free));
  await open.dispatch(ROOT, { type: 'root/configChanged', config: { globalAutoApproveEnabled: true } });
  expect((await open.turn('t1')).confirmed).toBe('not-needed');
  await open.host.close();

  const locked: Answer[] = [];
  const closed = await serving(asking(locked), { managedSettingsPermissions: { disableBypassPermissionsMode: 'disable' } });
  await closed.dispatch(ROOT, { type: 'root/configChanged', config: { globalAutoApproveEnabled: true } });
  expect((await closed.turn('t1')).options).toEqual(STANDARD);
  await closed.host.close();
});

/*
 * A question a managed rule asks about, which its backend marks, is put with
 * Allow Once and Skip and answered by nobody but a person, Allow All and the
 * session's grants included, as VS Code's host puts one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1696-L1702
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L566-L597
 */
it('puts a question a managed rule asks about with Allow Once and Skip, whatever Allow All and the session allow', async () => {
  const answers: Answer[] = [];
  const { host, dispatch, turn } = await serving(asking(answers, 'Read', undefined, {
    permissionKind: 'read', permissionPath: join(dir, 'notes.txt'), managedApprovalRequired: true,
  }));
  await dispatch(ROOT, { type: 'root/configChanged', config: { globalAutoApproveEnabled: true } });
  await dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: ['Read'], deny: [] } } });
  expect((await turn('t1')).options).toEqual(ONCE);
  expect(answers).toEqual([]);
  await host.close();
});

/*
 * The operator's managed rules are checked on every question beside the
 * session's permissions, this host's own check: a deny refuses the call before
 * its question is said, and an ask puts it with Allow Once and Skip whatever
 * the session allows.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostPolicySupport.ts#L46-L56
 */
it('refuses a call a managed deny rule names, and asks one a managed ask rule names with Allow Once and Skip', async () => {
  const refused: Answer[] = [];
  const denied = await serving(asking(refused, 'bash', undefined, { permissionKind: 'shell', shellCommand: 'git status && curl https://example.com', shellLanguage: 'bash' }),
    { managedSettingsPermissions: { deny: ['Shell(curl)'] } });
  await begin(denied.dispatch, 't1');
  await until(() => refused.length > 0, 'the refusal');
  expect(refused).toEqual([['call-t1', false, undefined]]);
  expect(denied.p.heard.some((one) => one.action.type === 'chat/toolCallReady')).toBe(false);
  await denied.host.close();

  const answers: Answer[] = [];
  const asked = await serving(asking(answers, 'Write', undefined, { permissionKind: 'write', permissionPath: join(dir, 'notes.txt') }),
    { managedSettingsPermissions: { ask: ['Write(**/*.txt)'] } });
  await asked.dispatch(SESSION, { type: 'session/configChanged', config: { permissions: { allow: ['Edit'], deny: [] } } });
  expect((await asked.turn('t1')).options).toEqual(ONCE);
  await asked.host.close();
});

/*
 * A managed `Domain` rule is checked on a URL request, and a fetch outside the
 * `Domain` rules of `limitTo` is refused as a deny is, as the managed rules
 * apply per permission kind. A rule names a URL by its host alone, as VS
 * Code's network filter matches a domain, so whatever its scheme or port.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L141-L146
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/networkFilter/common/domainMatcher.ts#L208-L241
 */
it('refuses a fetch a managed Domain rule denies, and one outside the managed boundary', async () => {
  for (const managed of [{ deny: ['Domain(*.example.com)'] }, { limitTo: ['Domain(github.com)'] }]) {
    const refused: Answer[] = [];
    const { host, p, dispatch } = await serving(asking(refused, 'WebFetch', undefined, { permissionKind: 'url', permissionUrl: 'http://docs.example.com/page' }),
      { managedSettingsPermissions: managed });
    await begin(dispatch, 't1');
    await until(() => refused.length > 0, 'the refusal');
    expect(refused).toEqual([['call-t1', false, undefined]]);
    expect(p.heard.some((one) => one.action.type === 'chat/toolCallReady')).toBe(false);
    await host.close();
  }
});

it('names a fetch by its host alone under a managed Domain rule, whatever its port', async () => {
  const fetching = { permissionKind: 'url', permissionUrl: 'https://example.com:8443/releases' };
  const refused: Answer[] = [];
  const denied = await serving(asking(refused, 'WebFetch', undefined, fetching), { managedSettingsPermissions: { deny: ['Domain(example.com)'] } });
  await begin(denied.dispatch, 't1');
  await until(() => refused.length > 0, 'the refusal');
  expect(refused).toEqual([['call-t1', false, undefined]]);
  await denied.host.close();

  const answers: Answer[] = [];
  const bounded = await serving(asking(answers, 'WebFetch', undefined, fetching), { managedSettingsPermissions: { limitTo: ['Domain(example.com)'] } });
  expect((await bounded.turn('t1')).options).toBeDefined();
  expect(answers).toEqual([]);
  await bounded.host.close();
});

/*
 * A `Domain` argument the managed grammar reads as no URL with a host, such
 * as a bare `*`, cannot be expressed, so the rule names nothing; the family
 * alone is how every domain is said.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedRules.ts#L179-L203
 */
it('reads a managed Domain rule the managed grammar cannot express as naming nothing', async () => {
  const answers: Answer[] = [];
  const { host, turn } = await serving(asking(answers, 'WebFetch', undefined, { permissionKind: 'url', permissionUrl: 'https://example.com/releases' }),
    { managedSettingsPermissions: { deny: ['Domain(*)'] } });
  expect((await turn('t1')).options).toBeDefined();
  expect(answers).toEqual([]);
  await host.close();
});

/*
 * Every backend is handed the managed settings on its start, as VS Code hands
 * its runtime `managedSettings: { permissions }`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L1107
 */
it('hands a backend the managed settings on its start', async () => {
  const answers: Answer[] = [];
  const starts: Start[] = [];
  const managed = { deny: ['Shell(curl *)'], disableBypassPermissionsMode: 'disable' as const };
  const { host, turn } = await serving(asking(answers, 'bash', undefined, {}, starts), { managedSettingsPermissions: managed });
  await turn('t1');
  expect(starts[0]?.managedSettings).toEqual({ permissions: managed });
  await host.close();
});

it('hands a backend the operator\'s eligibility beside the managed rules on its start', async () => {
  const starts: Start[] = [];
  const eligible = { bash: false, 'tracker/*': false };
  const { host, turn } = await serving(asking([], 'bash', undefined, {}, starts), { eligibleForAutoApproval: eligible });
  await turn('t1');
  expect(starts[0]?.managedSettings).toEqual({ eligibleForAutoApproval: eligible });
  await host.close();
});

/*
 * Under `managedRules: handed` the host checks no managed rule and marks
 * nothing, hands the rules to its backends, and puts a question a backend
 * marked managed with Allow Once and Skip, as VS Code's host keeps the merged
 * permissions for its runtimes and checks none; the Allow All lock holds.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostManagedSettingsService.ts
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L43-L47
 */
it('checks no managed rule under managedRules handed, hands them on, and honours a backend\'s own mark and the lock', async () => {
  const managed = { deny: ['Shell(curl)'], ask: ['Write(**/*.txt)'], disableBypassPermissionsMode: 'disable' as const };
  const handed = { managedRules: 'handed' as const, managedSettingsPermissions: managed, eligibleForAutoApproval: { bash: false } };

  // A command a managed deny rule names, of a tool the eligibility sets false: put, with a command's own grants.
  const starts: Start[] = [];
  const shell = await serving(asking([], 'bash', undefined, { permissionKind: 'shell', shellCommand: 'curl https://example.com', shellLanguage: 'bash' }, starts), handed);
  expect(((await shell.turn('t1')).options as { id: string }[]).map((one) => one.id)).toEqual([
    'allow-once', 'allow-session-rules:["Shell(curl https://example.com)"]', 'allow-always-rules:["Shell(curl https://example.com)"]', 'skip',
  ]);
  expect(starts[0]?.managedSettings).toEqual({ permissions: managed, eligibleForAutoApproval: { bash: false } });
  await shell.host.close();

  // A write a managed ask rule names, in the session's folder: answered by the session's own edit rules.
  const write = await serving(asking([], 'Write', undefined, { permissionKind: 'write', permissionPath: join(dir, 'notes.txt') }), handed);
  expect((await write.turn('t1')).confirmed).toBe('not-needed');
  await write.host.close();

  // The backend's own mark: Allow Once and Skip, whatever Allow All says, which the lock takes away besides.
  const answers: Answer[] = [];
  const marked = await serving(asking(answers, 'Read', undefined, { permissionKind: 'read', permissionPath: join(dir, 'notes.txt'), managedApprovalRequired: true }), handed);
  await marked.dispatch(ROOT, { type: 'root/configChanged', config: { globalAutoApproveEnabled: true } });
  expect((await marked.turn('t1')).options).toEqual(ONCE);
  expect(answers).toEqual([]);
  await marked.host.close();
});

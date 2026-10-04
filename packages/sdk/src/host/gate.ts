import { computerSource } from '../computers.js';
import type { Connection } from '../types/host.js';
import type { Grant } from '../types/users.js';
import { ROOT, AUTOMATIONS, isRootChannel } from './channels.js';
import type { ChannelKind } from './channels.js';

export const GREETINGS = new Set(['initialize', 'reconnect', 'ping']);

/**
 * What each command needs, by subject and verb.
 *
 * One entry per gated method, grouped the way a role reads: the file's verbs,
 * then a session's, then a shell's, then the automation clock and the
 * diagnostics a window asks for. The verb is what tells listing from acting,
 * which the six-area vocabulary could not - decision
 * `a-grant-is-a-subject-and-a-verb`.
 *
 * `subscribe` is not here because its subject is the channel rather than the
 * method, and `capabilityFor` is what reads it. A method with no entry anywhere
 * is served to anybody who is connected.
 */
export const NEEDS: Record<string, Grant> = {
  // file:read
  resourceList: 'file:read',
  resourceRead: 'file:read',
  resourceResolve: 'file:read',
  createResourceWatch: 'file:read',
  completions: 'file:read',

  // container:write
  //
  // Starting a container and running a host in it is this host's Docker access
  // by proxy, so it is a grant of its own rather than the machine scheme's
  // verb: the params name a workspace folder, not a `computer://` URI -
  // decision `connecting-to-a-dev-container-needs-a-grant`.
  'vscode/devContainers/connect': 'container:write',
  'vscode/devContainers/disconnect': 'container:write',
  'vscode/devContainers/relaySend': 'container:write',

  // session:read
  //
  // The reference client's own methods, which were served and classified
  // nowhere until the staleness test learned to see a quoted name. They act on
  // a session's worktree, artifacts and state file, so they answer to the
  // session's own pair - and a role that may not write a session may not make
  // it a tree.
  'vscode/getAgentHostSessionStateFile': 'session:read',

  // session:write
  'vscode/createAgentHostDetachedWorktree': 'session:write',
  'vscode/claimAgentHostDetachedWorktree': 'session:write',
  'vscode/setAgentHostDetachedWorktreeArchived': 'session:write',
  'vscode/deleteAgentHostDetachedWorktree': 'session:write',
  'vscode/reconcileAgentHostDetachedWorktrees': 'session:write',
  'vscode/removeSessionArtifact': 'session:write',

  // diagnostics:read
  'vscode/collectAgentHostDebugLogs': 'diagnostics:read',
  'vscode/readAgentHostDebugLogsChunk': 'diagnostics:read',
  getNetworkDiagnosticsInfo: 'diagnostics:read',

  // file:write
  resourceWrite: 'file:write',
  resourceDelete: 'file:write',
  resourceMkdir: 'file:write',
  resourceMove: 'file:write',
  resourceCopy: 'file:write',
  resourceRequest: 'file:write',
  invokeChangesetOperation: 'file:write',

  // session:read
  listSessions: 'session:read',
  fetchTurns: 'session:read',
  resolveSessionConfig: 'session:read',
  sessionConfigCompletions: 'session:read',

  // session:write
  createSession: 'session:write',
  createChat: 'session:write',
  disposeChat: 'session:write',
  disposeSession: 'session:write',

  // terminal:write, because opening one is the act; reading one is the channel
  createTerminal: 'terminal:write',
  disposeTerminal: 'terminal:write',

  // automation:read
  listAutomationTriggerDefinitions: 'automation:read',
  fetchAutomationRuns: 'automation:read',

  // automation:write
  runAutomation: 'automation:write',

  // diagnostics:read
  diagnosticsFetch: 'diagnostics:read',
};

/**
 * The methods no capability covers, and why each.
 *
 * `initialize`, `reconnect` and `ping` are the handshake: a client that cannot
 * reach them cannot be told where to sign in, so gating them is a door with the
 * key on the inside. `authenticate` is how a person signs in, and gating it
 * would be a loop with no way out. `subscribe` is classified by its channel in
 * `capabilityFor` rather than by name, and is listed here only so the staleness
 * test sees it accounted for.
 */
export const UNGATED = new Set([
  'initialize', 'reconnect', 'ping', 'authenticate', 'subscribe',
  // A boolean about whether this machine has Docker and the CLI, which the
  // reference client asks before it can ask for anything else -
  // `connecting-to-a-dev-container-needs-a-grant`. It does start something:
  // the launcher runs `docker --version` to answer it. A port is expected to
  // hold that answer rather than spawn per call, because this is reachable by
  // a connection that has not signed in, and the one this repository ships
  // does.
  'vscode/devContainers/isDockerAvailable',
  /*
   * Notifications, which cannot be refused *here*: the notification path
   * returns before this boundary, because a frame with no id has nowhere to
   * carry an error.
   *
   * `unsubscribe` costs nothing to allow. `dispatchAction` is gated all the
   * same, one layer in, at the top of `applyDispatch` and by the channel it
   * names - see `dispatchNeeds`. It has to be: `terminal/input` writes to a
   * shell, and root state hands every open terminal's URI to anybody who
   * completes a handshake, so an ungated dispatch is arbitrary command
   * execution by a connection that never signed in.
   */
  'dispatchAction', 'unsubscribe',
]);

/**
 * What dispatching into a channel needs.
 *
 * A dispatch is a notification, so what it gets on refusal is `rejectionReason`
 * on the channel rather than an error code. It is checked against the channel,
 * because that is what says which part of the host is being driven, and a
 * dispatch is always a *write*: typing into a terminal, saying something in a
 * chat, changing a root setting.
 *
 * `kind` is the host's answer to what the channel is - a session's (the
 * session, a chat, its annotations or a changeset), a terminal's, or
 * something else - which the scheme cannot say: a session is held as
 * `<provider>:/<id>` and VS Code names a terminal `agenthost-terminal:/<id>`.
 * The subscribe gate asks the same question of the same function,
 * `channelKind` in `createHost`.
 *
 * `ahp-root://` is the one channel read with the action as well.
 * `root/configChanged` that only sets `PER_CONNECTION` keys changes nothing
 * anybody else reads, so it needs a sign-in and no grant (`undefined`). Any
 * other key, and a `replace`, changes the host for everybody and needs
 * `config:write`.
 *
 * What is left - a `file:` URI, a resource watch, one another client relays,
 * or one of this host's own `ahp-` channels with no subject of its own - is
 * `file:read`, the grant `createResourceWatch` required to hand a watch over.
 */
export const dispatchNeeds = (channel: string, kind: ChannelKind, action?: Record<string, unknown>): Grant | undefined => {
  if (kind === 'session') return 'session:write';
  if (kind === 'terminal') return 'terminal:write';
  if (channel.startsWith('ahp-automation')) return 'automation:write';
  if (isRootChannel(channel)) {
    if (action?.type !== 'root/configChanged' || action.replace === true) return 'config:write';
    const config = typeof action.config === 'object' && action.config !== null ? action.config : {};
    return Object.keys(config).every((key) => PER_CONNECTION.has(key)) ? undefined : 'config:write';
  }
  return 'file:read';
};

/**
 * The grant a session's own change needs beyond the write, when the setting it
 * carries names a source.
 *
 * Picking `disposable:<profile>` or `devcontainer://<folder>` makes a machine
 * for the session as surely as `createSession` does, and is held to what
 * `createSession` is held to - decision
 * `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
 * A `computer://<id>` that already exists names no source, so a session moving
 * between machines that are already there is no write here.
 *
 * Beside `dispatchNeeds` rather than inside it, because that one is asked of a
 * channel as well as of an action, and only a session's own change carries a
 * `computer`.
 */
export const computerNeeds = (action: Record<string, unknown>): Grant | undefined => {
  if (action.type !== 'session/configChanged') return undefined;
  const config = (typeof action.config === 'object' && action.config !== null
    ? action.config
    : {}) as Record<string, unknown>;
  return computerSource(config.computer) === undefined ? undefined : 'computer:write';
};

/**
 * The root config keys that are a person's, not the host's.
 *
 * The record a client pushes to `ahp-root://` carries both kinds. Whether
 * artifact prompts are compact changes what every session is told, so it is one
 * setting for the host. `defaultShell` is the person's: the host's own note by
 * `rootConfig` says so, and names VS Code pushing it out of
 * `terminal.integrated.agentHostProfile.<os>` on connect.
 *
 * Kept in one shared record they are the same thing on a one-person daemon and
 * not on any other: whoever connected last decided everybody's shell. So these
 * live on the `Connection`, and a connection reads its own back.
 */
export const PER_CONNECTION = new Set(['defaultShell']);

/**
 * Whether this connection is somebody who may read the daemon's own settings.
 *
 * The keys `HostOptions.rootConfig` carries are `config:read`'s and not
 * `config:write`'s, because a write names a key and a read names a value - and
 * one of those values may be a credential - decision
 * `root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value`.
 * A host with no people directory has nobody to ask, so nobody sees them.
 */
export const seesConfig = (connection: Connection | undefined): boolean =>
  connection?.principal?.can('config:read') === true;

/** The kinds of channel a family of client action can belong on. */
export type Home = 'session' | 'terminal' | 'automations' | 'root' | 'watch';

/**
 * Each family of client action, by the part of its type before the slash:
 * the kind of channel it belongs on, and what dispatching one needs beside
 * what the channel does. An action on a channel of another kind is refused
 * before any handler reads it, since a handler acts on the action and not
 * on the channel. The root's grant is read off the channel with the action
 * (`dispatchNeeds`), and a watch's actions are its owner's to say.
 */
export const ACTION_HOMES: Record<string, { home: Home; needs?: Grant }> = {
  session: { home: 'session', needs: 'session:write' },
  chat: { home: 'session', needs: 'session:write' },
  annotations: { home: 'session', needs: 'session:write' },
  changeset: { home: 'session', needs: 'session:write' },
  terminal: { home: 'terminal', needs: 'terminal:write' },
  automation: { home: 'automations', needs: 'automation:write' },
  automationRun: { home: 'automations', needs: 'automation:write' },
  root: { home: 'root' },
  resourceWatch: { home: 'watch' },
};

/** A kind of channel, as a refusal names it. */
export const HOME_WORDS: Record<Home, string> = {
  session: 'a session', terminal: 'a terminal', automations: 'an automation channel', root: 'the root', watch: 'a resource watch',
};

/**
 * The method names this host serves, and what each needs, for the suite.
 *
 * Exported so a test can assert that every handler is classified: a handler
 * added to the literal and to neither set is a method nobody decided about, and
 * the test that names both sets fails on the next run rather than the method
 * being served to anybody.
 */
export const GATE = { NEEDS, UNGATED, dispatchNeeds };

/**
 * The sentence a person is refused with when a grant is missing.
 *
 * One wording, because the WebSocket and the HTTP API ask the same question:
 * whoever may not `config:write` is told the same thing whichever door they
 * knocked on. Exported rather than written twice, so the two surfaces cannot
 * drift apart as either one moves.
 */
export const refusalReason = (id: string, missing: Grant): string => `${id} may not ${missing} here`;

/**
 * The commands whose `channel` the protocol declares as one literal.
 *
 * Read off the params declarations, which spell it as a string literal type
 * rather than as `URI`: these are the host's own commands, and the channel
 * on them is a constant a client copies rather than a thing it chooses.
 *
 * `initialize` and `ping` are left out deliberately, though they declare one
 * too. They are how a client finds out it can talk at all, and refusing
 * either turns a wrong constant into a connection that never opens - which
 * is a worse thing to debug than the command that would have been refused.
 */
export const DECLARED: Record<string, string | undefined> = {
  authenticate: ROOT,
  createResourceWatch: ROOT,
  listSessions: ROOT,
  reconnect: ROOT,
  resolveSessionConfig: ROOT,
  resourceCopy: ROOT,
  resourceDelete: ROOT,
  resourceList: ROOT,
  resourceMkdir: ROOT,
  resourceMove: ROOT,
  resourceRead: ROOT,
  resourceRequest: ROOT,
  resourceResolve: ROOT,
  resourceWrite: ROOT,
  sessionConfigCompletions: ROOT,
  listAutomationTriggerDefinitions: ROOT,
  runAutomation: AUTOMATIONS,
  fetchAutomationRuns: AUTOMATIONS,
};

export const REVERSE = new Set([
  'resourceRead', 'resourceWrite', 'resourceList', 'resourceCopy', 'resourceDelete',
  'resourceMove', 'resourceResolve', 'resourceMkdir', 'resourceRequest', 'createResourceWatch',
]);
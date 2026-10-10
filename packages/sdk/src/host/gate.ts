import { computerSource } from '../computers.js';
import type { Connection } from '../types/host.js';
import type { Grant } from '../types/users.js';
import { ROOT, AUTOMATIONS, isRootChannel, spaceOf } from './channels.js';
import type { ChannelKind } from './channels.js';

export const GREETINGS = new Set(['initialize', 'reconnect', 'ping']);

/**
 * What each command needs, by subject and operation.
 *
 * One entry per gated method, and one operation rather than the half of a
 * subject it is a part of: the file's ten methods are ten operations, and
 * `session:rename` is what a title is - decision
 * `a-grant-names-an-operation-and-read-and-write-are-its-groups`. With the
 * built-in roles the answer is the same as it was under the verb, because a
 * built-in holds the whole group; what changes is that a role of one's own may
 * now hold one act instead of half a subject.
 *
 * `subscribe` is not here because its subject is the channel rather than the
 * method, and `capabilityFor` is what reads it through `channelRead`. A method
 * with no entry anywhere is one nobody classified, and `capabilityFor` refuses
 * it rather than reading the absent row as "needs nothing": the methods that
 * need nothing are `UNGATED`'s, said out loud, so that an entry nobody wrote
 * fails closed instead of being served to anybody who is connected.
 */
export const NEEDS: Record<string, Grant> = {
  // file, one operation per method, in the order the protocol declares them.
  resourceList: 'file:list',
  resourceRead: 'file:get',
  resourceResolve: 'file:resolve',
  createResourceWatch: 'file:watch',
  completions: 'file:list',
  resourceWrite: 'file:put',
  resourceDelete: 'file:delete',
  resourceMkdir: 'file:mkdir',
  resourceMove: 'file:move',
  resourceCopy: 'file:copy',
  resourceRequest: 'file:request',

  // session
  listSessions: 'session:list',
  resolveSessionConfig: 'session:state',
  sessionConfigCompletions: 'session:state',
  createSession: 'session:create',
  disposeSession: 'session:dispose',
  /*
   * The reference client's own methods, which were served and classified
   * nowhere until the staleness test learned to see a quoted name. They act on
   * a session's worktree, artifacts and state file, so they answer to the
   * session's own operations - and a role that may not write a session may not
   * make it a tree.
   */
  'vscode/getAgentHostSessionStateFile': 'session:state',
  'vscode/createAgentHostDetachedWorktree': 'session:worktree',
  'vscode/claimAgentHostDetachedWorktree': 'session:worktree',
  'vscode/setAgentHostDetachedWorktreeArchived': 'session:worktree',
  'vscode/deleteAgentHostDetachedWorktree': 'session:worktree',
  'vscode/reconcileAgentHostDetachedWorktrees': 'session:worktree',
  'vscode/removeSessionArtifact': 'session:artifacts',

  // chat
  createChat: 'chat:create',
  disposeChat: 'chat:dispose',
  /*
   * `chat:move` rather than the `session:write` the plan named, because
   * host/46 has landed and this is the operation it reserved for exactly this
   * method - task 02's table in that plan, row `moveChat`. A chat lives in a
   * session, so `session:write` still covers it: a role written before there
   * was a move to grant means what it meant.
   */
  moveChat: 'chat:move',
  fetchTurns: 'chat:turns',

  // terminal, because opening one is the act; reading one is the channel.
  createTerminal: 'terminal:create',
  disposeTerminal: 'terminal:dispose',

  // automation
  listAutomationTriggerDefinitions: 'automation:list',
  fetchAutomationRuns: 'automation:list',
  runAutomation: 'automation:run',

  // container
  //
  // Starting a container and running a host in it is this host's Docker access
  // by proxy, so it is a grant of its own rather than the machine scheme's
  // operations: the params name a workspace folder, not a `computer://` URI -
  // decision `connecting-to-a-dev-container-needs-a-grant`.
  'vscode/devContainers/connect': 'container:connect',
  'vscode/devContainers/disconnect': 'container:disconnect',
  'vscode/devContainers/relaySend': 'container:relay',
  /*
   * Stopping or removing a folder's dev container is the act, and the machine
   * it acts on is the one the folder is: `computer:write` is asked beside the
   * operation in `capabilityFor`, as it is for a session naming a source -
   * decision `stopping-a-dev-container-needs-the-computers-grant`.
   */
  'vscode/devContainers/stop': 'container:stop',
  'vscode/devContainers/remove': 'container:remove',

  // diagnostics
  'vscode/collectAgentHostDebugLogs': 'diagnostics:logs',
  'vscode/readAgentHostDebugLogsChunk': 'diagnostics:logs',
  getNetworkDiagnosticsInfo: 'diagnostics:network',
  // The window asks this beside `getNetworkDiagnosticsInfo`, for the same
  // troubleshooting pane, so it needs the same grant.
  getManagedSettingsDiagnostics: 'diagnostics:network',
  diagnosticsFetch: 'diagnostics:fetch',
  /*
   * Stopping the daemon, which the window's own host answers. It is the one
   * method that ends every session on this machine, so it is a host-wide
   * change and not the window's - decision `shutdown-needs-config-change`.
   */
  shutdown: 'config:change',

  /*
   * A changeset is a session's, so running an operation on it writes to the
   * session as well as to its files. `capabilityFor` asks for both, and this is
   * the session half.
   */
  invokeChangesetOperation: 'session:changes',
};

/**
 * What each client action needs, by the operation it performs.
 *
 * One row per action type the protocol lets a client originate, which is what
 * makes the set checkable: `IS_CLIENT_DISPATCHABLE` is exhaustive over the
 * protocol's actions, so an action nobody classified is an action a client may
 * send that this host has not decided about, and the staleness test fails
 * rather than the dispatch being served to anybody.
 *
 * An operation rather than the channel's kind, because the channel already
 * says where the action goes and the operation says what it does: typing in a
 * terminal is `terminal:input` and titling it is `terminal:rename`, and a role
 * may hold one without the other.
 */
export const ACTION_NEEDS: Record<string, Grant> = {
  // root
  'root/configChanged': 'config:change',

  // session
  'session/titleChanged': 'session:rename',
  'session/activeClientSet': 'session:attach',
  'session/activeClientRemoved': 'session:attach',
  'session/workingDirectorySet': 'session:folders',
  'session/workingDirectoryRemoved': 'session:folders',
  'session/workingDirectoryReplaced': 'session:folders',
  'session/customizationToggled': 'session:configure',
  'session/mcpServerStartRequested': 'session:configure',
  'session/mcpServerStopRequested': 'session:configure',
  'session/mcpServerBackgroundRequested': 'session:configure',
  'session/isReadChanged': 'session:mark',
  'session/isArchivedChanged': 'session:mark',
  'session/configChanged': 'session:configure',

  // chat
  'chat/turnStarted': 'chat:send',
  'chat/turnResume': 'chat:send',
  'chat/pendingMessageSet': 'chat:send',
  'chat/pendingMessageRemoved': 'chat:send',
  'chat/queuedMessagesReordered': 'chat:send',
  'chat/turnCancelled': 'chat:cancel',
  'chat/toolCallConfirmed': 'chat:answer',
  'chat/toolCallResultConfirmed': 'chat:answer',
  'chat/inputAnswerChanged': 'chat:answer',
  'chat/inputCompleted': 'chat:answer',
  'chat/toolCallComplete': 'chat:tool',
  'chat/toolCallContentChanged': 'chat:tool',
  'chat/draftChanged': 'chat:draft',
  'chat/workingDirectorySet': 'chat:folders',
  'chat/workingDirectoryRemoved': 'chat:folders',
  'chat/isReadChanged': 'chat:mark',
  'chat/isArchivedChanged': 'chat:mark',
  'chat/truncated': 'chat:truncate',

  // a changeset and a session's annotations are the session's own review.
  'changeset/filesReviewChanged': 'session:review',
  'annotations/set': 'session:review',
  'annotations/updated': 'session:review',
  'annotations/removed': 'session:review',
  'annotations/entrySet': 'session:review',
  'annotations/entryRemoved': 'session:review',

  // terminal
  'terminal/input': 'terminal:input',
  'terminal/resized': 'terminal:resize',
  'terminal/claimed': 'terminal:claim',
  'terminal/titleChanged': 'terminal:rename',
  'terminal/cleared': 'terminal:clear',

  // automation
  'automation/createRequested': 'automation:create',
  'automation/updateRequested': 'automation:update',
  'automation/removed': 'automation:remove',
  'automationRun/cancelRequested': 'automation:cancel',
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
 * What reading a channel of each kind needs.
 *
 * One operation, because a subscribe is one act: it takes a snapshot and keeps
 * taking it, which is what the read of that channel is - `session:state` for a
 * session, its annotations and its changesets, `chat:turns` for a chat,
 * `terminal:output` for a shell.
 *
 * The space the channel's own scheme puts it in decides, and `kind` is the
 * fallback for a channel no scheme speaks for - a session held as
 * `<provider>:/<id>`, a terminal VS Code names `agenthost-terminal:/<id>`.
 * `channelKind` in `createHost` is what answers that.
 *
 * What is left - a `file:` URI, a resource watch, one another client relays -
 * is `file:watch`, the operation `createResourceWatch` requires to hand a watch
 * over.
 */
export const channelRead = (channel: string, kind: ChannelKind): Grant => {
  if (channel.startsWith('ahp-automation')) return 'automation:list';
  const space = spaceOf(channel);
  if (space === 'chat') return 'chat:turns';
  if (space === 'terminal' || kind === 'terminal') return 'terminal:output';
  if (space === 'session' || kind === 'session') return 'session:state';
  return 'file:watch';
};

/**
 * What dispatching into a channel needs, beyond the action's own operation.
 *
 * Only two things are left, because `ACTION_NEEDS` answers every action type a
 * client may send and the action is a better answer than its channel: which
 * part of the host is being driven says nothing about what is being done to
 * it.
 *
 * `ahp-root://` is the one channel read with the action as well.
 * `root/configChanged` that only sets `PER_CONNECTION` keys changes nothing
 * anybody else reads, so it needs a sign-in and no grant (`undefined`) - except
 * `workspaceTrust`, which is one window's answer about the folders every
 * session of that window loads from, so pushing it needs `trust:push`, which
 * the `trust:write` group covers. Any other key, and a `replace`, changes the
 * host for everybody and needs `config:write`.
 *
 * The other is `file:watch` for a channel that is neither a session's nor a
 * terminal's - a `file:` URI, a resource watch, one another client relays. An
 * action on one of those is a client reporting a change to something it is
 * watching, which is the grant the watch itself was handed under. The
 * automations are the one `other` that has actions of its own, and those are
 * `ACTION_NEEDS`' to say.
 *
 * A dispatch is a notification, so what it gets on refusal is `rejectionReason`
 * on the channel rather than an error code.
 */
export const dispatchNeeds = (channel: string, kind: ChannelKind, action?: Record<string, unknown>): Grant | undefined => {
  if (isRootChannel(channel)) {
    if (action?.type !== 'root/configChanged' || action.replace === true) return 'config:change';
    const config = typeof action.config === 'object' && action.config !== null ? action.config : {};
    const keys = Object.keys(config);
    if (!keys.every((key) => PER_CONNECTION.has(key))) return 'config:change';
    return keys.includes('workspaceTrust') ? 'trust:push' : undefined;
  }
  return kind === 'other' && !channel.startsWith('ahp-automation') ? 'file:watch' : undefined;
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
 * The record a client pushes to `ahp-root://` carries both kinds. Almost every
 * key describes the host and is one setting for everybody, `globalAutoApproveEnabled`
 * among them, which `trust.ts` asks before a tool call runs. `defaultShell` is
 * the person's: the host's own note by `rootConfig` says so, and names VS Code
 * pushing it out of `terminal.integrated.agentHostProfile.<os>` on connect.
 *
 * Kept in one shared record they are the same thing on a one-person daemon and
 * not on any other: whoever connected last decided everybody's shell. So these
 * live on the `Connection`, and a connection reads its own back.
 *
 * `workspaceTrust` is the person's for the same reason and a sharper one: it is
 * a window's answer about the folders that window has opened, and kept in the
 * shared record the last window to connect decided what every session on the
 * host loads from its project - decision
 * `a-folder-is-untrusted-until-a-client-says-otherwise`.
 */
export const PER_CONNECTION = new Set(['defaultShell', 'workspaceTrust']);

/**
 * Whether this connection is somebody who may read the daemon's own settings.
 *
 * The keys `HostOptions.rootConfig` carries are `config:read`'s and not
 * `config:write`'s, because a write names a key and a read names a value - and
 * one of those values may be a credential - decision
 * `root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value`.
 * The read is the whole group rather than the `settings` operation beside it:
 * what is behind it is every key the daemon holds, not one of them.
 * The host's own root holds every grant, as it does at every other gate.
 * A host with no people directory has nobody to ask, so nobody sees them.
 */
export const seesConfig = (connection: Connection | undefined): boolean =>
  connection?.root === true || connection?.principal?.can('config:settings') === true;

/** The kinds of channel a family of client action can belong on. */
export type Home = 'session' | 'terminal' | 'automations' | 'root' | 'watch';

/**
 * Each family of client action, by the part of its type before the slash:
 * the kind of channel it belongs on.
 *
 * An action on a channel of another kind is refused before any handler reads
 * it, since a handler acts on the action and not on the channel. What
 * dispatching one needs is `ACTION_NEEDS`, which reads the action rather than
 * the family; a watch's actions are its owner's to say.
 */
export const ACTION_HOMES: Record<string, { home: Home }> = {
  session: { home: 'session' },
  chat: { home: 'session' },
  annotations: { home: 'session' },
  changeset: { home: 'session' },
  terminal: { home: 'terminal' },
  automation: { home: 'automations' },
  automationRun: { home: 'automations' },
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
export const GATE = { NEEDS, UNGATED, ACTION_NEEDS, dispatchNeeds };

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
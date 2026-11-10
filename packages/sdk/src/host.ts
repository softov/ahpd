/**
 * The protocol server: channels, subscriptions, requests and state actions.
 *
 * One host serves many connections. It owns the session catalogue, the live
 * sessions and the sequence number that orders everything it emits.
 *
 * Rules that govern anything answering AHP:
 *
 * - `serverSeq` advances with every action envelope this host sends. A
 *   snapshot is taken at a sequence number and every action after it carries
 *   a greater one, which is how a client knows it missed nothing.
 * - Notifications carry no id and get no reply. `unsubscribe` and
 *   `dispatchAction` are notifications.
 * - Subscriptions are per connection. Dropping one client's subscription must
 *   not affect another's.
 * - Only client-dispatchable actions are accepted from clients; the rest are
 *   the host reporting what it did.
 */

import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ACTION_INTRODUCED_IN, annotationsReducer, chatReducer, isActionKnownToVersion, rootReducer, sessionReducer } from '@microsoft/agent-host-protocol';
import type {
  AnnotationsAction, AnnotationsState, ChatAction, ChatState, RootAction, RootState, SessionAction, SessionInputRequestKind, SessionState, StateAction,
  SubscribeView, ToolDefinition,
} from '@microsoft/agent-host-protocol';
import type { WireTurn } from './types/wire.js';
import { INVALID_PARAMS, RpcError, METHOD_NOT_FOUND } from './rpc.js';
import { computerId, computersFor } from './machines/computers.js';
import { nestedAgent } from './sessions/nested.js';
import { createCallLinks } from './automations/calllinks.js';
import { createSessionEvents } from './host/sessionevents.js';
import { idFor, idOf, mergeLogicalTurnUsage, uriFor, Status } from './sessions/catalog.js';
import { memorySessions } from './sessions/sessions.js';
import { meter } from './usage/meter.js';
import { debugLogs } from './sessions/debuglogs.js';
import { reduceChatConfigChanged } from './vscode/chatconfig.js';
import type { ChatConfigChangedAction } from './vscode/chatconfig.js';
import type { Terminal } from './types/terminals.js';
import type { SessionConfigAnswerer, SessionConfigAsk } from './types/completions.js';
import type { MessageAttachment, MessageFrom } from './types/session.js';
import type { ClientChange, Connection, ConnectedClient, Credential, Host, HostOptions, HostTool, TitleStrategy, ToolCall } from './types/host.js';
import type { Principal } from './types/users.js';
import type { Summary } from './types/catalog.js';
import type { Agent, BoundTool, Listed, McpServer } from './types/agent.js';
import type { ToolsEndpoint } from './tools/server.js';
import type { Bag } from './types/common.js';
import type { Session, SubagentChat, SubagentRequest } from './types/session.js';
import type { Peer } from './types/rpc.js';
import type { Opened } from './types/listen.js';
import type { Owner } from './types/usage.js';
import type { StoredWorktree } from './types/sessions.js';
import type { ChannelSubscriber, PublishOptions } from './types/plugin.js';
import { bag, ownerFilter, ownerOfPrincipal } from './utils/values.js';
import { reason } from './host/common.js';
import { clientQueueBytes, replayBytes } from './host/limits.js';
import {
  ROOT, RESTART_NEEDED, isRootChannel, AUTOMATIONS, AUTOMATIONS_ME, spaceOf, servedIn, methodIn, named,
  chatUriFor, subagentChatUri, WORKER_ACTIONS, toolCallOfSubagentChat, isAutomations, automationOwner,
  parseResourceWatchChannelUri, schemeOf, ANNOTATIONS_PATH_SEGMENT,
} from './host/channels.js';
import type { Space } from './host/channels.js';
import { DELTA_WINDOW_MS, merger } from './host/deltas.js';
import { Claiming } from './host/state.js';
import type { Claimed, Held, HeldState, Learned, LiveSubagent, NameKind, Origin } from './host/state.js';
import { GREETINGS, UNGATED, seesAccount, seesConfig, DECLARED, ownIn } from './host/gate.js';
import type { Home } from './host/gate.js';
import { createChatRecord } from './host/chatrecord.js';
import { createRouting } from './host/routing.js';
import { createRelay } from './host/relay.js';
import { AGENT_CLIENT_SCHEME } from './host/clienturi.js';
import { createChangesets } from './host/changesets.js';
import { createFacts } from './host/facts.js';
import { createOwners } from './host/owners.js';
import { createMachines } from './host/machines.js';
import { createSessionConfig } from './host/sessionconfig.js';
import { accountKey, createRoot, RESTART_KEY } from './host/root.js';
import { createCatalogue } from './host/catalogue.js';
import { createSpawn } from './host/spawn.js';
import { createBackground } from './host/background.js';
import { createCanvases } from './host/canvases.js';
import { createSandbox } from './host/sandbox.js';
import { TOOL_RESULT_RESOURCE_LIMIT, toolResultResources } from './resources/toolresults.js';
import { createLifecycle } from './host/lifecycle.js';
import { createTooling } from './host/tooling.js';
import { createAsking } from './host/asking.js';
import { createTerminalMethods, createTerminals } from './host/terminals.js';
import { createShells } from './host/shells.js';
import { createOutputs } from './host/outputs.js';
import { createLocalTurns } from './host/localturns.js';
import { createAutomations } from './host/automations.js';
import { createHistory } from './host/history.js';
import { createSnapshots } from './host/snapshots.js';
import { createSleep } from './host/sleep.js';
import { createSessionLifecycle } from './host/sessionlifecycle.js';
import { createWakes } from './host/wakes.js';
import { createQueueDrain } from './host/queuedrain.js';
import { createTelemetry } from './host/telemetry.js';
import { createAuth } from './host/auth.js';
import { createAdmission } from './host/admission.js';
import { createHandshake } from './host/handshake.js';
import { createResourceMethods } from './host/resourcemethods.js';
import { createSessionMethods } from './host/sessionmethods.js';
import { createAutomationMethods } from './host/automations.js';
import { createVscodeMethods } from './host/vscodemethods.js';
import { createActions } from './host/actions.js';
import { reservedName } from './plugins/validate.js';
import { gitSettled } from './repo/hardened.js';
import type { ConnectionContext, DetachedWorktree, HostContext } from './host/context.js';
import { HOST_CATALOGS } from './i18n.js';
import type { Catalogs } from './i18n.js';
export { GATE, refusalReason } from './host/gate.js';

/**
 * The three methods a connection may send before it has been introduced.
 *
 * `initialize` and `reconnect` are the two ways in. `ping` is neither: the
 * spec says a server MUST answer it whether or not the client has completed
 * `initialize`, because it is how a client tells a live socket from one an
 * idle proxy has quietly dropped.
 */
/**
 * How long `Host.close` waits for the agents and terminals it ended to exit.
 *
 * Long enough for a backend to take its process down after stdin closes, and
 * short enough that a process that ignores its kill does not hold a stop or a
 * restart for ever: what is still running then is left to the operating system.
 */
export const HOST_CLOSE_WAIT_MS = 5_000;

/**
 * How long a client's place in a session, and the tool calls it owes there,
 * are kept after its connection closes, where the daemon's
 * `clientToolCallDisconnectTimeoutMs` says nothing: VS Code's
 * `CLIENT_TOOL_CALL_DISCONNECT_TIMEOUT`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L132
 *
 * A dropped socket is not a client that has finished with a session: what it
 * announced there - the tools it runs, the plugins it handed over - is in the
 * session's hands rather than the connection's, and a client that subscribes
 * again inside this window has never left. Nothing is said about it in the
 * meantime, and nothing it contributes is taken away.
 */
export const CLIENT_TOOL_CALL_DISCONNECT_TIMEOUT_MS = 30_000;

/**
 * How long a resource watch's watcher is held after its last subscriber left:
 * the reference host's `RESOURCE_WATCH_GRACE_MS`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L616
 */
const RESOURCE_WATCH_GRACE_MS = 30_000;

/**
 * The action types the protocol knows, which are the ones a version decides.
 *
 * A plugin action type is on its plugin's own scheme and no protocol version
 * introduced it, so it is not in this set and is never held back by a version.
 * The registry answers only for its own keys, and asking it about a type it
 * does not hold would throw rather than answer.
 */
const PROTOCOL_ACTIONS = new Set(Object.keys(ACTION_INTRODUCED_IN));

/**
 * One principal, held as this host's own: frozen, and its `roles` with it.
 *
 * Where this library builds a principal it freezes there, roles included. An
 * embedder hands `accept` its own literal instead, and a principal frozen one
 * level deep leaves the `roles` array writable - which is the one thing on a
 * principal that decides a grant, so a provider, a hook or a scheme's own
 * methods could hand the person a role the daemon never did.
 *
 * Frozen in place rather than copied, and the principal is not spread before
 * it: a principal the user directory built carries getters that re-read the
 * file, and spreading it would stamp each one with today's answer.
 */
function heldPrincipal(who: Principal): Principal {
  if (Array.isArray(who.roles)) Object.freeze(who.roles);
  return Object.freeze(who);
}

/**
 * The options a plugin sets as a port, which a live fold may not move.
 *
 * `PortKey` in `types/plugin.ts` is the contract and the fold's own runtime
 * list is private to it, so the same names are written here for `replace` to
 * read. A store is one the host was built over and every area reads and writes
 * through; a fold that brings a different one is a host rebuilt at its next
 * start.
 */
const PORTS = [
  'resources', 'terminals', 'changes', 'directories', 'worktrees',
  'github', 'automations', 'sessions', 'diagnostics', 'computers', 'containers', 'usage', 'policies', 'vault', 'records',
  'commandParser',
] as const satisfies readonly (keyof HostOptions)[];

export function createHost(options: HostOptions): Host {
  const dir = options.path;
  /**
   * Every name this host holds or has handed out, and what it is.
   *
   * A session under its held name and every name a client created it under,
   * its chats, including the ones a client named, its worker chats,
   * terminals and resource watches. One name is one thing: a new session,
   * chat or terminal is refused a name already here (`claimable`), and the
   * users gate reads a
   * channel's kind from here (`channelKind`). Written by the maps that hold
   * each kind, which are `Claiming`, and by `createSession` for the name a
   * client asked for.
   */
  const claims = new Map<string, Claimed>();
  /**
   * Why a list of agents cannot be served, or nothing.
   *
   * The two rules `createHost` throws on, in the form `replace` answers with:
   * a name that belongs to the host's own plumbing, and two agents answering
   * to one id. Asked of a whole list rather than one agent at a time, because
   * a clash is between two entries.
   */
  const agentsProblem = (list: readonly Agent[]): string | undefined => {
    const seen = new Set<string>();
    for (const agent of list) {
      const reserved = reservedName(agent.provider);
      if (reserved !== undefined) return `An agent may not call itself ${agent.provider}: ${reserved}`;
      if (seen.has(agent.provider)) return `Two agents both call themselves ${agent.provider}`;
      seen.add(agent.provider);
    }
    return undefined;
  };
  /**
   * The backends this host serves, by the id clients name.
   *
   * A host with two answers `createSession` for either and lists both
   * catalogues as one. Nothing below here knows what any of them are.
   *
   * Changed in place rather than replaced, because `createRoot` holds this map
   * and an agent list rebuilt as a new map would leave it listing the old one.
   */
  const agents = new Map<string, Agent>();
  const problem = agentsProblem(options.agents);
  if (problem !== undefined) throw new Error(problem);
  for (const agent of options.agents) agents.set(agent.provider, agent);
  /**
   * Every directory any backend catalogues, plus the host's own.
   *
   * Where past sessions and branches are looked for; not what a client may
   * read, which is anything. Asked each time rather than captured, because a
   * backend may learn about a directory after this host started.
   */
  const browsable = (): string[] => {
    // Resolved, so each folder is spelled as a session's folder comes back
    // from its URI: `/home/me` is `C:\home\me` on Windows, and the facts read
    // for one are looked up under the other.
    const found = new Set<string>([resolve(options.path)]);
    for (const agent of options.agents) {
      for (const dir_ of agent.directories?.() ?? []) found.add(resolve(dir_));
    }
    return [...found];
  };
  const connections = new Set<Connection>();
  /** The calls the client registry makes on each arrival and departure. */
  const clientWatchers = new Set<(change: ClientChange) => void>();
  /** Tell each watcher of the client registry what moved. */
  const clientsChanged = (change: ClientChange): void => {
    for (const watcher of clientWatchers) watcher(change);
  };
  /**
   * The ten `resource*` methods, which run in both directions.
   *
   * `CommandMap` and `ServerCommandMap` carry the same ten entries with the
   * same params and the same results, so a request naming a URI a client
   * published is the same request sent back the other way.
   */
  /**
   * Who is in each session, by session URI and then by client id.
   *
   * The protocol calls these `activeClients` and makes membership the host's
   * to keep: a client announces itself with `session/activeClientSet` and the
   * host takes it out again when the client unsubscribes or goes. Keyed by
   * the `clientId` each entry carries rather than by connection, because that
   * is what the protocol's reducer keys it by - a client that reconnects is
   * the same client, and an entry carrying no `clientId` is one entry.
   *
   * By the id inside a session's URI, as the session store is: a client
   * announces itself on the way in, which can be before this host has listed
   * anything and so before it knows the name it will publish that session
   * under.
   */
  const presence = new Map<string, Map<unknown, Bag>>();

  /**
   * The resource watches running, by the channel that names each.
   *
   * The protocol ties a watch's life to its subscription - there is no dispose
   * command, and `unsubscribe` is the only handle a client needs - so a watch
   * is attached at its channel's first subscribe and let go after the last
   * `unsubscribe` or dropped connection, with one watcher per reader among its
   * subscribers.
   */
  const watches = new Claiming<{
    state: Bag;
    watchers: Map<string, { watcher: { close(): void }; grace?: ReturnType<typeof setTimeout> | undefined }>;
  }>(claims, 'watch');
  /**
   * `IsRead` and `IsArchived`, per session - by the **id** inside its URI.
   *
   * Keyed by the id and not the URI because a client may set a flag on a row
   * before this host has listed anything, and until it has, the name it will
   * publish that session under is not yet known. The id is the identity; the
   * scheme is only whose it is.
   *
   * The client flags, and unlike the in-process host these genuinely belong
   * here: a flag one client sets is a flag every other client has to see, and
   * that is exactly what having a host buys.
   *
   * The store also holds the configuration chosen for a session that has no
   * agent running: a row read from its transcript is configurable before it is
   * resumed, and most of what the schema offers is fixed when the query is
   * built, so a session resumed without those answers is one that can never be
   * given them.
   *
   * Held by the store rather than in maps here, so a host given one that
   * writes them down still has them after a restart. The default forgets,
   * which is what an embedded host wants; see `SessionStore`.
   */
  const kept = options.sessions ?? memorySessions();
  /** Live sessions, by their own uri. */
  const sessions = new Map<string, Held>();
  /**
   * The live sessions restored from one the backend recorded, whose workers
   * from before this process are read back beside the live ones, as VS Code
   * registers a restored session's subagent chats. A session started fresh
   * has none, and its backend's record is not read.
   */
  const restoredSessions = new Set<string>();
  /** Every chat, back to the session holding it, and the road its turns are said on. */
  const byChat = new Claiming<{ uri: string; chat: Session; say(action: Record<string, unknown>): void }>(claims, 'chat', (_, held) => held.uri);
  /**
   * The peer directories each chat was given, when they are not its session's.
   *
   * A chat may hold a subset: the protocol says every entry of a chat's set
   * MUST be in its session's, and which of them a particular conversation is
   * about is that conversation's business. Kept here because restarting one
   * chat has to hand it back what it had.
   */
  const beside = new Map<string, string[]>();
  /**
   * The chats made out of another, by URI: the `fork` or `sideChat` origin
   * each was created with, naming the source chat as this host holds it.
   */
  const madeFrom = new Map<string, Bag>();
  /** The title each chat's backend said last, so a move of it is noticed. */
  const described = new Map<string, string>();

  const subagents = new Claiming<LiveSubagent>(claims, 'chat', (_, held) => held.session);

  /** The open turn of each chat and the content of each spawning call, which a worker's link is written from. */
  const links = createCallLinks();

  /**
   * The chat a session-level question is really about.
   *
   * The default one: its status is the session's, its customizations are what
   * the session was handed, and it is the one a client talks to when it has
   * not asked for another.
   */
  const leadOf = (held: Held): Session | undefined => held.chats.get(held.defaultChat);
  /**
   * Which backend a session belongs to, by session URI.
   *
   * Kept for live ones as they are started and for browsed ones as they are
   * listed: the URI says nothing about who owns it, and everything answered
   * about a session - its schema, its transcript, the process that continues
   * it - is that backend's answer rather than the host's.
   */
  const owners = new Claiming<Agent>(claims, 'session');
  const names = new Map<string, string>();
  /**
   * Terminals, by their own channel URI.
   *
   * The host's rather than a session's: a terminal outlives the turn that
   * opened it, several clients watch one, and the protocol lists them on the
   * *root* channel - which is where something owned by no session belongs.
   */
  const terminals = new Claiming<Terminal>(claims, 'terminal');
  /** The one close, shared by every caller of `close`. */
  let closing: Promise<void> | undefined;
  /** The automation runs starting a session now, which a close waits for. */
  const starting = new Set<Promise<string>>();
  /**
   * What started a session, for the ones nothing did.
   *
   * Only automations put anything here. A session somebody opened has no
   * origin, which is what the protocol says absent means.
   */
  const origins = new Map<string, { kind: 'automation'; automation: string; run: string }>();
  /** Where a browsed session ran, as its own catalogue reported it. */
  const wheres = new Map<string, string[]>();
  /**
   * When a browsed session was started, as its own catalogue reported it.
   *
   * Kept for the same reason `wheres` is: a session resumed from a transcript
   * was created when its backend created it, and this host was not there. The
   * alternative is a row whose age is the moment somebody happened to open it.
   */
  const births = new Map<string, string>();
  /**
   * When a browsed session was last written to, as its own catalogue reported
   * it.
   *
   * The companion to `births`, and wanted for the same reason: a session this
   * host is not running was last touched whenever its transcript was, and
   * answering with the current time makes every read of a cold session look
   * like an edit.
   */
  const moves = new Map<string, string>();
  /**
   * What a backend said about a browsed session, by its own uri.
   *
   * `_meta` on a listed row, kept for the same reason `births` and `moves`
   * are: the row is answered from this map long after the listing that named
   * it, and no agent is running to be asked what it holds. Replaced whole on
   * each listing, and removed when the row stops carrying one.
   */
  const listedMeta = new Map<string, Bag>();
  /**
   * Every client this host has handshaken with and still keeps a record of,
   * by the id it gave.
   *
   * What `reconnect` is answerable *against*. A client comes back saying "I am
   * this id and I had seen up to here", and both halves are meaningless to a
   * host that has never met it: this one's sequence numbers are its own, so
   * "everything after 419" means nothing if 419 was another process's. A
   * daemon that restarts has forgotten every client, and a record is forgotten
   * once its client has been gone for the reference host's retention.
   */
  const known = new Set<string>();
  /** When each client with no connection open went, by client id. */
  const lastSeen = new Map<string, number>();
  /** The state channels each client was subscribed to with no baseline from this process, by client id. */
  const baselineDebt = new Map<string, Set<string>>();
  /*
   * A client's debt on one channel settled, as VS Code's host clears it: by a
   * baseline given, a subscribe, an unsubscribe, or a channel reported missing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1256-L1262
   */
  const clearBaselineDebt = (clientId: string, channel: string): void => {
    const owed = baselineDebt.get(clientId);
    if (owed?.delete(channel) && owed.size === 0) baselineDebt.delete(clientId);
  };
  /**
   * The person who first signed in under each client id, by client id: the
   * only one a `reconnect` under that id is answered for.
   */
  const holders = new Map<string, string>();
  /** The last locale each client sent, by client id. */
  const locales = new Map<string, string>();
  /** The name each client gave in `clientInfo` at `initialize`, by client id. */
  const clientNames = new Map<string, string>();
  /** The protocol version each client agreed at `initialize`, by client id. */
  const clientVersions = new Map<string, string>();
  const learned = new Map<string, Learned>();
  const about = (provider: string): Learned => {
    const held = learned.get(provider);
    if (held) return held;
    const made: Learned = { models: [], commands: [], customizations: [] };
    learned.set(provider, made);
    return made;
  };
  /**
   * How many actions to keep for a client that comes back.
   *
   * A number, because the alternative is a buffer that grows for the length
   * of the daemon's life. Past it, a returning client is handed fresh
   * snapshots instead - which is correct, only more expensive, and is what
   * the protocol has the second reconnect result for.
   *
   * The count is the reference host's; the bytes beside it are this host's
   * (`replayBytes`), because a thousand envelopes of a config echo and a
   * thousand carrying a turn's text are not the same weight held for the
   * length of a daemon's life.
   */
  const REPLAY = 1000;
  /** The last `REPLAY` action envelopes, refusals among them, oldest first. */
  const replayable: { channel: string; action: Record<string, unknown>; serverSeq: number; origin: Origin | undefined; audience?: PublishOptions; rejectionReason?: string }[] = [];
  /**
   * What each held envelope's text weighs in bytes, in step with `replayable`.
   *
   * Beside the buffer rather than on the envelope, because a held entry is
   * what a client is sent: `projectActionForClient` hands most of them back exactly as they
   * are, and a size on one would be a field no client declared.
   */
  const weights: number[] = [];
  /** What `replayable` weighs together, so the budget is not a sum over it. */
  let weight = 0;
  /**
   * The state of the root channel and of every session and chat channel this
   * host holds open, as the protocol's reducers make it.
   *
   * Seeded once, when the channel opens, from what its backend restores and
   * what this host keeps beside it, and changed from then on only by the
   * actions `emit` sends on the channel, each through the reducer for its
   * kind before anything reads the state. That is the reducer a client runs
   * over the same actions, so a client that watched and a client that
   * subscribes afterwards hold one state. What a backend holds for its own
   * work stays the backend's; what a client is served is this.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L232
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2881-L2971
   */
  const states = new Map<string, HeldState>();
  /**
   * One action through the protocol's reducer for the kind of state it lands
   * on. A type the reducer does not know is said in this host's log, which is
   * where the reducer's own warning goes. A chat's `chat/configChanged`, which
   * VS Code's protocol adds ahead of the package, goes through VS Code's own
   * case for it.
   */
  const reduced = (open: HeldState, action: Bag): Bag => {
    const said = (message: string): void => { log(message); };
    if (open.kind === 'root') return rootReducer(open.state as unknown as RootState, action as unknown as RootAction, said) as unknown as Bag;
    if (open.kind === 'session') return sessionReducer(open.state as unknown as SessionState, action as unknown as SessionAction, said) as unknown as Bag;
    if (action.type === 'chat/configChanged') return reduceChatConfigChanged(open.state, action as unknown as ChatConfigChangedAction);
    return chatReducer(open.state as unknown as ChatState, action as unknown as ChatAction, said) as unknown as Bag;
  };
  /** Everything subscribed to a channel, which is not everything connected. */

  /**
   * What a client has marked on a session, by that session's id.
   *
   * Kept, not computed. Annotations are the one channel whose state is
   * entirely a client's: nothing here produces a mark, and what this host
   * contributes is that a mark one client made is a mark every other client
   * in the session can see. Keyed by the session's id, as the flags are: the
   * id is what the store keeps everything of a session under.
   */
  const marks = new Map<string, AnnotationsState>();

  /**
   * The worktree each isolated session runs in, by session URI.
   *
   * Only the ones this host made. A directory somebody pointed a session at is
   * theirs, and removing it because a session ended would be this daemon
   * deleting a project.
   */
  const worktrees = new Map<string, StoredWorktree>();
  /**
   * The worktree a session runs in: the one this process made, else the one
   * the store kept from a process before it.
   */
  const worktreeOf = (uri: string): StoredWorktree | undefined => worktrees.get(uri) ?? kept.worktree?.(idOf(uri));
  /**
   * The worktrees the reference window made for itself and holds a handle on.
   *
   * Its dev container flow (`vscode/createAgentHostDetachedWorktree` and the
   * four beside it): a tree cut for a creating session before it spoke,
   * claimed once a session started in it, taken down and put back with the
   * window's archived bit, deleted when the window is done with it, and
   * reconciled against the set the window still knows about.
   */
  const detached = new Map<string, DetachedWorktree>();
  /**
   * The config keys this host answered for a session, by session URI.
   *
   * Kept because nothing else can say them back. `isolation` and its two
   * companions are stripped before the backend is handed anything, and a
   * session's channel reports the *backend's* settings - so a session created
   * as a worktree said nothing anywhere about why its directory was where it
   * was, and a client had to infer it from the path.
   */
  const decided = new Map<string, Record<string, unknown>>();
  /**
   * A session's restart in flight, by session URI.
   *
   * A fixed key can only be moved by starting the backend again, and the
   * first send pushes the whole config and then the first turn back to back -
   * so the turn can arrive while the restart is still running. An action that
   * reaches such a session waits here rather than being applied to the
   * backend that is on its way out, and a turn's send waits here too. Each
   * settles with the failure's words when the start failed.
   */
  const restarting = new Map<string, Promise<string | undefined>>();
  /**
   * Each client's dispatches that wait, by its id, in the order it sent them,
   * across every connection it has, as the reference host queues a client's.
   *
   * A dispatch waits only on what this host must have before it can apply it:
   * a session woken or read from the catalogue, one being started again, a
   * message's attachments written, a turn or a queued message whose check has
   * not answered. Every dispatch the client sends meanwhile goes behind it: a
   * client that changes the config and then starts a turn means that order.
   * A wait has no time limit. Absent while nothing waits, which is when a
   * dispatch is applied at once.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12492-L12507
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12639-L12649
   */
  const dispatchQueues = new Map<string, Promise<void>>();
  /**
   * One token per session, by session URI: made the first time a
   * `session/configChanged` for it is applied, and dropped when the session
   * is disposed or a restart of it fails.
   *
   * What a late answer checks it is still about the same session: a restart
   * keeps the token, and a session disposed and created again under the same
   * name is given a new one.
   */
  const lives = new Map<string, object>();
  /** A session's token in `lives`, made when it has none. */
  const lifeOf = (uri: string): object => {
    const held = lives.get(uri) ?? {};
    lives.set(uri, held);
    return held;
  };
  /**
   * The isolation schema each session was offered when it was created.
   *
   * Kept because a session reports its own config schema and a client draws
   * its controls from that one rather than from `resolveSessionConfig`. Without
   * it a session could only describe the answer it already had - a row to read
   * - and the pre-send phase, where the answer is still somebody's to give, had
   * nothing to draw.
   */
  const offered = new Map<string, Bag>();
  /**
   * The marks on a session: the ones this process holds, else the ones the
   * store kept from a process before it, empty until somebody makes one.
   */
  const marksOf = (id: string): AnnotationsState =>
    marks.get(id) ?? (kept.annotations?.(id) as AnnotationsState | undefined) ?? { annotations: [] };

  /**
   * One mark on a session, kept and said.
   *
   * A client's action lands here, and a host tool that writes a comment makes
   * the same call with the session it runs in, so the two are one state and
   * one notice rather than two paths that could disagree. Reduced with the
   * protocol's own `annotationsReducer`, because a host that reduced it even
   * slightly differently would hand out a state its clients disagree with,
   * and written down as it lands, so the marks outlive the process.
   */
  const markAnnotation = (uri: string, action: AnnotationsAction, origin?: Origin): void => {
    const id = idOf(uri);
    const next = annotationsReducer(marksOf(id), action);
    marks.set(id, next);
    kept.setAnnotations?.(id, next as unknown as Bag);
    dispatch(`${uri}${ANNOTATIONS_PATH_SEGMENT}`, action as unknown as Record<string, unknown>, origin);
  };

  /**
   * A root notification about a session, as one connection receives it.
   *
   * An older VS Code window is told nothing about a session it may not see,
   * and of one it may see only the chats it may see, as the reference host
   * projects each notification for a client. Every other notification, and
   * every other connection, gets it as it is.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4425
   */
  const projectNotificationForClient = (connection: Connection, method: string, params: unknown): unknown => {
    if (connection.legacySessionUris !== true && connection.legacyChatUris !== true) return params;
    const notice = bag(params);
    if (method === 'root/sessionAdded') {
      const summary = bag(notice.summary);
      const session = String(summary.resource ?? '');
      if (!sessionVisible(connection, session, typeof summary.defaultChat === 'string' ? summary.defaultChat : undefined)) return undefined;
      return Array.isArray(summary.chats)
        ? { ...notice, summary: { ...summary, chats: (summary.chats as Bag[]).filter((chat) => chatShown(connection, chat.resource, session)) } }
        : params;
    }
    if (method === 'root/sessionSummaryChanged') {
      const session = String(notice.session ?? '');
      if (!sessionVisible(connection, session)) return undefined;
      const changes = bag(notice.changes);
      return Array.isArray(changes.chats)
        ? { ...notice, changes: { ...changes, chats: (changes.chats as Bag[]).filter((chat) => chatShown(connection, chat.resource, session)) } }
        : params;
    }
    if (method === 'root/sessionRemoved') return sessionVisible(connection, String(notice.session ?? '')) ? params : undefined;
    return params;
  };
  /**
   * One message, to everyone subscribed to that channel.
   *
   * Under the host's own channel, whatever spelling a client subscribed by, as
   * VS Code's host sends every envelope; its client matches the root's and the
   * automations catalogue's spellings at relevance. A root notification about
   * a session goes through `projectNotificationForClient`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/agentSubscription.ts#L1458-L1482
   */
  const broadcast = (channel: string, method: string, params: unknown, per?: (connection: Connection) => unknown): void => {
    for (const connection of connections) {
      if (!connection.activeSubscriptions.has(channel)) continue;
      const said = per === undefined ? projectNotificationForClient(connection, method, params) : per(connection);
      // Nothing for this connection: a plugin's action it may not see.
      if (said === undefined) continue;
      connection.peer.notify(method, said);
    }
  };
  /**
   * Whether a root config key is one a backend's account is published under.
   *
   * Asked of the agents this host serves rather than matched by the shape of
   * the name: `vscode.codexAccount` is VS Code's own name for one of them, and
   * a host that went by the word would be guessing at a key it does not serve.
   */
  const isAccountKey = (key: string): boolean =>
    [...agents.values()].some((agent) => accountKey(agent.provider) === key);
  /**
   * An action envelope as one connection receives it.
   *
   * Two actions are not the same for every connection. `root/configChanged`
   * carries the daemon's own keys, which are dropped for a connection without
   * `config:read`, and the agents' accounts, which are dropped for one without
   * `account:read` - the email is the operator's, and the root config is read
   * before anybody signs in. A dropped key is absent rather than emptied, the
   * same shape the snapshot leaves it in.
   * `root/agentsChanged` carries
   * the root agent list, whose sign-in resource says `required: true` for a
   * connection that must sign in and `false` for one the host already treats
   * as somebody. An older VS Code window is sent nothing on a channel it may
   * not see, and a session's chat list actions only about the chats it may
   * see, as the reference host projects each for it. Every other envelope is
   * delivered as it is.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4362-L4401
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4547-L4553
   *
   * A plugin's action carries its `audience`, and is nothing for a
   * connection the audience leaves out: one `to` does not name, or one
   * `visible` refuses with this connection's principal as it is now - decision
   * `a-plugin-channel-filters-each-action-per-subscriber`. The audience never
   * goes out on the wire.
   *
   * An action introduced after the version a connection agreed on is nothing
   * for that connection, live or replayed, as the specification requires. A
   * connection no handshake named has no version and is sent everything.
   *
   * This is the one place an envelope is rewritten for a connection, which is
   * why the live broadcast and both replay paths call it: one opinion about
   * every delivery, as VS Code's host projects an action for a client.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4375
   */
  const projectActionForClient = <E extends { channel: string; action: Record<string, unknown>; origin?: Origin | undefined; audience?: PublishOptions }>(
    connection: Connection,
    given: E,
  ): E | undefined => {
    let envelope = given;
    if ('audience' in given) {
      const { audience, ...rest } = given;
      if (audience?.to !== undefined && audience.to !== connection.clientId) return undefined;
      if (audience?.visible !== undefined) {
        try {
          if (!audience.visible(connection.principal, connection.clientId)) return undefined;
        }
        catch (error) {
          // A test that throws shows the action to nobody, as one that refused.
          log.error(`${given.channel}: a visible test threw: ${reason(error)}`);
          return undefined;
        }
      }
      envelope = rest as E;
    }
    /*
     * And held back from a connection whose agreed version does not know it.
     *
     * The specification's rule, and the only per-connection filter that is not
     * about who may see a thing: a client that agreed on `0.9.0` is not sent an
     * action the protocol registered at `0.10.0`, because its reducer has no
     * case for it. A connection with no version - one a test built by hand -
     * keeps everything.
     */
    const { action } = envelope;
    if (connection.protocolVersion !== undefined
      && PROTOCOL_ACTIONS.has(String(action.type))
      && !isActionKnownToVersion(action as unknown as StateAction, connection.protocolVersion)) return undefined;
    if (!isRootChannel(envelope.channel)) {
      if (!visible(connection, envelope.channel)) return undefined;
      if (connection.legacyChatUris !== true) return envelope;
      const session = envelope.channel;
      if (action.type === 'session/chatAdded') return chatShown(connection, bag(action.summary).resource, session) ? envelope : undefined;
      if (action.type === 'session/chatUpdated' || action.type === 'session/chatRemoved') {
        return chatShown(connection, action.chat, session) ? envelope : undefined;
      }
      if (action.type === 'session/chatsReordered' && Array.isArray(action.chats)) {
        return { ...envelope, action: { ...action, chats: action.chats.filter((chat) => chatShown(connection, chat, session)) } };
      }
      return envelope;
    }
    if (action.type === 'root/agentsChanged') {
      return { ...envelope, action: { ...action, agents: agentsFor(connection, action.agents) } };
    }
    if (action.type !== 'root/configChanged') return envelope;
    const config = (typeof action.config === 'object' && action.config !== null ? action.config : {}) as Record<string, unknown>;
    /*
     * Under a people directory, the daemon's own keys go to a connection
     * holding `config:read` and to no other, the sender among them. A write is
     * `config:write`'s and a value is `config:read`'s, so somebody who may
     * change the listener but not read the settings is refused the answer
     * rather than trusted with it - and the envelope is one per host, which is
     * why this is here and not where the change is applied. A host with no
     * directory says the whole change to every connection.
     */
    const directory = options.users !== undefined;
    const mine = seesConfig(connection, directory)
      ? config
      : Object.fromEntries(Object.entries(config).filter(([key]) => !daemonHeld(key)));
    /*
     * And the accounts go to a connection holding `account:read` and to no
     * other, the sender among them. A client pushing a config it may not read
     * the account in is refused the answer rather than trusted with it, which
     * is the rule the daemon's keys already take - decision
     * `an-agent-account-is-shown-to-account-readers`.
     */
    const shown = seesAccount(connection, directory)
      ? mine
      : Object.fromEntries(Object.entries(mine).filter(([key]) => !isAccountKey(key)));
    return shown === config ? envelope : { ...envelope, action: { ...action, config: shown } };
  };
  /**
   * One state action, to everyone subscribed to that channel.
   *
   * `serverSeq` moves here, once for each envelope, and in `refuse` for a
   * refusal said to its sender alone. A snapshot is taken *at* a sequence
   * number and every action after it carries a greater one, which is how a
   * client knows it missed nothing.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/state.ts#L357
   *
   * An action refused carries `rejectionReason`, and is sequenced, held for
   * replay and sent the same way to every other client of the channel; its
   * sender is answered by `refuse`, and no state takes it.
   */
  const emit = (
    channel: string,
    action: Record<string, unknown>,
    origin: Origin | undefined,
    audience?: PublishOptions,
    refused?: { reason: string; by: Peer },
  ): void => {
    /*
     * A chat's action on a channel that holds no chat is not said, as VS
     * Code's host refuses to emit one: no client could reduce it there.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2942-L2945
     */
    const kind = states.get(channel)?.kind ?? (sessions.has(channel) ? 'session' : undefined);
    if (refused === undefined && kind !== undefined && kind !== 'chat' && String(action.type ?? '').startsWith('chat/')) {
      log.warn(`${channel}: ${String(action.type)} is a chat's action and ${channel} holds no chat, so it is not said`);
      return;
    }
    ctx.serverSeq += 1;
    const rejectionReason = refused?.reason;
    const envelope = {
      channel,
      action,
      serverSeq: ctx.serverSeq,
      origin,
      ...(audience === undefined ? {} : { audience }),
      ...(rejectionReason === undefined ? {} : { rejectionReason }),
    };
    // Kept whether or not anyone was listening: a client that dropped is by
    // definition not listening, and it is the one that will ask for these.
    //
    // Kept as a *value*, for the reason a snapshot is one. These actions are
    // built out of the host's live structures - the `part` a
    // `chat/responsePart` announces is the object the deltas after it are
    // still writing into - and an envelope held for replay is serialised long
    // after it was made. By reference, a response part replayed to a client
    // that arrived late already carries the text of every delta that
    // followed, and the client then applies those deltas too: the word
    // written twice. The live broadcast below is serialised in this same
    // tick, so it is the copy in the buffer that has to be frozen.
    const held = { ...envelope, action: structuredClone(action) };
    /*
     * The channel's state takes the action before anything reads it, through
     * the reducer for its kind and from the frozen copy: a reducer keeps what
     * an action carries, and the live object is one a backend may still be
     * writing into. An action of another kind than its channel's is no change
     * to that state, and a reducer that throws on a malformed one leaves the
     * state as it was.
     */
    /*
     * A running session's state opens at its first action if nothing read it
     * before. The seed is read now and the action reduced on top: a session
     * action sets, upserts or removes what it names, so on a seed that already
     * carries it the action leaves it as it was.
     */
    if (rejectionReason === undefined) {
      if (!states.has(channel) && sessions.has(channel)) ctx.sessionStateOf(channel);
      const open = states.get(channel);
      if (open !== undefined) {
        const type = String(action.type ?? '');
        if (!type.startsWith(`${open.kind}/`)) log.warn(`${channel}: ${type} is not a ${open.kind} action, so its state is as it was`);
        else {
          try { open.state = reduced(open, held.action); }
          catch (error) { log.error(`${channel}: ${type} was not reduced: ${reason(error)}`); }
        }
      }
      ctx.telemetered(channel, action);
      ctx.links.observe(channel, action);
      ctx.sessionEvents.observe(channel, action);
    }
    replayable.push(held);
    // Measured once, here, as the text this envelope will go out as.
    const size = JSON.stringify(held).length;
    weights.push(size);
    weight += size;
    /*
     * Past the count or past the budget the oldest go, and never the newest
     * whatever it weighs on its own: a client that comes back is replayed
     * from here, and one envelope heavier than the whole budget is still the
     * state this host holds. The budget is read at each push, so a value
     * pushed while the host runs applies to the next action.
     */
    const budget = replayBytes(ctx.rootConfig);
    while (replayable.length > REPLAY || (replayable.length > 1 && weight > budget)) {
      replayable.shift();
      weight -= weights.shift() ?? 0;
    }
    broadcast(channel, 'action', envelope, (connection) => (connection.peer === refused?.by ? undefined : projectActionForClient(connection, envelope)));
  };
  /**
   * The window a streamed delta waits in, which `dispatch` sends through.
   *
   * One merge for the whole host, over every channel, so that a backend needs
   * to know nothing about it: what a chat draws is the text it was sent, and
   * the text is the same in one envelope as in fifty. A delta held here has no
   * sequence number yet, which is why everything that answers a client with
   * state - a snapshot, a replay, a disposal - goes through `flush` first.
   */
  const deltas = merger({ windowMs: options.deltaWindowMs ?? DELTA_WINDOW_MS, send: emit });
  /**
   * The dispatches answered already, by the origin each carries: its echo or
   * its refusal. A dispatch is answered once, and a host that said one and then
   * refused it would leave its client reverted and every other client moved.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md#L20
   */
  const said = new WeakSet<Origin>();
  /**
   * One state action on its way out.
   *
   * With `origin`, a client's own action, said as that client sent it once
   * this host's checks of it have passed and before anything it causes: the
   * echo the client holds its action pending for. With none, this host's own
   * action, whatever produced it, a backend's included.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2737-L2752
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L7-L11
   *
   * The three kinds that stream text are gathered for `deltaWindowMs`; every
   * other action flushes them and goes out itself, so nothing a client reads
   * against the text is sent ahead of it.
   */
  const dispatch = (channel: string, given: Record<string, unknown>, origin?: Origin): void => {
    let action = ctx.withWorkerUri(channel, given);
    // A root config change leaving the root's values as they are is not said,
    // this host's own included, as VS Code's host emits none.
    if (channel === ROOT && action.type === 'root/configChanged' && ctx.changesNothing(bag(action.config), action.replace === true)) return;
    if (origin !== undefined) said.add(origin);
    /*
     * A resumed turn as one turn across its runs, as VS Code's host says it: a
     * backend's usage for the run after the resume merged over what the run
     * before used, and its end carrying the time the run before took as well.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L966-L975
     */
    const resumed = origin === undefined ? ctx.resumedTurns.get(`${channel}\n${String(action.turnId ?? '')}`) : undefined;
    if (resumed !== undefined && action.type === 'chat/usage') {
      action = { ...action, usage: mergeLogicalTurnUsage(resumed.usage, action.usage as Record<string, unknown> | undefined) ?? action.usage };
    }
    if (resumed !== undefined && (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error')) {
      action = { ...action, duration: resumed.duration + (typeof action.duration === 'number' ? action.duration : 0) };
    }
    /*
     * A backend's start of a turn the chat holds is not said: the host said
     * the client's start of it, and a second start would open the turn again
     * in every client's state, as the protocol's reducer replaces the active
     * turn with the one a start names.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L358-L368
     */
    if (action.type === 'chat/turnStarted' && origin === undefined) {
      const held = states.get(channel);
      const turns = held?.kind === 'chat' && Array.isArray(held.state.turns) ? held.state.turns as Record<string, unknown>[] : [];
      if (held?.kind === 'chat' && ((held.state.activeTurn as Record<string, unknown> | undefined)?.id === action.turnId
        || turns.some((turn) => turn.id === action.turnId))) return;
    }
    const held = states.get(channel);
    const active = held?.kind === 'chat' ? (held.state.activeTurn as Record<string, unknown> | undefined)?.id : undefined;
    const ends = action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error';
    if (ends) {
      /*
       * A question a host tool asked in this turn has nobody left to answer
       * it: the turn it was asked in is over. Settled as cancelled at every
       * end, said or not, so the tool returns that to the model rather than
       * waiting on a person a stopped turn no longer has.
       */
      asks.clearTurn(channel, String(action.turnId ?? ''));
      // And a resumed turn is over, its time with it.
      ctx.resumedTurns.delete(`${channel}\n${String(action.turnId ?? '')}`);
    }
    /*
     * A backend's removal of an entry the session no longer holds is not said
     * either: this host took the entry down when the request it named
     * resolved, and an entry goes once.
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L117-L157
     */
    if (action.type === 'session/inputNeededRemoved' && origin === undefined) {
      const held = states.get(channel);
      const entries = held?.kind === 'session' && Array.isArray(held.state.inputNeeded) ? held.state.inputNeeded as Record<string, unknown>[] : [];
      if (held?.kind === 'session' && !entries.some((entry) => entry.id === action.id)) return;
    }
    /*
     * A backend's action of a turn other than the one the chat runs is stale
     * and not said, and with no turn running, a completion of a turn a stop
     * ended is not said either: the reference host's rule for its agents'
     * actions. Everything else a backend says goes out, a late end and a
     * second result for a call among them, and the protocol's reducer leaves
     * what no longer applies as it was.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L900-L918
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L944-L963
     */
    if (origin === undefined && held?.kind === 'chat' && typeof action.turnId === 'string' && action.type !== 'chat/truncated') {
      const stale = active !== undefined
        ? action.turnId !== active
        : action.type === 'chat/turnComplete' && ctx.cancelledTurns.get(channel)?.has(action.turnId) === true;
      if (stale) return;
    }
    // Whether this action ends the chat's active turn, which the reducer ends only when the ids match.
    const ending = ends && held?.kind === 'chat' && active === action.turnId;
    /*
     * A Plan call the host drew is closed by the turn ending, the way the
     * ACP bridge closes its own: the protocol never closes this row, so
     * nothing else would. Closed here, before the ending is said, whoever
     * says it: the backend, or this host for a client's stop.
     */
    if (ending) ctx.completePlan(channel, String(action.turnId ?? ''));
    // A stopped turn is kept for its send's checks, for as long as the chat's state is held.
    if (action.type === 'chat/turnCancelled' && held?.kind === 'chat') {
      ctx.cancelledTurns.set(channel, (ctx.cancelledTurns.get(channel) ?? new Set<string>()).add(String(action.turnId ?? '')));
    }
    /*
     * A session's customizations are two halves, and one action carries both.
     *
     * What the backend reports is what the backend loaded; what the session's
     * clients handed it - the plugins this host copied for them - is the other
     * half, laid into the list where the session's backend projects it.
     * Nothing a backend says can take a client's plugin away: a plugin's `id`
     * is the client's own, so no id is in both halves.
     */
    if (action.type === 'session/customizationsChanged') {
      const reported = Array.isArray(action.customizations) ? action.customizations : [];
      /*
       * The backend is told which of them are off first, on the whole of what
       * it reported and before the client's half is laid on: what a client
       * handed this session is not the backend's to switch, and an id in that
       * half would be asked of a backend that has never heard of it.
       */
      ctx.tellOff(channel, reported);
      const halves = laid(channel, reported);
      if (halves.length > 0) action.customizations = halves;
      // Said only where the list moved, as VS Code's host says a session's
      // customizations.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L639-L646
      if (isDeepStrictEqual(action.customizations ?? [], ctx.stateOf(channel)?.customizations ?? [])) return;
    }
    /*
     * A session's `_meta` has several producers - its backend, the facts of
     * the folder it works in, its plugins, its origin and owner - and the
     * action replaces the map whole, so whoever says it moved says all of it:
     * the map `describes` composes, the one the session's state opened with.
     */
    if (action.type === 'session/metaChanged' && sessions.has(channel)) {
      const meta = ctx.describes(channel)._meta;
      if (meta === undefined) delete action._meta;
      else action._meta = meta;
    }
    ctx.stirred(channel, action);
    if (deltas.push(channel, action, origin)) {
      // A streamed delta is an action of the turn, which hands the chat's pending steering on.
      if (states.get(channel)?.kind === 'chat') ctx.observed(channel, action, origin);
      return;
    }
    emit(channel, action, origin, requestAudience(channel, action, origin));
    // A turn's error before its backend had it fails the creation of a
    // session still provisional, said after the error.
    if (action.type === 'chat/error' && states.get(channel)?.kind === 'chat') {
      const part = action.part as { error?: Record<string, unknown> } | undefined;
      ctx.failSessionCreationIfStillCreating(sessionFor(channel), part?.error ?? {});
    }
    // What the chat's state moved, said on its session: a streamed delta moves
    // nothing a session reads, which is why only this road says it, and an
    // action of another kind moves no chat state at all.
    if (states.get(channel)?.kind === 'chat' && String(action.type ?? '').startsWith('chat/')) {
      ctx.syncSessionInputNeeded(channel);
      ctx.onChatSummaryChanged(channel);
      // And whether the chat may be moved, which a turn is the whole of: said
      // at its start and at each of the endings a turn has, `chat/error`
      // among them, whoever said it.
      if (action.type === 'chat/turnStarted' || action.type === 'chat/turnComplete'
        || action.type === 'chat/turnCancelled' || action.type === 'chat/error') ctx.updateChatMovability(channel);
    }
    /*
     * A session's entry raised or taken down, told to the plugins as it is
     * said: the session is waiting on a person, or no longer is for that one.
     */
    if (action.type === 'session/inputNeededSet') {
      const request = (action.request ?? {}) as Record<string, unknown>;
      void ctx.fire({
        type: 'input_needed_set',
        session: channel,
        chat: String(request.chat ?? ''),
        id: String(request.id ?? ''),
        kind: request.kind as `${SessionInputRequestKind}`,
      });
    }
    else if (action.type === 'session/inputNeededRemoved') void ctx.fire({ type: 'input_needed_removed', session: channel, id: String(action.id ?? '') });
    /*
     * A turn that ends in an error it cannot be resumed from is kept for its
     * chat, and a read after a restart puts it back where the backend's
     * transcript holds no copy of it, as VS Code's host keeps one.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/persistedFailedTurns/persistedFailedTurnsContribution.ts#L40-L61
     */
    if (ending && action.type === 'chat/error' && bag(action.part).resumable !== true && !ctx.subagents.has(channel)) {
      ctx.recordFailedTurn(sessionFor(channel), channel, (states.get(channel)?.state.turns ?? []) as Bag[], String(action.turnId ?? ''));
    }
    // What the chat's queue drain does with it: a turn's end, or any other action of the chat.
    if (ending) ctx.turnEnded(channel, action);
    else if (states.get(channel)?.kind === 'chat') ctx.observed(channel, action, origin);
    /*
     * A terminal's title and claim are on the root's list of terminals too,
     * so the list is said again after every title and every claim, as the
     * reference host's terminal manager broadcasts its list at each.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L626-L641
     */
    if (action.type === 'terminal/titleChanged' || action.type === 'terminal/claimed') {
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
    }
    /*
     * The catalogue narrowed to the caller's own is a channel of its own.
     *
     * A client that asked for its own automations holds state under that URI,
     * and the plain catalogue's action is on a channel it is not watching. So
     * an action about one automation goes out again under the filtered name,
     * with a `visible` test that answers each subscriber for itself - at this
     * send and at every replay, the way an audience on a plugin channel does.
     *
     * A removal carries an id and no entry, and the store has already deleted
     * it by the time this runs, so its owner is not knowable here. It goes to
     * every filtered subscription: dropping it would leave an owner holding a
     * row nothing will now take away, while an id alone is not the record.
     */
    if (channel === AUTOMATIONS && (action.type === 'automation/set' || action.type === 'automation/removed')) {
      const entry = action.type === 'automation/set' ? bag(action.automation) : undefined;
      emit(AUTOMATIONS_ME, action, origin, {
        visible: (reader) => {
          const owner = ownerFilter('owner=me', reader);
          if (owner === undefined || owner === null) return false;
          return entry === undefined || automationOwner(entry) === owner;
        },
      });
    }
  };
  /**
   * The questions host tools are waiting on, ended by the person or by a turn.
   *
   * Built on the same `dispatch` every other host action goes through, so a
   * request this host asks reaches clients exactly as a backend's does.
   */
  const asks = createAsking({ dispatch: (channel, action) => dispatch(channel, action) });
  /**
   * Who hears a client's request about one automation, said back on the
   * catalogue narrowed to the caller's own.
   *
   * The request carries the definition or the patch, which is the owner's to
   * read, and every client watching `?owner=me` is watching a channel of that
   * name. So it goes to the client that sent it, and to the automation's owner
   * on any connection, and to no other owner. A request on the plain catalogue,
   * which every reader holds whole, goes to everyone.
   */
  const requestAudience = (channel: string, action: Record<string, unknown>, origin: Origin | undefined): PublishOptions | undefined => {
    if (channel !== AUTOMATIONS_ME) return undefined;
    if (action.type !== 'automation/createRequested' && action.type !== 'automation/updateRequested') return undefined;
    const held = options.automations?.get(String(action.resource ?? ''));
    const owner = held === undefined ? undefined : automationOwner(held);
    return {
      visible: (reader, client) => {
        if (origin !== undefined && client === origin.clientId) return true;
        const mine = ownerFilter('owner=me', reader);
        return mine !== undefined && mine !== null && owner !== undefined && mine === owner;
      },
    };
  };
  /**
   * A session's customizations as a client reads them: the backend's and its
   * clients', in the order the session's backend projects them, with nothing
   * said about a session that has no client plugins.
   *
   * The backend's half goes through `withEntries`, because the entries a
   * decision about every session or about a folder is read from are this
   * host's, and a customization the backend reported carries none of them.
   */
  const laid = (channel: string, reported: unknown): Bag[] => {
    const backend = (Array.isArray(reported) ? reported : []).map((one) => ctx.withEntries(channel, bag(one)));
    const clients = ctx.clientPluginsOf(channel);
    const agent = sessions.get(channel)?.agent ?? owners.get(channel);
    return agent?.sessionCustomizations?.(backend, clients) ?? [...backend, ...clients];
  };
  /**
   * Tell a plugin channel a client stopped watching it.
   *
   * Once the client watches no URI on the scheme on any connection, so a
   * client with two windows open on it has not left while one stays. A
   * `left` that throws is logged against its plugin.
   */
  const leftChannel = (client: string, channel: string): void => {
    const served = servedIn(options.channels, channel);
    if (served?.channel.left === undefined) return;
    for (const one of connections) {
      if (one.clientId === client && [...one.activeSubscriptions].some((uri) => servedIn(options.channels, uri) === served)) return;
    }
    try { served.channel.left(client); }
    catch (error) { log.error(`plugin ${served.by}: left on ${served.scheme} failed: ${reason(error)}`); }
  };
  /**
   * A client's action, refused.
   *
   * The other half of the write-ahead loop. A client applies an action before
   * sending it, so a host that decides not to apply one has to *say so*: an
   * envelope carrying `rejectionReason` is what tells the client to put its own
   * state back. The log line goes to the daemon's stdout, where no client is
   * looking.
   *
   * An action envelope like any other: it takes the next `serverSeq`, is held
   * for replay, and goes to every client subscribed to its channel, as the
   * specification sends an action and lists `rejectionReason` among its
   * fields, and as the reference host records and broadcasts a rejection. No
   * state takes it, here or in a client: a client holding the action pending
   * drops it, and the others hold nothing of it.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/lifecycle.md#L109
   * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/protocolServerHandler.ts#L766
   * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4183-L4210
   *
   * It reaches only who the accepted action would reach: a request on the
   * automations channel goes through `requestAudience`, as its echo does. A
   * refusal of a client the users gate has not passed takes the same road,
   * as the reference host records and broadcasts its rejection of a sender
   * it has not authenticated.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2806-L2808
   *
   * The client that sent it is told in every case, under the host's own
   * channel, since an invalid action is echoed back to the client that sent it
   * with its reason, whichever channels and versions it watches.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L162
   *
   * A dispatch said already is answered, and what failed of it after is this
   * host's to log.
   */
  const refuse = (
    peer: Peer,
    channel: string,
    action: Record<string, unknown>,
    origin: Origin | undefined,
    reason: string,
  ): void => {
    log.warn(`${channel}: ${reason}`);
    if (origin !== undefined && said.has(origin)) return;
    if (origin !== undefined) said.add(origin);
    deltas.flush();
    emit(channel, action, origin, requestAudience(channel, action, origin), { reason, by: peer });
    peer.notify('action', { channel, action, serverSeq: ctx.serverSeq, origin, rejectionReason: reason });
  };
  /**
   * Let a watch's watchers go once nobody has listened to them for VS Code's
   * grace.
   *
   * The protocol's rule, and it is a MUST: when every subscriber has
   * unsubscribed, or the connection drops, the watcher is released. Checked
   * against every connection rather than the one that just left, because two
   * clients may watch one channel and the second is still reading. The
   * release waits 30 s, which a subscribe inside it calls off, so a client
   * that drops for a moment finds its watch still running, as the reference
   * host holds a watcher through a grace after its last subscriber. A
   * reader's watcher goes once no connection of that reader watches the
   * channel, and the watch with the last of them.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L15978-L16001
   */
  const releaseWatch = (channel: string): void => {
    const held = watches.get(channel);
    if (held === undefined) return;
    const watchedBy = (reader: string): boolean => [...connections]
      .some((connection) => connection.activeSubscriptions.has(channel) && (connection.principal?.id ?? '') === reader);
    for (const [reader, one] of held.watchers) {
      if (one.grace !== undefined || watchedBy(reader)) continue;
      one.grace = setTimeout(() => {
        one.grace = undefined;
        if (held.watchers.get(reader) !== one || watchedBy(reader)) return;
        one.watcher.close();
        held.watchers.delete(reader);
        if (held.watchers.size === 0 && watches.get(channel) === held) watches.delete(channel);
        log.debug(`released ${channel}${reader === '' ? '' : ` for ${reader}`}`);
      }, RESOURCE_WATCH_GRACE_MS);
    }
  };
  /**
   * A watch's watcher, attached on its channel's first subscribe: the channel
   * names what to watch, so nothing is kept between the create and the
   * subscribe, and a subscribe inside a release's grace calls the release
   * off, as the reference host materialises a watcher on its first subscriber.
   * Answers the watch's state, or nothing for a name that is no watch and for
   * a watcher its store would not start, as the reference host answers a
   * watcher it could not attach.
   *
   * One watcher per reader among the subscribers, each handed that reader,
   * whose reports go to that reader's connections alone through the audience
   * a plugin channel's actions carry: a provider tells each reader only what
   * that reader may see, and two people's subscribes to one watch see each
   * their own.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L15921-L15976
   */
  const attachWatch = async (channel: string, principal?: Principal): Promise<Bag | undefined> => {
    const reader = principal?.id ?? '';
    const kept = watches.get(channel);
    const running = kept?.watchers.get(reader);
    if (kept !== undefined && running !== undefined) {
      clearTimeout(running.grace);
      running.grace = undefined;
      return kept.state;
    }
    const descriptor = parseResourceWatchChannelUri(channel);
    if (descriptor === undefined) return undefined;
    const scheme = schemeOf(descriptor.root);
    const store = scheme === '' || scheme === 'file' ? options.resources
      : scheme === AGENT_CLIENT_SCHEME ? ctx.clientResources : options.resourceProviders?.[scheme];
    const start = store?.watch;
    if (store === undefined || start === undefined) return undefined;
    const watcher = await start.call(store, descriptor.root, {
      recursive: descriptor.recursive,
      excludes: descriptor.excludes?.items ?? [],
      includes: descriptor.includes?.items ?? [],
    }, (changes) => {
      // Only while it runs: a batch can be in flight as the watch is let go.
      if (watches.get(channel)?.watchers.has(reader) !== true) return;
      emit(channel, { type: 'resourceWatch/changed', changes: { items: changes } }, undefined, {
        visible: (one) => (one?.id ?? '') === reader,
      });
    }, principal).catch((error: unknown) => {
      log.error(`could not watch ${descriptor.root} for ${channel}: ${reason(error)}`);
      return undefined;
    });
    if (watcher === undefined) return undefined;
    // Two subscribes that met: the one that came second keeps the first's.
    const held = watches.get(channel) ?? { state: { ...descriptor }, watchers: new Map() };
    const met = held.watchers.get(reader);
    if (met !== undefined) {
      watcher.close();
      clearTimeout(met.grace);
      met.grace = undefined;
      return held.state;
    }
    held.watchers.set(reader, { watcher });
    watches.set(channel, held);
    log.debug(`watching ${descriptor.root}${descriptor.recursive ? ' and under it' : ''} for ${channel}${reader === '' ? '' : ` as ${reader}`}`);
    return held.state;
  };
  /**
   * Let a channel a session's backend serves go once no connection here
   * watches it, so the host it lives on stops saying what moves on it here.
   * Checked against every connection, as a watch is.
   */
  const releaseRelayed = (channel: string): void => {
    const handle = ctx.relayedChannel(channel);
    if (handle === undefined) return;
    for (const connection of connections) {
      if (connection.activeSubscriptions.has(channel)) return;
    }
    handle.release();
  };

  /**
   * Let the state this host holds of a session go, its own and its chats'.
   *
   * A client that held one is replayed onto what it holds when it comes back,
   * as the reference host replays onto a session it evicted and restored: a
   * baseline is owed only for a channel this process never gave one for.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L692-L704
   */
  const letStateGo = (session: string): void => {
    for (const [one, open] of [...states]) {
      if (one !== session && (open.kind !== 'chat' || sessionFor(one) !== session)) continue;
      states.delete(one);
      ctx.cancelledTurns.delete(one);
      ctx.forgetChatQueue(one);
    }
  };

  /** Who this session currently has in it. Always a list, because the field is required. */
  const activeClientsOf = (uri: string): Bag[] => [...(presence.get(idOf(uri))?.values() ?? [])];

  /** The session a channel is, or the session that holds the chat it is. */
  const sessionOfChannel = (channel: string): string => (spaceOf(channel) === 'chat' ? sessionFor(channel) : channel);

  /**
   * Release a client from a session, if nothing else is holding it there, as
   * VS Code's host releases an active client: the tool calls it still owes
   * there failed, then its entry taken out.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1684-L1694
   *
   * The protocol names three ways this happens - unsubscribe, disconnect
   * without reconnecting, reconnect without resubscribing - and they are the
   * same condition seen from three places: no connection with that client id
   * is watching that session, or any chat it holds, any more, as the
   * reference host counts a subscription to any chat of a session as
   * presence in it. Checked rather than assumed, because one person can have
   * two windows open on one session and closing the first must not remove
   * them from it. `channel` is the session or one of its chats.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1895-L1913
   */
  const releaseActiveClientForSession = (channel: string, clientId: string): void => {
    const uri = sessionOfChannel(channel);
    for (const connection of connections) {
      if (connection.clientId === clientId && [...connection.activeSubscriptions].some((one) => sessionOfChannel(one) === uri)) return;
    }
    completeDisconnectedClientToolCalls(uri, clientId);
    const held = presence.get(idOf(uri));
    if (!held?.has(clientId)) return;
    // The entry held under this client's id, which is the id the entry carries.
    held.delete(clientId);
    if (held.size === 0) presence.delete(idOf(uri));
    dispatch(uri, { type: 'session/activeClientRemoved', clientId });
    // And the tools it was providing, which leave with it: a tool whose client
    // has gone is one every call to would fail.
    retool(uri);
  };

  /**
   * Every client tool call still pending in the running turns of a session's
   * chats, a worker's among them, with the client its contributor names: one
   * streaming, running or waiting on a confirmation, as VS Code's host reads
   * the calls a client still owes.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L187-L191
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1696-L1729
   */
  const pendingClientToolCalls = (uri: string): { chat: string; turnId: string; call: Bag; clientId: string }[] => {
    const chats = [...(sessions.get(uri)?.chats.keys() ?? []), ...[...subagents].filter(([, held]) => held.session === uri).map(([chat]) => chat)];
    return chats.flatMap((chat) => {
      const turn = ctx.stateOf(chat)?.activeTurn as Bag | null | undefined;
      const parts = Array.isArray(turn?.responseParts) ? turn.responseParts as Bag[] : [];
      return parts.flatMap((part) => {
        const call = part.kind === 'toolCall' ? part.toolCall as Bag | undefined : undefined;
        const contributor = call?.contributor as Bag | undefined;
        if (call === undefined || contributor?.kind !== 'client' || typeof contributor.clientId !== 'string') return [];
        if (call.status !== 'streaming' && call.status !== 'running' && call.status !== 'pending-confirmation') return [];
        return [{ chat, turnId: String(turn?.id ?? ''), call, clientId: contributor.clientId }];
      });
    });
  };

  /**
   * A client's calls still pending in a session, failed once it has gone, in
   * VS Code's words: a streaming call readied first, then completed as
   * failed, with the model told where another client still in the session
   * provides a tool of the same name. The backend holding each call is handed
   * the failure as it is handed a client's own answer, so the agent waiting
   * on it goes on; no backend ends a call of a client that left.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2085-L2115
   */
  const completeDisconnectedClientToolCalls = (uri: string, clientId: string): void => {
    const others = activeClientsOf(uri).filter((one) => one.clientId !== clientId);
    for (const { chat, turnId, call } of pendingClientToolCalls(uri).filter((one) => one.clientId === clientId)) {
      const toolCallId = String(call.toolCallId ?? '');
      const name = String(call.displayName ?? call.toolName ?? '');
      const retry = others.some((one) => Array.isArray(one.tools) && (one.tools as Bag[]).some((tool) => tool.name === call.toolName));
      if (call.status === 'streaming') {
        dispatch(chat, { type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: call.invocationMessage ?? name, confirmed: 'not-needed' });
      }
      const error = { message: `Client ${clientId} disconnected before completing ${name}` };
      const content = retry
        ? [{ type: 'text' as const, text: `The client that was running ${name} disconnected, but another active client now provides ${name}. You may try calling the tool again.` }]
        : [];
      dispatch(chat, {
        type: 'chat/toolCallComplete',
        turnId,
        toolCallId,
        result: { success: false, pastTenseMessage: `${name} failed`, ...(retry ? { content } : {}), error },
      });
      for (const one of sessions.get(uri)?.chats.values() ?? []) {
        if (one.completeToolCall?.(toolCallId, clientId, { ok: false, text: error.message, content }) === true) break;
      }
    }
  };

  /**
   * The places a client's closed connections left behind, by client and then
   * session.
   *
   * Keyed by what a returning connection comes back as rather than by the
   * connection, because that is the whole of what the wait is about: the client
   * is one client under one id, and a socket that drops and a socket that
   * arrives a moment later are the same client to every session it was in.
   */
  const graces = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

  /**
   * Every wait of one client is over, because the client is back: a
   * connection of it arrived or subscribed, as the reference host disposes
   * all of a client's disconnect timeouts when it connects again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1412-L1414
   */
  const waitsOver = (clientId: string): void => {
    for (const timer of graces.get(clientId)?.values() ?? []) clearTimeout(timer);
    graces.delete(clientId);
  };

  /**
   * A client's connection has closed: its place in the session the channel
   * is, or holds, and the tool calls it owes there, are kept for the daemon's
   * `clientToolCallDisconnectTimeoutMs`, as VS Code's host keeps a client
   * that is active in a session or owns a call pending there.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1637-L1660
   *
   * Nothing is kept for a client that holds neither there, which is every
   * session a connection watched without ever announcing itself in it -
   * `releaseActiveClientForSession` would take nothing out, so there is nothing to wait for.
   *
   * A later close starts the wait again rather than leaving the first one
   * running: what is being measured is how long this client has been gone, and
   * a second window closing is a client that is still here until it does.
   */
  const waitsOut = (channel: string, clientId: string): void => {
    const uri = sessionOfChannel(channel);
    if (!presence.get(idOf(uri))?.has(clientId) && !pendingClientToolCalls(uri).some((one) => one.clientId === clientId)) return;
    const waits = graces.get(clientId) ?? new Map<string, ReturnType<typeof setTimeout>>();
    graces.set(clientId, waits);
    clearTimeout(waits.get(uri));
    waits.set(uri, setTimeout(() => {
      waits.delete(uri);
      if (waits.size === 0 && graces.get(clientId) === waits) graces.delete(clientId);
      releaseActiveClientForSession(uri, clientId);
    }, options.clientToolCallDisconnectTimeoutMs ?? CLIENT_TOOL_CALL_DISCONNECT_TIMEOUT_MS));
  };

  /** Let every wait go, for a host that is closing and will remove nothing later. */
  const gracesOver = (): void => {
    for (const waits of graces.values()) for (const timer of waits.values()) clearTimeout(timer);
    graces.clear();
  };

  /**
   * One CLI at startup, to learn what the harness offers.
   *
   * Fire and forget: nothing waits for it, and until it answers the models
   * are empty - which is the same real answer this host gives for a harness
   * nobody has signed into.
   */
  /**
   * What GitHub said about each served directory's branch, under the
   * reference host's key and field names (`ISessionGitHubState`).
   *
   * Per directory, like the git facts, since a pull request is a branch's
   * and the branch is the directory's. Published under the directory's own
   * `file://` URI as the folder key, which `metaOf` names in
   * `_meta.workingDirectoryKeys` so a client looks the key up rather than
   * derives one that may not match. `pullRequestBranchName` says which
   * branch the URLs were found on, so a row on another branch does not draw
   * them; `pullRequestStateUrl` says which URL the state is of.
   */
  const githubFacts = new Map<string, Bag>();
  /** What the window's "collect logs" gets, and reads back. */
  const logs = debugLogs();
  /*
   * One object every area of the host reaches for, built once from the maps
   * and the helpers declared above it.
   */
  const ctx = {
    options, dir, known, lastSeen, baselineDebt, clearBaselineDebt, waitsOver, locales, clientNames, clientVersions, localeOf: (clientId: string) => locales.get(clientId),
    catalogsOf: (key: string, provider: string): readonly (Catalogs | undefined)[] => [
      options.sessionConfig !== undefined && Object.hasOwn(options.sessionConfig, key)
        ? options.catalogs?.sessionConfig?.[key]
        : options.catalogs?.agents?.[provider],
      HOST_CATALOGS,
    ],
    replayable, releaseActiveClientForSession, attachWatch, projectActionForClient, claims, agents, first: options.agents[0], connections, clientsChanged, relays: new Map(), holders, sessions, byChat, subagents, owners, names,
    leadOf, wheres, worktrees, worktreeOf, githubFacts, kept, offered, decided, about, terminals,
    madeFrom, origins, births, moves, listedMeta, browsable, broadcast, presence, beside, marks, lives, lifeOf, restarting, relaunches: new Map(), chatRelaunches: new Map(), baselineCheckpoints: new Map(), resumedTurns: new Map(), cancelledTurns: new Map(), learned, starting,
    logs, detached, refuse,
    serverSeq: 0,
    closed: false, shutdown: () => host.close(), refusing: undefined, bareSessions: new Set<string>(), startedWorkspaceless: new Set<string>(), commandTurns: new Set<string>(), described, links,
    watches, marksOf, restoredSessions, activeClientsOf, markAnnotation,
    restartNeeded: false,
    markRestart: () => {
      if (ctx.restartNeeded) return;
      ctx.restartNeeded = true;
      dispatch(ROOT, { type: 'root/configChanged', config: { [RESTART_KEY]: true } });
      broadcast(ROOT, RESTART_NEEDED, { channel: ROOT });
    },
    dispatch,
    answered: (origin: Origin) => said.has(origin),
    flushDeltas: deltas.flush,
    stateOf: (channel: string) => states.get(channel)?.state,
    openState: (channel: string, kind: HeldState['kind'], seed: Bag): Bag => {
      const open = states.get(channel);
      if (open !== undefined) return open.state;
      const state = options.opening?.(channel, kind) ?? seed;
      states.set(channel, { kind, state });
      return state;
    },
    closeState: (channel: string) => {
      states.delete(channel);
      ctx.cancelledTurns.delete(channel);
      ctx.forgetChatQueue(channel);
    },
    heldStates: states as ReadonlyMap<string, HeldState>,
    asks,
    letStateGo,
  } as HostContext;
  // Before any area is built, because everything a person or a backend does
  // goes out through `emit`, which folds into this stream on the way.
  ctx.sessionEvents = createSessionEvents(ctx);
  Object.assign(ctx, createTelemetry(ctx));
  // The content a backend hands this host to keep, in each session's own
  // folder, up to the bound this host was given.
  ctx.toolResults = toolResultResources(
    (session) => kept.attachmentsDir?.(idOf(session)),
    () => options.toolResultResourceLimitBytes ?? TOOL_RESULT_RESOURCE_LIMIT,
  );
  // Under its own name rather than spread flat, because `open`, `close` and
  // `update` are words other areas could reach for.
  ctx.canvases = createCanvases({
    dispatch: (channel, action) => dispatch(channel, action),
    holds: (chat) => byChat.has(chat),
    /*
     * The session that holds the chat, woken where it sleeps, and a chat it
     * does not hold refused in the reference host's words.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6637-L6648
     */
    restore: async (chat) => {
      if (byChat.has(chat)) return;
      const session = ctx.sessionFor(chat);
      if (session !== chat) await ctx.wake(session, chat);
      if (!byChat.has(chat)) throw new Error(`Canvas operation targeted a chat outside session '${session}'.`);
    },
    relays: (chat) => byChat.get(chat)?.chat.channel !== undefined,
    // Read at each call, because a window may push the key while the daemon
    // runs, and a canvas that is already open stays open when it turns off.
    enabled: () => ctx.rootConfig.canvasesEnabled === true,
  });
  Object.assign(ctx, createAuth(ctx));
  // Before the routing, because which session a chat URI names is read there.
  Object.assign(ctx, createChatRecord(ctx));
  Object.assign(ctx, createRouting(ctx));
  Object.assign(ctx, createRelay(ctx));
  Object.assign(ctx, createChangesets(ctx));
  Object.assign(ctx, createFacts(ctx));
  // Under its own name, because `config`, `meta` and `publish` are words other
  // areas could reach for.
  ctx.sandbox = createSandbox(ctx);
  Object.assign(ctx, createOwners(ctx));
  Object.assign(ctx, createMachines(ctx));
  Object.assign(ctx, createSessionConfig(ctx));
  Object.assign(ctx, createRoot(ctx));
  Object.assign(ctx, createCatalogue(ctx));
  Object.assign(ctx, createSpawn(ctx));
  // Under its own name rather than spread flat, because `heldTasks`, `rows`
  // and `forgetSession` are words other areas could reach for.
  ctx.background = createBackground(ctx);
  Object.assign(ctx, createLifecycle(ctx));
  Object.assign(ctx, createTooling(ctx));
  Object.assign(ctx, createTerminals(ctx));
  // Under its own name rather than spread flat, because `of` and `forgetSession`
  // are words other areas could reach for.
  ctx.shells = createShells(ctx);
  Object.assign(ctx, createOutputs(ctx));
  Object.assign(ctx, createLocalTurns(ctx));
  Object.assign(ctx, createAutomations(ctx));
  Object.assign(ctx, createHistory(ctx));
  Object.assign(ctx, createSnapshots(ctx));
  Object.assign(ctx, createSleep(ctx));
  Object.assign(ctx, createSessionLifecycle(ctx));
  Object.assign(ctx, createWakes(ctx));
  Object.assign(ctx, createQueueDrain(ctx));
  /*
   * Every subscription passes here - the command, and the two handshakes that
   * subscribe on their way in - so this is where a client that comes back is
   * seen to have come back. The wait a dropped connection began is over: the
   * client never left, and nothing is on its way to saying it did.
   */
  const backendSnapshot = ctx.snapshotOf;
  ctx.snapshotOf = async (
    channel: string,
    connection?: Connection,
    view?: SubscribeView,
  ): Promise<Record<string, unknown> | undefined> => {
    if (connection !== undefined) waitsOver(connection.clientId);
    return backendSnapshot(channel, connection, view);
  };
  /*
   * A session's customizations as its state opens with them: the backend's,
   * with this host's entries on them, then its clients' plugins - the two
   * halves `dispatch` lays on every `session/customizationsChanged`. Nothing
   * reported and nothing handed over is no `customizations` at all.
   */
  ctx.laidCustomizations = (channel: string, reported: unknown): Bag[] | undefined => {
    const halves = laid(channel, reported);
    return halves.length === 0 ? undefined : halves;
  };
  const {
    spaceHere, nameOf, sessionOfChat, sessionFor, meantBy,
    sessionHolding, channelKind, sessionChannel, homeOf,
    projectSnapshot, visible, sessionVisible, chatShown, claimable, unheld, ownId, clients, clientResources, heard, clientGone,
    dirOf, catalogueOf, changesetAt, changesetOf, operationsOf, operationsMoved, contentMoved,
    changesetsOf, operationContext, opKey, shown,
    describes, setArtifacts, captureBaseline, recordPullRequest, metaChanged, dirOfFile, wroteThrough,
    refreshWatched, startWatchingDir, stopUnwatched, refreshPullRequests, readFacts, refreshFacts,
    LOGS, TRACES, METRICS, log, fire, telemetered,
    authenticationResource, resourcesOf, agentsFor, getAuthToken, advertised, metadataFor, authRequiredChannel,
    charged, ownerFor, principals, principalFor, forWhom, senderOf,
    charge, checked, scoping, resolveCreatedSessionConfig,
    sessionMachines, enteredIn, inMachine, bringBackOf, followOf, leaveForgotten, machineFor, admitted, placedIn,
    isolating, mergedConfig, propertyOf, sessionSchema, runningSchema, seeded,
    contributedDefaults, storedConfig,
    rootConfig, descriptors, daemonSchema, daemonProperties, daemonHeld,
    advertisedSchemes, advertisedChannels, advertisedMethods,
    statusOf, getChatOrigin, chatSummary, subagentSummary, restoredSubagentSummary,
    activityOf, sessionAdded, markSummaryDirty, activeSessionsChanged, setAgentModels, publishAccountInfo,
    listing, unavailableProvider, readStored,
    unstamped, withWorkerUri, stampedCalls, withSender,
    sendSubagent, endedWorkers, openSubagent,
    legacyChatUri, titleOf, persistChatTitle, recordSessionProvider, spawn,
    removeSession, restart, relaunchChat, backendsOwn, isolated,
    beginOrRun, beginTurn, modelIn, messageFrom, messageAttachments, createProviderSession,
    permitted, toolDefinitions, retool, renameChat,
    terminalInfo, heldTerminals, changed, due, startForAutomation,
    history, subHistory, titles, refresh,
    snapshotOf, value,
  } = ctx;
  /*
   * Everything known about every directory served, before anything asks.
   *
   * A catalogue is drawn from a snapshot, and one taken before this had
   * answered would draw every row without its facts and only fill them in
   * when something else happened to move the row.
   */
  for (const dir_ of browsable()) {
    void (options.directories?.refresh?.(dir_) ?? Promise.resolve(false))
      .then(() => refreshPullRequests(dir_))
      .catch(() => {});
    void options.changes?.refresh?.(dir_).catch(() => {});
  }

  options.automations?.onChanged?.(changed);

  /**
   * Ask one backend what it offers, and tell the root when the answer lands.
   *
   * Fire and forget, at the start and again for a backend a live fold brought:
   * nothing waits for it, and until it answers the models are empty - which is
   * the same real answer this host gives for a harness nobody has signed into.
   */
  /**
   * The backends with a probe running, each with whether another was asked
   * for meanwhile. A probe starts the backend's CLI, so they run one at a
   * time: a probe asked during one is one more probe after it, of whichever
   * object the provider has then.
   */
  const probing = new Map<string, boolean>();
  /** The stop of each backend's `probeChanged`, by provider. */
  const probeWatches = new Map<string, () => void>();
  /**
   * Hear when a backend's answer may have changed, once, after its first one.
   *
   * By provider and not by object: a fold that hands a provider a new object
   * keeps the watch, and the watch probes whichever object the provider has.
   */
  const watchProbe = (agent: Agent): void => {
    if (agent.probeChanged === undefined || probeWatches.has(agent.provider) || ctx.closed) return;
    const provider = agent.provider;
    try {
      probeWatches.set(provider, agent.probeChanged(() => {
        const now = agents.get(provider);
        if (now !== undefined && !ctx.closed) probeAgent(now);
      }));
    }
    catch (error) { log.warn(`${provider}: no watch of what it offers: ${reason(error)}`); }
  };
  /** Stop the watch of each backend no longer in `agents`, or of every one. */
  const unwatchProbes = (all: boolean): void => {
    for (const [provider, stop] of probeWatches) {
      if (!all && agents.has(provider)) continue;
      probeWatches.delete(provider);
      try { stop(); }
      catch { /* already stopped */ }
    }
  };
  const probeAgent = (agent: Agent): void => {
    if (!agent.probe)
      return;
    if (probing.has(agent.provider)) {
      probing.set(agent.provider, true);
      return;
    }
    probing.set(agent.provider, false);
    void agent.probe().then((offered) => {
      const held = about(agent.provider);
      held.commands = offered.commands;
      held.customizations = offered.customizations;
      /*
       * An empty model list is kept out, and says nothing about the rest.
       *
       * A harness nobody has signed into enumerates no models and still has
       * skills and MCP servers, so the guard is on the assignment and not on
       * the announcement - the root channel has to hear about the
       * customizations either way, or the only client that ever sees them is
       * one that connected after the probe answered.
       */
      if (offered.models.length > 0) held.models = offered.models;
      /*
       * The account, where the probe had one, which is the only moment this
       * backend's CLI is asked anything before a session starts. A later answer
       * replaces it through the same call, so the probe's value is not kept
       * anywhere else and nothing has to tell the two apart.
       */
      if (offered.account !== undefined) publishAccountInfo(agent.provider, offered.account);
      log.debug(`${agent.provider}: ${held.models.length} model(s), ${held.commands.length} command(s), ${held.customizations.length} customization(s)`);
      ctx.publishAgentInfos();
      watchProbe(agent);
    }).catch(() => { }).finally(() => {
      const again = probing.get(agent.provider) === true;
      probing.delete(agent.provider);
      const now = agents.get(agent.provider);
      if (again && now !== undefined && !ctx.closed) probeAgent(now);
    });
  };

  for (const agent of agents.values()) probeAgent(agent);
  /**
   * Start one chat, and the session holding it if there is not one yet.
   *
   * One backend session is one CLI, and a chat is one conversation, so a
   * second chat in a session is a second CLI on the same directory and the
   * same config - which is what makes them peers rather than one being the
   * other's child.
   */

  // Once `createHost` has returned, so neither it nor a first request waits on it.
  setTimeout(() => { void readStored(); }, 0);

  ctx.startSleep();
  ctx.startWakes();
  ctx.startSessionLifecycle();

  options.automations?.onDue?.(due);

  /*
   * Each plugin channel's way to send and to see who is watching, set on the
   * entry its handle closes over.
   *
   * A publish is emitted rather than dispatched: it is the plugin's own
   * state, so it is no delta to merge and carries no client's origin, even
   * when the plugin publishes from inside a client's command.
   *
   * Called again by `replace`, because a channel a live fold brings is an
   * entry nobody has set these on yet, and the plugin's handle is handed out
   * with them already there.
   */
  const wireChannels = (): void => {
    for (const served of Object.values(options.channels ?? {})) {
      served.publish = (uri, action, audience) => {
        emit(uri, structuredClone(action), undefined, audience.visible === undefined && audience.to === undefined ? undefined : audience);
      };
      served.subscribers = (uri) => {
        // One entry per client id and person: people sharing a client id are each listed.
        const seen = new Map<string, ChannelSubscriber>();
        for (const connection of connections) {
          if (!connection.activeSubscriptions.has(uri)) continue;
          const key = JSON.stringify([connection.clientId, connection.principal === undefined ? '' : ownerOfPrincipal(connection.principal)]);
          if (!seen.has(key)) seen.set(key, { client: connection.clientId, reader: connection.principal });
        }
        return [...seen.values()];
      };
      served.localeOf = (client) => locales.get(client);
    }
  };
  wireChannels();

  /*
   * Every other function this host sets on a plugin's own entry: a trigger's
   * `deliver` and `run`, a start's `start`, `startChat` and `opens`, a session
   * key's `changed`, a plan's `changed`, and the `open`, `update` and `close`
   * a plugin's canvases are reached through.
   *
   * Each of those was set once, as the entry was built, which is enough for a
   * host that never changed. A live fold brings entries nobody has set them on,
   * and a plugin enabled while the daemon runs fires, starts and announces
   * through them from the moment its `apply` returns - so they are set here,
   * beside `wireChannels`, and again by `replace`.
   */
  const wirePlugins = (): void => {
    ctx.wireTriggerTypes();
    ctx.wirePluginStarts();
    ctx.wireSessionMeta();
    ctx.wirePlan();
    ctx.wireCanvases();
  };
  wirePlugins();

  /*
   * The users directory, watched while a plugin listens for its change or the
   * host is told whose agents are.
   *
   * A change to the directory is a change to who may use what: a person who
   * joined a team, or left one, may use a different set of agents from that
   * moment. The agent list is sent again, and `projectActionForClient` filters it for each
   * connection, so a membership change reaches the callers it alters.
   *
   * Whether a plugin listens for it is what a live fold can change, so the
   * condition is asked again by `replace` rather than read once here.
   */
  const listeningForUsers = (): boolean => (options.events?.users_changed?.length ?? 0) > 0;
  const watchingUsers = (): boolean => listeningForUsers() || options.agentOwners !== undefined;
  const openUsersWatch = (): { close(): void } | undefined => watchingUsers()
    ? options.users?.watch?.(() => {
      if (listeningForUsers()) void fire({ type: 'users_changed' });
      // Said whatever the list holds: what each connection is shown of it
      // follows its person's grants, which the directory has just moved.
      dispatch(ROOT, { type: 'root/agentsChanged', agents: descriptors() });
    })
    : undefined;
  let usersWatch = openUsersWatch();

  /** Whether a session still runs on one backend, by the id it was served under. */
  const runningOn = (provider: string): boolean => {
    for (const held of sessions.values()) {
      if (held.agent.provider === provider) return true;
      for (const backend of held.backends.values()) if (backend.agent.provider === provider) return true;
    }
    return false;
  };

  /**
   * Why a fold cannot be taken live, or nothing.
   *
   * A store the host was built over is one every area reads and writes
   * through, and a scheme names URIs a client has already been handed, so a
   * fold that brings or moves either is a host rebuilt at its next start
   * rather than swapped under the sessions using it.
   */
  const portMoved = (folded: HostOptions): string | undefined => {
    const before = options as unknown as Record<string, unknown>;
    const after = folded as unknown as Record<string, unknown>;
    for (const key of PORTS) {
      if (before[key] !== after[key]) return `${key} is a port the host was built over; restart the daemon to load the change.`;
    }
    const was = options.resourceProviders ?? {};
    const is = folded.resourceProviders ?? {};
    const schemes = [...new Set([...Object.keys(was), ...Object.keys(is)])]
      .filter((scheme) => (was as Record<string, unknown>)[scheme] !== (is as Record<string, unknown>)[scheme]);
    if (schemes.length > 0)
      return `The change moves the resource scheme ${schemes.join(', ')}; restart the daemon to load it.`;
    return undefined;
  };

  /**
   * One open connection, as the client registry lists it.
   *
   * Read at each call rather than kept: a row exists while its socket does,
   * and the connection is where each field is as it stands now, so a client
   * that signed in or subscribed after it arrived is shown that way.
   */
  const clientRow = (connection: Connection): ConnectedClient => ({
    ...(connection.socket === undefined ? {} : { socket: connection.socket }),
    clientId: connection.clientId,
    ...(clientNames.get(connection.clientId) === undefined ? {} : { name: clientNames.get(connection.clientId) as string }),
    ...(connection.address === undefined ? {} : { address: connection.address }),
    ...(connection.forwardedFor === undefined ? {} : { forwardedFor: connection.forwardedFor }),
    ...(connection.protocolVersion === undefined ? {} : { protocolVersion: connection.protocolVersion }),
    ...(connection.locale === undefined ? {} : { locale: connection.locale }),
    ...(connection.principal === undefined ? {} : { principal: connection.principal }),
    subscriptions: [...connection.activeSubscriptions],
    connectedAt: connection.connectedAt,
  });

  const host: Host = {
    clients,
    /*
     * In arrival order, which is the order the set iterates in.
     *
     * A drop closes the peer and returns at once; the connection leaves the
     * set when the listener reports the socket it closed, which is where the
     * departure is said.
     */
    clientRegistry: {
      connected: () => [...connections].map(clientRow),
      watch: (onChange) => {
        clientWatchers.add(onChange);
        return { close: () => { clientWatchers.delete(onChange); } };
      },
      drop: (socket) => {
        const connection = [...connections].find((one) => one.socket === socket);
        if (connection === undefined) return false;
        connection.peer.close();
        return true;
      },
    },
    /*
     * Replaced whole, and every running session told.
     *
     * `session/serverToolsChanged` has full-replacement semantics, so the
     * action carries the new set rather than the difference. A session
     * already running keeps offering the old set to its model until its
     * process starts again - the tools are handed over at startup - and what
     * moves immediately is what a client is told the session has.
     */
    setTools: (tools) => {
      ctx.contributed = tools;
      // The adapters' action tools are not part of what a client sets, so they
      // stay offered whatever the new set says.
      ctx.contributing = permitted([...ctx.contributed, ...ctx.actionTools]);
      for (const uri of sessions.keys()) ctx.serverToolsMoved(uri);
    },
    /*
     * Built per caller and not kept: the principal cuts the list and is the
     * person each tool acts for, so two callers asking at once get two lists.
     */
    sessionlessTools: (caller) => ctx.sessionlessTools(caller),
    replace: (folded) => {
      /*
       * A port or a scheme the host was built over is not swapable while
       * sessions use it: a store is one the host reads and writes through, and
       * a scheme names URIs a client has already been handed. A fold that moves
       * either is refused whole, and the host keeps the options it has.
       */
      const moved = portMoved(folded);
      if (moved !== undefined) return moved;
      const clash = agentsProblem(folded.agents);
      if (clash !== undefined) return clash;
      /*
       * The map is changed in place, because `createRoot` holds this one and an
       * agent list rebuilt as a new map would leave it listing the old one.
       *
       * An agent the fold dropped but that still has an open session is kept:
       * a session running on nothing can neither turn nor be disposed of. It is
       * the caller's to end those first - `endSessionsOf` is what does it - and
       * a fold that comes back once they have ends with the agent gone.
       */
      const next = new Map<string, Agent>();
      for (const agent of folded.agents) next.set(agent.provider, agent);
      for (const [provider, agent] of agents) {
        if (!next.has(provider) && runningOn(provider)) next.set(provider, agent);
      }
      const fresh = [...next.keys()].filter((provider) => !agents.has(provider));
      agents.clear();
      for (const [provider, agent] of next) agents.set(provider, agent);
      /*
       * Every other field is the new fold's, taken on the object the host was
       * built over rather than beside it: an area that destructured `options`
       * once still reads the same object, and its getters stay getters. A key
       * the fold no longer has is removed, or a plugin's answer would outlive
       * it.
       */
      const held = options as unknown as Record<string, unknown>;
      const taking = folded as unknown as Record<string, unknown>;
      for (const key of Object.keys(held)) if (!Object.hasOwn(taking, key)) delete held[key];
      Object.defineProperties(held, Object.getOwnPropertyDescriptors(taking));
      ctx.first = options.agents[0] ?? (next.values().next().value as Agent | undefined);
      ctx.contributed = options.tools ?? [];
      ctx.contributing = permitted([...ctx.contributed, ...ctx.actionTools]);
      wireChannels();
      wirePlugins();
      if (watchingUsers() && usersWatch === undefined) usersWatch = openUsersWatch();
      else if (!watchingUsers() && usersWatch !== undefined) { usersWatch.close(); usersWatch = undefined; }
      unwatchProbes(false);
      for (const provider of fresh) {
        const agent = agents.get(provider);
        if (agent !== undefined) probeAgent(agent);
      }
      /*
       * Every open session told and retooled: the action is what its clients
       * read as the set it has, and the retool is what its chat is handed, so a
       * tool the fold added or removed is in place for the next turn.
       */
      for (const uri of sessions.keys()) {
        ctx.serverToolsMoved(uri);
        retool(uri);
      }
      // One event, so a client reading the root lists the agents it holds now.
      ctx.publishAgentInfos();
      return undefined;
    },
    endSessionsOf: async (agent) => {
      const provider = typeof agent === 'string' ? agent : agent.provider;
      for (const uri of [...sessions.keys()]) {
        const held = sessions.get(uri);
        if (held === undefined) continue;
        const onIt = held.agent.provider === provider
          || [...held.backends.values()].some((backend) => backend.agent.provider === provider);
        if (!onIt) continue;
        // Removed the way a disposal removes one, and one that could not be is
        // logged: the plugin is going either way, and a session left behind is
        // worse said than silently kept.
        try { await removeSession(uri); }
        catch (error) { log.error(`ending ${uri} for ${provider} failed: ${reason(error)}`); }
      }
    },
    connections: () => connections.size,
    localeOf: ctx.localeOf,
    close: () => {
      closing ??= (async () => {
        // The window closes with the host: what it holds goes out now, and the
        // last actions the sessions below emit go out as they are dispatched.
        // A delta still waiting on the timer would otherwise be broadcast by a
        // timer that outlives the host it belongs to.
        deltas.stop();
        // And the rows that moved, said before the sessions below go, as the
        // reference host flushes its pending summaries before it settles.
        ctx.flushPendingSessionSummaries();
        ctx.stopSleep();
        ctx.stopWakes();
        ctx.disposeSessionLifecycle();
        ctx.closed = true;
        ctx.stopLapses();
        unwatchProbes(true);
        /*
         * And no wait outlives the host it was begun in. What a client that
         * dropped would have been removed by thirty seconds from now is the
         * closing host's business instead: the sessions below are being taken
         * down whole, and a timer firing into that would dispatch a removal
         * for a session nobody is left to hear about.
         */
        gracesOver();
        /** One step of the close, logged rather than thrown, so a failed one does not skip the rest. */
        const step = async (what: string, run: () => unknown): Promise<void> => {
          try { await run(); }
          catch (error) { log.error(`closing ${what} failed: ${reason(error)}`); }
        };
        const going: Promise<void>[] = [];
        // Stopped rather than disposed: a daemon going down is a host that
        // comes back, and it resumes these sessions from the store. A backend
        // running nested in a machine is told to end its transport alone, so
        // the session inside is still there for the next daemon to resume.
        for (const held of sessions.values()) {
          for (const [uri, chat] of held.chats) going.push(step(uri, () => chat.close('stopping')));
        }
        // A run already past its guard ends here, refused at `spawn` or started
        // and so among the sessions; its outcome is the run's to report.
        for (const run of starting) going.push(run.then(() => undefined, () => undefined));
        // And the agents of sessions put to sleep, whose closes are still going,
        // and the resumes still going, which start no agent once the host is closed.
        going.push(step('the sleeping sessions', () => ctx.slept()));
        for (const [uri, terminal] of terminals) {
          going.push(step(uri, async () => {
            terminal.close();
            await terminal.waitForExit();
          }));
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.all(going),
          new Promise((done) => { timer = setTimeout(done, HOST_CLOSE_WAIT_MS); }),
        ]);
        clearTimeout(timer);
        /*
         * Every machine enter and leave this host started, finished.
         *
         * A session's leaving is not held up by the port, so the calls that
         * read a machine out land after the session has gone. They are waited
         * for before the plugins stop: a plugin's own close takes its machines
         * apart, and a machine still being read is one nothing should remove.
         */
        await step('the machine leaves', () => ctx.settled());
        /*
         * Every plugin's own close, before the stores it may write through.
         *
         * A session has left its machine by now, so this is the point where a
         * plugin stops what it owns: a timer it armed, a removal it started, a
         * process it spawned. Each runs as a step, so one that fails is logged
         * against its plugin and the next one still runs.
         */
        for (const { by, close } of options.closers ?? []) {
          await step(`the plugin ${by}`, close);
        }
        await step('the users watch', () => usersWatch?.close());
        /*
         * And what reads what sessions do, before the stores it reads.
         *
         * A rule wakes a run, and a run writes to a store - so a wake that
         * arrived with the stores half closed would be a run begun in a daemon
         * that is going away. Stopping the subscriptions first is what makes the
         * closes below the last thing anything hears.
         */
        await step('the automation rules', () => ctx.stop());
        await step('the automation store', () => options.automations?.close?.());
        await step('the session store', () => kept.close?.());
        // The file listings still running, as VS Code's host kills its ripgrep
        // children when it is disposed.
        await step('the workspace files', () => options.workspaceFiles?.close?.());
        /*
         * And every git still running, last, since the steps above can start
         * one: a session's close writes its checkpoint and refreshes its
         * counts. Each runs in a session's folder, which Windows will not
         * remove while it does. Bounded as the sessions are; a git still
         * running then is left to its own timeout.
         */
        let gits: ReturnType<typeof setTimeout> | undefined;
        await step('the git it started', () => Promise.race([
          gitSettled(),
          new Promise((done) => { gits = setTimeout(done, HOST_CLOSE_WAIT_MS); }),
        ]));
        clearTimeout(gits);
      })();
      return closing;
    },
    turning: () => [...sessions.keys()]
      .filter((uri) => (statusOf(uri) & (Status.InProgress | Status.InputNeeded)) !== 0),
    /*
     * And the hold an embedder about to go puts on new ones.
     *
     * Held as the embedder's own words rather than as a flag, because this
     * host has no idea why it is being taken down - a restart under it, a
     * handover to another process - and the client that asked for a turn is
     * owed that reason rather than a silence.
     */
    refuseTurns: (why) => { ctx.refusing = why; },
    /*
     * The root's config says the mark from here on, through the host's own
     * `root/configChanged`, and a connection watching the root is also told
     * by `x-ahpd/restartNeeded`.
     */
    markRestartNeeded: () => { ctx.markRestart(); },
    daemonValuesChanged: () => ctx.daemonValuesChanged(),
    accept(peer: Peer, principal?: Principal, root?: boolean, opened?: Opened) {
      const connection: Connection = {
        peer, clientId: '', activeSubscriptions: new Set<string>(),
        tokens: new Map<string, Credential>(),
        connectedAt: Date.now(),
        // Where the socket came from, when the listener that opened it said.
        ...(opened?.socket === undefined ? {} : { socket: opened.socket }),
        ...(opened?.address === undefined ? {} : { address: opened.address }),
        ...(opened?.forwardedFor === undefined ? {} : { forwardedFor: opened.forwardedFor }),
        /*
         * A socket that arrived on a personal connection token is already
         * somebody, so the gate reads this before the first command rather
         * than waiting for an `authenticate` the client may never send.
         *
         * Frozen here as well as where it was built, because this is the last
         * place this host sees it before a provider, a hook or a scheme's own
         * methods are handed it - and an embedder that built its own answered
         * for nothing beyond this process. `heldPrincipal` is that freeze, and
         * it takes the roles with it.
         */
        ...(principal === undefined ? {} : { principal: heldPrincipal(principal) }),
        // And one admitted on the deployment's own token is the host itself.
        ...(root === true ? { root: true } : {}),
      };
      /*
       * What this host will hold for this client, bound here because this is
       * the first place a host has the peer.
       *
       * The listener that built the peer knows nothing of root config, and the
       * limit is a key of this host's own, so a reader is passed in rather than
       * a number: a value pushed while the host runs applies to the next send.
       * The line is named for the connection, which the peer itself cannot do.
       */
      peer.bounded?.({
        limit: () => clientQueueBytes(ctx.rootConfig),
        log: (line, level) => { ctx.log(`${connection.clientId || 'a client'}: ${line}`, level); },
      });
      /*
       * A person or a plugin this host was given rather than one that signed in.
       *
       * `principals` is how an owner is resolved to the memberships behind the
       * name, and it is filled from `authenticate`. A socket handed a principal
       * never sends one, so without this a session it owns has no principal and
       * every check against it is skipped - the work runs unchecked rather than
       * refused, which is the worse of the two answers. The key is the owner
       * `ownerFor` answers, which is what makes it the one a later read of that
       * owner finds.
       */
      if (principal !== undefined) principals.set(ownerOfPrincipal(principal), principal);
      connections.add(connection);

      const conn = { connection, alive: true, containers: new Map(), subscriptions: new Map() } as ConnectionContext;
      // Held beside `connections`, and for the same span: `stop` and `remove`
      // ask across every live connection's relays, and a map there is the one
      // this connection's own methods write.
      ctx.relays.set(connection, conn.containers);
      const { storeFor, methods } = createResourceMethods(ctx, conn);
      conn.storeFor = storeFor;
      const { admit } = createAdmission(ctx, conn);
      conn.admit = admit;
      const handshake = createHandshake(ctx, conn);
      const sessionMethods = createSessionMethods(ctx, conn);
      const terminalMethods = createTerminalMethods(ctx, conn);
      const automationMethods = createAutomationMethods(ctx);
      const vscode = createVscodeMethods(ctx, conn);
      const { applyDispatch } = createActions(ctx, conn);

      const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
        ...handshake,
        ...methods,
        ...sessionMethods,
        ...terminalMethods,
        ...automationMethods,
        ...vscode,
      };
      /** The id this connection's dispatches wait under, with every other connection of its client. */
      const queuedAs = (): string => connection.clientId;
      /**
       * A dispatch whose apply failed, logged and refused to the client that
       * sent it.
       *
       * One that failed at once and one that failed after waiting are told the
       * same way: the client holds its action until it hears an echo or a
       * refusal, and the error's own words are the reason it is given, as the
       * reference host rejects a queued dispatch that fails.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12639-L12641
       */
      const refuseFailed = (params: Record<string, unknown>, origin: Origin, error: unknown): void => {
        const reason = error instanceof Error ? error.message : String(error);
        log.error(`a dispatch from ${connection.clientId || 'anonymous'} failed: ${reason}`);
        const action = (typeof params.action === 'object' && params.action !== null ? params.action : {}) as Record<string, unknown>;
        refuse(connection.peer, meantBy(String(params.channel ?? '')), action, origin, reason);
      };
      /**
       * The client's queue, extended by one step for the dispatch in `params`.
       *
       * A step runs whatever became of the connection that sent it, as the
       * reference host runs a client's queued dispatch: its answer goes to
       * every client of its channel, and a client that comes back reads it in
       * its replay. A step that fails is refused to the client, as any other
       * action this host will not apply.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12507-L12649
       */
      conn.applyNow = applyDispatch;
      const behind = (params: Record<string, unknown>, origin: Origin, step: () => Promise<void> | undefined): void => {
        const client = queuedAs();
        const next = (dispatchQueues.get(client) ?? Promise.resolve()).then(step).catch((error: unknown) => {
          refuseFailed(params, origin, error);
        });
        dispatchQueues.set(client, next);
        void next.then(() => { if (dispatchQueues.get(client) === next) dispatchQueues.delete(client); });
      };
      /** Notifications: no id, no answer, and that is the whole difference. */
      const notifications: Record<string, (params: Record<string, unknown>) => void> = {
        unsubscribe: (params) => {
          // This connection stops watching. Not the channel - doing that to
          // shed one consumer kills the stream the others are reading. Under
          // whatever spelling, the channel it watches is the host's own.
          const channel = meantBy(String(params.channel ?? ''));
          connection.activeSubscriptions.delete(channel);
          // A subscribe of it still being answered loses its place with it.
          conn.subscriptions.delete(channel);
          // A channel it has let go of owes it nothing; a later subscribe
          // is answered with its own baseline.
          ctx.clearBaselineDebt(connection.clientId, channel);
          // A changeset nobody watches any more is a directory with no reason
          // for a git watch, so the last unsubscribe is what closes it.
          const at = changesetAt(channel);
          if (at !== undefined) stopUnwatched(at.dir);
          // Except for a resource watch, where the protocol says the opposite
          // in as many words: it has no dispose command, so the last
          // unsubscribe is what begins the watcher's release.
          releaseWatch(channel);
          releaseRelayed(channel);
          // And unsubscribing from a session is one of the three ways the
          // protocol says a client stops being active in it.
          releaseActiveClientForSession(channel, connection.clientId);
          leftChannel(connection.clientId, channel);
          // A session nobody watches is one the residency may let go.
          // https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L11752
          ctx.reconcile();
        },
        /**
         * What the client says happened.
         *
         * Applied under the origin the client sent it with: the action's echo
         * carries that `clientSeq`, and nothing else the dispatch causes does.
         * A dispatch that has to wait returns what it waits on, and its
         * client's later dispatches go behind it in `dispatchQueues`.
         *
         * One whose apply throws is refused here, as a step of the queue that
         * fails is: a notification gets no reply, so a throw that left this
         * handler would reach no client at all.
         */
        dispatchAction: (params) => {
          const origin: Origin = {
            clientId: connection.clientId,
            clientSeq: typeof params.clientSeq === 'number' ? params.clientSeq : 0,
          };
          if (dispatchQueues.has(queuedAs())) {
            behind(params, origin, () => applyDispatch(params, origin));
            return;
          }
          let later: Promise<void> | undefined;
          try { later = applyDispatch(params, origin); }
          catch (error) {
            refuseFailed(params, origin, error);
            return;
          }
          if (later !== undefined) behind(params, origin, () => later);
        },
        /**
         * A batch a client reports on a watch this host keeps on it: the
         * receiver's `resourceWatch/changed`, sent back over the action
         * envelope as the protocol carries a watch's changes to its caller.
         * Heard only on a channel this host subscribed to on this connection.
         * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/resource-watch-channel.md#L83
         */
        action: (params) => { heard(connection, params); },
      };
      return {
        /*
         * The keys of the table above, which is the only place they exist: it
         * is rebuilt per connection, and the suite reads them here to assert
         * that every one is classified in `GATE`.
         */
        methods: Object.keys(handlers),
        async handle(request) {
          const notify = ownIn(notifications, request.method);
          if (notify) {
            // Dropped rather than refused: a notification carries no id, so
            // there is nowhere to say no, and a client that has not
            // introduced itself has no subscriptions to unsubscribe and no
            // `clientSeq` an echo could be matched against.
            if (!conn.handshook) return undefined;
            notify(request.params);
            return undefined;
          }
          /*
           * A protocol handler first, and then an `x-` command the daemon or a
           * plugin serves. A served
           * one passes the same handshake check and the same gate below.
           */
          const served = methodIn(options.methods, request.method);
          const handler = ownIn(handlers, request.method) ?? (served === undefined
            ? undefined
            : async (params: Record<string, unknown> | undefined) => served.method.handle(params ?? {}, connection.principal, connection.clientId, ownerFor(connection)));
          /*
           * A method this host does not have is said, in the reference host's
           * words: a host that answered an empty success to it would leave the
           * client waiting for state that is never coming.
           * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2763
           */
          if (!handler) {
            throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${request.method}`);
          }
          // Everything before the handshake is `-32601`, in the same words, as
          // the reference host answers a transport that has not introduced
          // itself. `ping` is the one exception the spec states outright: the
          // round trip is a liveness check, and a liveness check that needs a
          // handshake first cannot tell a half-open socket from a busy one.
          // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L896-L899
          if (!conn.handshook && !GREETINGS.has(request.method)) {
            throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${request.method}`);
          }
          /*
           * The one gate.
           *
           * Every command passes here, so a handler added later is gated as
           * every other one is. A client's resource, under the client scheme,
           * is gated by that scheme as any other scheme is.
           *
           * A host with no user directory has no principal and refuses nothing,
           * which is what keeps every install that never configured one exactly
           * as it was.
           */
          const gate = admit(request.method, (request.params ?? {}) as Record<string, unknown>);
          if (gate !== undefined) await gate;
          // A second `initialize` is a method the handshake took: the version
          // is agreed, and re-agreeing it would re-key every subscription this
          // connection is holding. Answered as the reference host's request
          // table answers it, which holds no handler for one.
          if (conn.handshook && request.method === 'initialize') {
            throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${request.method}`);
          }
          /*
           * A channel the protocol fixes, named as something else.
           *
           * Twenty commands declare `channel` as a literal - `ahp-root://`
           * for most, `ahp-automations://` for the two automation ones -
           * because they are about the host rather than about any one
           * session. A host that answered them on whatever arrived would make
           * a client sending the wrong constant look correct, which is how a
           * client ships one: it typechecks, every test passes against the
           * lenient host, and the first conformant one refuses it with
           * nothing on screen saying why.
           *
           * Only when the client actually named one. A command sent without a
           * `channel` has named nothing wrong, and this host has always taken
           * those - refusing them now would be a rule applied backwards.
           */
          const fixed = ownIn(DECLARED, request.method);
          const named = (request.params as { channel?: unknown } | undefined)?.channel;
          // The catalogue and the root under any of their spellings are still themselves.
          if (fixed !== undefined && typeof named === 'string' && named !== '' && named !== fixed
            && !(fixed === AUTOMATIONS && isAutomations(named))
            && !(fixed === ROOT && isRootChannel(named))) {
            throw new RpcError(INVALID_PARAMS, `${request.method} is answered on ${fixed}, not on ${named}`);
          }
          return handler(request.params);
        },
        close() {
          const was = [...connection.activeSubscriptions];
          // A container is this connection's own process, and a socket that
          // drops takes its relays with it rather than leaving a host running
          // in a container for nobody.
          conn.alive = false;
          if (options.containers !== undefined) {
            for (const id of [...conn.containers.keys()]) {
              conn.containers.delete(id);
              void Promise.resolve(options.containers.disconnect(id)).catch(() => { /* already gone */ });
            }
          }
          const departed = connections.delete(connection);
          // Said once, however often the close is asked for.
          if (departed && connection.socket !== undefined) clientsChanged({ socket: connection.socket, joined: false });
          // A client with no connection left is gone from now, which its
          // record's retention is counted from.
          if (departed && known.has(connection.clientId) && ![...connections].some((one) => one.clientId === connection.clientId)) {
            lastSeen.set(connection.clientId, Date.now());
          }
          // The relays above were ended one by one; the view across
          // connections drops this one with the connection itself.
          ctx.relays.delete(connection);
          void fire({ type: 'client_disconnect', client: connection.clientId || 'anonymous' });
          /*
           * And the git watch of a directory this was the last watcher of. The
           * connection is out of the set above, so a directory only it watched
           * has nobody left watching.
           */
          for (const channel of was) {
            const at = changesetAt(channel);
            if (at !== undefined) stopUnwatched(at.dir);
          }
          // The tokens went with the connection; so do their clocks.
          for (const key of [...conn.expiring.keys()]) conn.forgetExpiry(key);
          // What it reported on the watches this host keeps on it stops, and a
          // request for its resources waits out the grace for it to come back.
          clientGone(connection);
          // Each resource watch it subscribed to is released as its
          // unsubscribe releases one, as the reference host releases a gone
          // client's subscriptions.
          // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1867-L1883
          for (const channel of was) releaseWatch(channel);
          for (const channel of was) releaseRelayed(channel);
          /*
           * Gone without reconnecting, which is the second of the three ways -
           * and the one that waits rather than leaving at once. The connection
           * is out of the set above before the wait begins, so what the wait
           * finds at the end of it is every *other* connection this client has
           * and not this one; a client that comes back inside the window has
           * not gone anywhere, and every wait is called off. Each session the
           * client is in, or owes a tool call in, waits, the ones this
           * connection never watched among them, as the reference host times
           * out a client's every session.
           */
          const gone = connection.clientId;
          for (const uri of new Set([...[...presence.keys()].map((id) => ctx.nameOf(id)), ...sessions.keys()])) waitsOut(uri, gone);
          // A plugin channel forgets the client at once: a client that comes
          // back is asked for its snapshot again.
          for (const channel of was) leftChannel(connection.clientId, channel);
          // A debug-log collection it followed is called off, as the reference
          // host calls one off when its client goes.
          // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4123-L4128
          logs.abandon(connection.clientId);
          ctx.reconcile();
          log(`${connection.clientId || 'a client'} went away`);
        },
      };
    },
  };
  return host;
}
export { ROOT, isRootChannel, type Summary };

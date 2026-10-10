/**
 * The protocol server: channels, subscriptions, requests and state actions.
 *
 * One host serves many connections. It owns the session catalogue, the live
 * sessions and the sequence number that orders everything it emits.
 *
 * Rules that govern anything answering AHP:
 *
 * - `serverSeq` advances when state changes, not per message. A snapshot is
 *   taken at a sequence number and every action after it carries a greater
 *   one, which is how a client knows it missed nothing.
 * - Notifications carry no id and get no reply. `unsubscribe` and
 *   `dispatchAction` are notifications.
 * - Subscriptions are per connection. Dropping one client's subscription must
 *   not affect another's.
 * - Only client-dispatchable actions are accepted from clients; the rest are
 *   the host reporting what it did.
 */

import { chatReducer } from '@microsoft/agent-host-protocol';
import type { AnnotationsState, ChatAction, SessionInputRequestKind, ToolDefinition } from '@microsoft/agent-host-protocol';
import type { WireTurn } from './types/wire.js';
import { INVALID_PARAMS, RpcError, METHOD_NOT_FOUND } from './rpc.js';
import { computerId, computersFor } from './computers.js';
import { nestedAgent } from './nested.js';
import { createCallLinks } from './calllinks.js';
import { createSessionEvents } from './host/sessionevents.js';
import { idFor, idOf, uriFor, Status } from './catalog.js';
import { memorySessions } from './sessions.js';
import { meter } from './meter.js';
import { debugLogs } from './debuglogs.js';
import type { Terminal } from './types/terminals.js';
import type { SessionConfigAnswerer, SessionConfigAsk } from './types/completions.js';
import type { MessageAttachment, MessageFrom } from './types/session.js';
import type { Connection, Credential, Host, HostOptions, HostTool, TitleStrategy, ToolCall } from './types/host.js';
import type { Principal } from './types/users.js';
import type { Summary } from './types/catalog.js';
import type { Agent, BoundTool, Listed, McpServer } from './types/agent.js';
import type { ToolsEndpoint } from './tools/server.js';
import type { Bag } from './types/common.js';
import type { Session, SubagentChat, SubagentRequest } from './types/session.js';
import type { Peer } from './types/rpc.js';
import type { Owner } from './types/usage.js';
import { ownerOfPrincipal } from './values.js';
import { reason } from './host/common.js';
import {
  ROOT, isRootChannel, AUTOMATIONS, MARKS, spaceOf, baseOf, URI_KEYS, named,
  chatUriFor, subagentChatUri, WORKER_ACTIONS, toolCallOfSubagentChat, isAutomations,
} from './host/channels.js';
import type { Space } from './host/channels.js';
import { DELTA_WINDOW_MS, merger } from './host/deltas.js';
import { Claiming } from './host/state.js';
import type { Claimed, Held, Learned, LiveSubagent, NameKind, Origin } from './host/state.js';
import { GREETINGS, UNGATED, PER_CONNECTION, seesConfig, DECLARED, REVERSE } from './host/gate.js';
import type { Home } from './host/gate.js';
import { createChatRecord } from './host/chatrecord.js';
import { createRouting } from './host/routing.js';
import { createRelay } from './host/relay.js';
import { createChangesets } from './host/changesets.js';
import { createFacts } from './host/facts.js';
import { createOwners } from './host/owners.js';
import { createMachines } from './host/machines.js';
import { createSessionConfig } from './host/sessionconfig.js';
import { createRoot } from './host/root.js';
import { createCatalogue } from './host/catalogue.js';
import { createSpawn } from './host/spawn.js';
import { createLifecycle } from './host/lifecycle.js';
import { createTooling } from './host/tooling.js';
import { createTerminalMethods, createTerminals } from './host/terminals.js';
import { createAutomations } from './host/automations.js';
import { createHistory } from './host/history.js';
import { createSnapshots } from './host/snapshots.js';
import { createTelemetry } from './host/telemetry.js';
import { createAuth } from './host/auth.js';
import { createAdmission } from './host/admission.js';
import { createHandshake } from './host/handshake.js';
import { createResourceMethods } from './host/resourcemethods.js';
import { createSessionMethods } from './host/sessionmethods.js';
import { createAutomationMethods } from './host/automations.js';
import { createVscodeMethods } from './host/vscodemethods.js';
import { createActions } from './host/actions.js';
import type { ConnectionContext, HostContext } from './host/context.js';
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
 * How long a client's place in a session is kept after its connection closes.
 *
 * A dropped socket is not a client that has finished with a session: what it
 * announced there - the tools it runs, the plugins it handed over - is in the
 * session's hands rather than the connection's, and a client that subscribes
 * again inside this window has never left. Nothing is said about it in the
 * meantime, and nothing it contributes is taken away.
 */
const CLIENT_DISCONNECT_GRACE_MS = 30_000;

/**
 * How long a dispatch waits on a session being started again or on a read
 * of the catalogue, in milliseconds, before it is refused and the
 * connection's later dispatches go on without it.
 */
const WAIT_LIMIT = 60_000;

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
 * file, and spreading it would stamp each one with today's answer. Decision
 * `a-plugin-gets-frozen-copies-of-host-values`.
 */
function heldPrincipal(who: Principal): Principal {
  if (Array.isArray(who.roles)) Object.freeze(who.roles);
  return Object.freeze(who);
}

export function createHost(options: HostOptions): Host {
  const dir = options.path;
  /**
   * Every name this host holds or has handed out, and what it is.
   *
   * A session under its held name and every name a client created it under,
   * its chats, including the ones a client named, its worker chats,
   * terminals, this host's resource watches and the ones a client relays.
   * One name is one thing: a new session, chat, terminal or relayed watch is
   * refused a name already here (`claimable`), and the users gate reads a
   * channel's kind from here (`channelKind`). Written by the maps that hold
   * each kind, which are `Claiming`, and by `createSession` for the name a
   * client asked for.
   */
  const claims = new Map<string, Claimed>();
  /**
   * The backends this host serves, by the id clients name.
   *
   * A host with two answers `createSession` for either and lists both
   * catalogues as one. Nothing below here knows what any of them are.
   */
  const agents = new Map<string, Agent>();
  for (const agent of options.agents) {
    if (agents.has(agent.provider)) {
      throw new Error(`Two agents both call themselves ${agent.provider}`);
    }
    agents.set(agent.provider, agent);
  }
  /**
   * Every directory any backend catalogues, plus the host's own.
   *
   * Where past sessions and branches are looked for; not what a client may
   * read, which is anything. Asked each time rather than captured, because a
   * backend may learn about a directory after this host started.
   */
  const browsable = (): string[] => {
    const found = new Set<string>([options.path]);
    for (const agent of options.agents) {
      for (const dir_ of agent.directories?.() ?? []) found.add(dir_);
    }
    return [...found];
  };
  const first = options.agents[0];
  if (!first)
    throw new Error('A host with no agents can serve nothing. Pass at least one.');
  const connections = new Set<Connection>();
  /**
   * The ten `resource*` methods, which run in both directions.
   *
   * `CommandMap` and `ServerCommandMap` carry the same ten entries with the
   * same params and the same results, so a request naming a URI a client
   * published is the same request sent back the other way.
   */
  /**
   * The watches clients have asked for, by the channel each was given.
   *
   * The protocol ties a watch's life to its subscription - there is no dispose
   * command, and `unsubscribe` is the only handle a client needs - so this is
   * what `unsubscribe` and a dropped connection are checked against.
   */
  /**
   * Who is in each session, by session URI and then by client id.
   *
   * The protocol calls these `activeClients` and makes membership the host's
   * to keep: a client announces itself with `session/activeClientSet` and the
   * host takes it out again when the client unsubscribes or goes. Keyed by
   * `clientId` rather than by connection, because that is what the protocol
   * keys it by - a client that reconnects is the same client.
      *
   * By the id inside a session's URI, as the session store is: a client
   * announces itself on the way in, which can be before this host has listed
   * anything and so before it knows the name it will publish that session
   * under.
   */
  const presence = new Map<string, Map<string, Bag>>();

  const watches = new Claiming<{
    state: Bag;
    watcher: { close(): void };
    /** The connection that asked for it, which keeps it alive until it subscribes. */
    owner: Connection;
    /** Whether anybody has ever subscribed. Until they have, there is nothing to have stopped. */
    opened: boolean;
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
   * The live sessions started by resuming one the backend recorded, whose
   * workers from before this process are read back beside the live ones. A
   * session started fresh has none, and its backend's record is not read.
   */
  const resumedSessions = new Set<string>();
  /**
  /** Every chat, back to the session holding it. */
  const byChat = new Claiming<{ uri: string; chat: Session }>(claims, 'chat', (_, held) => held.uri);
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
  /** What each chat's summary last said, so an unchanged one is not re-sent. */
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
   * Every client this host has handshaken with, by the id it gave.
   *
   * What `reconnect` is answerable *against*. A client comes back saying "I am
   * this id and I had seen up to here", and both halves are meaningless to a
   * host that has never met it: this one's sequence numbers are its own, so
   * "everything after 419" means nothing if 419 was another process's.
   *
   * Per host and for its lifetime, because that is the span the sequence
   * covers. A daemon that restarts has genuinely forgotten every client, and
   * saying so is the point - see the refusal in `reconnect`.
   */
  const known = new Set<string>();
  /**
   * The person who first signed in under each client id, by client id: the
   * only one a `reconnect` under that id is answered for.
   */
  const holders = new Map<string, string>();
  const learned = new Map<string, Learned>();
  const about = (provider: string): Learned => {
    const held = learned.get(provider);
    if (held) return held;
    const made: Learned = { models: [], commands: [], seeds: [] };
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
   */
  const REPLAY = 1000;
  /** The last `REPLAY` action envelopes, oldest first. */
  const replayable: { channel: string; action: Record<string, unknown>; serverSeq: number; origin: Origin | undefined }[] = [];
  /** Everything watching a channel, which is not everything connected. */

  /**
   * What somebody is part-way through typing in a chat with nothing running.
   *
   * A live chat holds its own draft, because two people on one session are
   * meant to see each other's. A session browsed out of the catalogue has no
   * process to hold one - and typing into it is exactly what somebody does
   * first, before there is any reason to start an agent. Refusing it made the
   * client revert the character it had already drawn, which is a composer that
   * empties itself as it is typed into.
   *
   * Kept here until the session is started, and handed to the chat when it is.
   */
  const drafts = new Map<string, Bag>();

  /**
   * What a client has marked on a session, by that session's id.
   *
   * Kept, not computed. Annotations are the one channel whose state is
   * entirely a client's: nothing here produces a mark, and what this host
   * contributes is that a mark one client made is a mark every other client
   * in the session can see. Keyed by id rather than by URI for the reason the
   * flags are - a session is addressable under more than one spelling and
   * there is only one set of marks.
   */
  const marks = new Map<string, AnnotationsState>();

  /**
   * The worktree each isolated session runs in, by session URI.
   *
   * Only the ones this host made. A directory somebody pointed a session at is
   * theirs, and removing it because a session ended would be this daemon
   * deleting a project.
   */
  const worktrees = new Map<string, { repository: string; path: string; branch?: string; base?: string }>();
  /**
   * The worktrees the reference window holds a handle on.
   *
   * Its dev container flow (`vscode/createAgentHostDetachedWorktree` and the
   * four beside it): a tree it asked for by handle before the session spoke,
   * claimed once the session started in it, taken down and put back with the
   * session's archived bit, deleted with it, and reconciled against the set
   * the window still knows about. Here a session's tree is made when the
   * session is, so a handle names a tree that already exists; what the
   * handle adds is the window's bookkeeping - claimed, archived, seen - and
   * its say over when the tree goes.
   */
  const detached = new Map<string, {
    session: string;
    repository: string;
    path: string;
    branch?: string;
    claimed: boolean;
    archived: boolean;
    createdAt: number;
    lastSeenAt: number;
  }>();
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
   * backend that is on its way out.
   */
  const restarting = new Map<string, Promise<void>>();
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
  /** The marks on a session, empty until somebody makes one. */
  const marksOf = (id: string): AnnotationsState => marks.get(id) ?? { annotations: [] };

  /**
   * One message, to everyone watching that channel.
   *
   * Addressed to each connection the way that connection asked: a client
   * watching an alias of this channel is sent the same payload under the name
   * it used, because its subscription is keyed by that name and it would drop
   * anything else.
   */
  const broadcast = (channel: string, method: string, params: unknown, per?: (connection: Connection) => unknown): void => {
    for (const connection of connections) {
      const alias = connection.aliases.get(channel);
      const aliased = alias !== undefined && connection.watching.has(alias);
      if (!connection.watching.has(channel) && !aliased) continue;
      const said = per === undefined ? params : per(connection);
      if (connection.watching.has(channel)) connection.peer.notify(method, said);
      // And under the older spelling, for a client still watching by that one.
      if (aliased) connection.peer.notify(method, { ...(said as Record<string, unknown>), channel: alias });
    }
  };
  /**
   * An action envelope as one connection receives it.
   *
   * Two actions are not the same for every connection. `root/configChanged`
   * carries `PER_CONNECTION` keys that belong to the client that sent them:
   * the sender gets its echo whole, and every other connection gets the same
   * envelope and `serverSeq` without those keys, with its own values in their
   * place when the action replaces the config. It carries the daemon's own keys
   * too, which are dropped for a connection without `config:read`.
   * `root/agentsChanged` carries
   * the root agent list, whose sign-in resource says `required: true` for a
   * connection that must sign in and `false` for one the host already treats
   * as somebody. An action on a session, chat or annotations channel this
   * connection knows the session by another name for carries the session's
   * URIs in that name, the same as its snapshot. Every other envelope is
   * delivered as it is.
   *
   * This is the one place an envelope is rewritten for a connection, which is
   * why the live broadcast and both replay paths call it: a rewrite anywhere
   * else would be a second opinion about the same delivery.
   */
  const seenBy = <E extends { channel: string; action: Record<string, unknown>; origin?: Origin | undefined }>(
    connection: Connection,
    envelope: E,
  ): E => {
    const { action } = envelope;
    if (!isRootChannel(envelope.channel)) {
      const spelling = spellingOf(connection, envelope.channel);
      return spelling === undefined
        ? envelope
        : { ...envelope, action: respelledIn(action, spelling.held, spelling.asked) };
    }
    if (action.type === 'root/agentsChanged') {
      return { ...envelope, action: { ...action, agents: agentsFor(connection, action.agents) } };
    }
    if (action.type !== 'root/configChanged') return envelope;
    const config = (typeof action.config === 'object' && action.config !== null ? action.config : {}) as Record<string, unknown>;
    /*
     * The daemon's own keys go to a connection holding `config:read` and to no
     * other, the sender among them. A write is `config:write`'s and a value is
     * `config:read`'s, so somebody who may change the listener but not read the
     * settings is refused the answer rather than trusted with it - and the
     * envelope is one per host, which is why this is here and not where the
     * change is applied.
     */
    const shown = seesConfig(connection)
      ? config
      : Object.fromEntries(Object.entries(config).filter(([key]) => !daemonKey(key)));
    const echo = (config: Record<string, unknown>): E => ({ ...envelope, action: { ...action, config } });
    if (envelope.origin !== undefined && envelope.origin.clientId === connection.clientId) {
      return shown === config ? envelope : echo(shown);
    }
    const theirs = Object.keys(shown).filter((key) => PER_CONNECTION.has(key));
    const own = action.replace === true
      ? Object.fromEntries(Object.entries(connection.config ?? {}).filter(([key]) => PER_CONNECTION.has(key)))
      : {};
    if (theirs.length === 0 && Object.keys(own).length === 0) return shown === config ? envelope : echo(shown);
    const kept = Object.fromEntries(Object.entries(shown).filter(([key]) => !PER_CONNECTION.has(key)));
    return { ...envelope, action: { ...action, config: { ...kept, ...own } } };
  };
  /**
   * Whose dispatch is being applied right now.
   *
   * The protocol's write-ahead loop is: a client applies an action to its own
   * state, sends it with a `clientSeq`, and waits for this host to echo it
   * back carrying that number. Without the echo a client cannot tell its own
   * write from somebody else's, and cannot do the optimistic half at all.
   *
   * A variable rather than an argument threaded through everything, because
   * the echo is usually several layers down: a client's `chat/turnStarted`
   * arrives here as a notification, is handed to `Session.begin`, and is
   * emitted from inside the session as the turn opens. Carrying an origin
   * through that would be a parameter on every method a client action reaches.
   *
   * It is only ever held across *synchronous* work - `dispatchAction` sets it,
   * applies, and clears it in a `finally` with nothing awaited in between - so
   * nothing else can run while it is set and no action can be attributed to a
   * client that did not cause it. Anything that answers in a later turn of the
   * event loop, like a config key the backend has to be asked about, reads
   * nothing from here and is passed an origin of its own.
   */
  let applying: Origin | undefined;
  /**
   * One state action, to everyone watching that channel.
   *
   * `serverSeq` moves here and only here. A snapshot is taken *at* a sequence
   * number and every action after it carries a greater one, which is how a
   * client knows it missed nothing - so the counter has to advance with state,
   * never with messages.
   */
  const emit = (channel: string, action: Record<string, unknown>, origin: Origin | undefined): void => {
    ctx.serverSeq += 1;
    const envelope = { channel, action, serverSeq: ctx.serverSeq, origin };
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
    ctx.telemetered(channel, action);
    ctx.asking(channel, action);
    ctx.links.observe(channel, action);
    ctx.sessionEvents.observe(channel, action);
    replayable.push({ ...envelope, action: structuredClone(action) });
    if (replayable.length > REPLAY) replayable.shift();
    broadcast(channel, 'action', envelope, (connection) => seenBy(connection, envelope));
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
   * One state action on its way out.
   *
   * The three kinds that stream text are gathered for `deltaWindowMs`; every
   * other action flushes them and goes out itself, so nothing a client reads
   * against the text is sent ahead of it.
   */
  const dispatch = (channel: string, given: Record<string, unknown>, origin = applying): void => {
    const action = ctx.withWorkerUri(channel, given);
    /*
     * A session's customizations are two halves, and one action carries both.
     *
     * What the backend reports is what the backend loaded; what the session's
     * clients handed it - the plugins this host copied for them - is the other
     * half. Laid after rather than merged, because nothing a backend says can
     * take a client's plugin away: a plugin's `id` is the client's own, so no
     * id is in both halves and the order is the only thing that could differ.
     */
    if (action.type === 'session/customizationsChanged') {
      const halves = laid(channel, action.customizations);
      if (halves.length > 0) action.customizations = halves;
    }
    if (deltas.push(channel, action, origin)) return;
    emit(channel, action, origin);
  };
  /**
   * A session's customizations as a client reads them: a backend's, then its
   * clients', with nothing said about a session that has no client plugins.
   */
  const laid = (channel: string, reported: unknown): Bag[] => [
    ...(Array.isArray(reported) ? reported : []),
    ...ctx.clientPluginsOf(channel),
  ];
  /**
   * A client's action, refused in that client's hearing.
   *
   * The other half of the write-ahead loop. A client applies an action before
   * sending it, so a host that decides not to apply one has to *say so*: an
   * envelope carrying `rejectionReason` is what tells the client to put its own
   * state back. Dropping it - which is what every one of these sites used to do
   * - leaves the client holding a change this host never made, with nothing
   * anywhere to correct it. The log line goes to the daemon's stdout, where no
   * client is looking.
   *
   * Three things it deliberately does not do.
   *
   * `serverSeq` does not move, because no state did. The counter's whole job is
   * to let a client tell what it has already seen from what is still to come,
   * and a refusal is neither: it carries the sequence this host is *still* at.
   *
   * It is not buffered for replay, for the same reason. A client that comes
   * back is asking what it missed of the state, and this changed none of it.
   *
   * It goes to the one connection that sent it rather than to everyone watching
   * the channel. A refusal answers one client's dispatch; nobody else applied
   * it optimistically, so nobody else has anything to put back - and a client
   * that reduced a rejected envelope would apply the very change this host
   * refused.
   */
  const refuse = (
    peer: Peer,
    channel: string,
    action: Record<string, unknown>,
    origin: Origin | undefined,
    reason: string,
  ): void => {
    log(`${channel}: ${reason}`);
    // Under the name the client watches it by, as `broadcast` sends an action.
    const alias = [...connections].find((one) => one.peer === peer)?.aliases.get(channel);
    peer.notify('action', { channel: alias ?? channel, action, serverSeq: ctx.serverSeq, origin, rejectionReason: reason });
  };
  /**
   * Let a watch go once nobody is listening to it.
   *
   * The protocol's rule, and it is a MUST: when every subscriber has
   * unsubscribed, or the connection drops, the watcher is released. Checked
   * against every connection rather than the one that just left, because two
   * clients may watch one channel and the second is still reading.
   *
   * The connection that *created* it counts even before it has subscribed:
   * `createResourceWatch` hands back a channel and the client subscribes after,
   * so releasing on "nobody is watching" alone would close every watch in the
   * gap between the two calls.
   */
  const releaseWatch = (channel: string): void => {
    const held = watches.get(channel);
    if (!held) return;
    for (const connection of connections) {
      if (connection.watching.has(channel)) return;
    }
    // Handed out and not yet subscribed to. Its owner is still here, so it is
    // still on its way to being watched rather than finished with.
    if (!held.opened && connections.has(held.owner)) return;
    held.watcher.close();
    watches.delete(channel);
    log(`released ${channel}`);
  };

  /** Who this session currently has in it. Always a list, because the field is required. */
  const activeClientsOf = (uri: string): Bag[] => [...(presence.get(idOf(uri))?.values() ?? [])];

  /**
   * Take a client out of a session, if nothing else is holding it there.
   *
   * The protocol names three ways this happens - unsubscribe, disconnect
   * without reconnecting, reconnect without resubscribing - and they are the
   * same condition seen from three places: no connection with that client id
   * is watching that session any more. Checked rather than assumed, because
   * one person can have two windows open on one session and closing the first
   * must not remove them from it. Any spelling of the session counts, and
   * the removal is said under the name it is held by.
   */
  const leaves = (asked: string, clientId: string): void => {
    const uri = heldAs(asked);
    const held = presence.get(idOf(uri));
    if (!held?.has(clientId)) return;
    for (const connection of connections) {
      if (connection.clientId !== clientId) continue;
      if ([...connection.watching].some((channel) => heldAs(channel) === uri)) return;
    }
    held.delete(clientId);
    if (held.size === 0) presence.delete(idOf(uri));
    dispatch(uri, { type: 'session/activeClientRemoved', clientId });
    /*
     * And the tools it was providing, which leave with it.
     *
     * Both halves matter. The model is offered a smaller list from here on -
     * a tool whose client has gone is one every call to would fail - and any
     * call already out with that client is failed now rather than left as a
     * turn waiting on a promise nothing can settle.
     */
    for (const chat of sessions.get(uri)?.chats.values() ?? []) chat.clientGone?.(clientId);
    retool(uri);
  };

  /**
   * The places a client's closed connection left behind, by session and client.
   *
   * Keyed by what a returning connection comes back as rather than by the
   * connection, because that is the whole of what the wait is about: the client
   * is one client under one id, and a socket that drops and a socket that
   * arrives a moment later are the same client to every session it was in.
   */
  const graces = new Map<string, ReturnType<typeof setTimeout>>();

  /** The key one client's wait in one session is held under. */
  const waitKey = (uri: string, clientId: string): string => `${uri}\u0000${clientId}`;

  /**
   * The wait is over, because this client is watching this session.
   *
   * Called from every subscription, which is why it takes a channel rather
   * than a session: what a client subscribes to is a chat as often as the
   * session itself, and either one means the client is here for both.
   */
  const waitingOver = (channel: string, clientId: string): void => {
    const key = waitKey(heldAs(channel), clientId);
    const timer = graces.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    graces.delete(key);
  };

  /**
   * A client's connection has closed: its place in this session is kept.
   *
   * Nothing is kept for a client that holds no place there, which is every
   * session a connection watched without ever announcing itself in it -
   * `leaves` would take nothing out, so there is nothing to wait for.
   *
   * A later close starts the wait again rather than leaving the first one
   * running: what is being measured is how long this client has been gone, and
   * a second window closing is a client that is still here until it does.
   */
  const waitsOut = (channel: string, clientId: string): void => {
    const uri = heldAs(channel);
    if (!presence.get(idOf(uri))?.has(clientId)) return;
    waitingOver(uri, clientId);
    graces.set(waitKey(uri, clientId), setTimeout(() => {
      graces.delete(waitKey(uri, clientId));
      leaves(uri, clientId);
    }, CLIENT_DISCONNECT_GRACE_MS));
  };

  /** Let every wait go, for a host that is closing and will remove nothing later. */
  const gracesOver = (): void => {
    for (const timer of graces.values()) clearTimeout(timer);
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
    options, dir, known, replayable, leaves, seenBy, claims, agents, first, connections, relays: new Map(), holders, sessions, byChat, subagents, owners, names,
    leadOf, wheres, worktrees, githubFacts, kept, offered, decided, about, terminals,
    madeFrom, origins, births, moves, browsable, broadcast, presence, beside, marks, lives, lifeOf, restarting, learned, starting,
    logs, detached, refuse,
    serverSeq: 0,
    closed: false, refusing: undefined, bareSessions: new Set<string>(), described, links,
    watches, marksOf, resumedSessions, activeClientsOf, drafts,
    restartNeeded: false,
    dispatch,
    flushDeltas: deltas.flush,
  } as HostContext;
  // Before any area is built, because everything a person or a backend does
  // goes out through `emit`, which folds into this stream on the way.
  ctx.sessionEvents = createSessionEvents(ctx);
  Object.assign(ctx, createTelemetry(ctx));
  Object.assign(ctx, createAuth(ctx));
  // Before the routing, because which session a chat URI names is read there.
  Object.assign(ctx, createChatRecord(ctx));
  Object.assign(ctx, createRouting(ctx));
  Object.assign(ctx, createRelay(ctx));
  Object.assign(ctx, createChangesets(ctx));
  Object.assign(ctx, createFacts(ctx));
  Object.assign(ctx, createOwners(ctx));
  Object.assign(ctx, createMachines(ctx));
  Object.assign(ctx, createSessionConfig(ctx));
  Object.assign(ctx, createRoot(ctx));
  Object.assign(ctx, createCatalogue(ctx));
  Object.assign(ctx, createSpawn(ctx));
  Object.assign(ctx, createLifecycle(ctx));
  Object.assign(ctx, createTooling(ctx));
  Object.assign(ctx, createTerminals(ctx));
  Object.assign(ctx, createAutomations(ctx));
  Object.assign(ctx, createHistory(ctx));
  Object.assign(ctx, createSnapshots(ctx));
  /*
   * The state a subscriber reads, with the client plugins laid into it.
   *
   * The outgoing half of the rule `dispatch` carries: a session is what its
   * backend reports and what its clients handed it, and a client that
   * subscribed reads the whole of it. Wrapped here rather than in the
   * snapshot's own file because the entries are this host's, and this is
   * where a host has both the snapshot and the tooling that holds them.
   */
  const backendSnapshot = ctx.snapshotOf;
  ctx.snapshotOf = async (
    channel: string,
    mine?: Record<string, unknown>,
    connection?: Connection,
  ): Promise<Record<string, unknown>> => {
    /*
     * Every subscription passes here - the command, and the two handshakes
     * that subscribe on their way in - so this is where a client that comes
     * back is seen to have come back. The wait a dropped connection began is
     * over: the client never left, and nothing is on its way to saying it did.
     */
    if (connection !== undefined) waitingOver(channel, connection.clientId || 'anonymous');
    const answer = await backendSnapshot(channel, mine, connection);
    const handed = ctx.clientPluginsOf(channel);
    if (handed.length === 0) return answer;
    const state = answer.state as Bag;
    return {
      ...answer,
      state: {
        ...state,
        customizations: [...(Array.isArray(state.customizations) ? state.customizations : []), ...handed],
      },
    };
  };
  const {
    spaceHere, heldAs, nameOf, ownName, sessionOfChat, sessionFor, chatOf, meantBy,
    sessionHolding, channelKind, sessionChannel, homeOf, spelledFor, respell, respelledIn,
    spellingOf, answeredAs, claimable, unheld, ownId, ownerOf, elsewhere, relayed, clients,
    dirOf, catalogueOf, changesetAt, changesetOf, operationsOf, operationsMoved, contentMoved,
    changesetsOf, operationContext, opKey, inFlight, lastError, shown,
    describes, setArtifacts, captureBaseline, recordPullRequest, metaMoved, dirOfFile, wroteThrough,
    refreshWatched, startWatchingDir, stopUnwatched, refreshPullRequests, readFacts, refreshFacts,
    LOGS, TRACES, METRICS, log, fire, telemetered,
    loginId, resourcesOf, agentsFor, lent, advertised, metadataFor, channelAwaiting, asking,
    charged, ownerFor, principals, principalFor, forWhom, senderOf,
    charge, checked, scoping, settle,
    sessionMachines, enteredIn, inMachine, bringBackOf, followOf, leaveForgotten, machineFor, admitted, placedIn,
    isolating, mergedConfig, propertyOf, sessionSchema, runningSchema, seeded,
    contributedDefaults, storedConfig,
    rootConfig, descriptors, daemonSchema, daemonProperties, daemonKey,
    advertisedSchemes, rootState,
    statusOf, startedBy, chatSummary, subagentSummary, restoredSubagentSummary,
    activityOf, sessionAdded, summaryMoved, activeSessionsMoved, learnModels,
    listing, waitingFor, readStored,
    absorb, unstamped, withWorkerUri, stampedCalls, withSender,
    sendSubagent, describedSub, endedWorkers, openSubagent,
    formerChatUri, titleOf, keepTitle, keepProvider, spawn,
    removeSession, restart, restartChat, backendsOwn, isolated,
    beginOrRun, beginTurn, modelIn, messageFrom, messageAttachments, openSession,
    permitted, toolDefinitions, retool, renameChat,
    commanded, terminalInfo, heldTerminals, changed, due, startForAutomation,
    past, history, subHistory, titles, refresh, held,
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

  for (const agent of agents.values()) {
    if (!agent.probe)
      continue;
    void agent.probe().then((offered) => {
      const held = about(agent.provider);
      held.commands = offered.commands;
      held.seeds = offered.customizations;
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
      log(`${agent.provider}: ${held.models.length} model(s), ${held.commands.length} command(s), ${held.seeds.length} customization(s)`);
      dispatch(ROOT, { type: 'root/agentsChanged', agents: descriptors() });
    }).catch(() => { });
  }
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

  options.automations?.onDue?.(due);

  return {
    clients,
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
      ctx.contributing = permitted(ctx.contributed);
      for (const uri of sessions.keys())
        dispatch(uri, { type: 'session/serverToolsChanged', tools: toolDefinitions(uri) });
    },
    connections: () => connections.size,
    close: () => {
      closing ??= (async () => {
        // The window closes with the host: what it holds goes out now, and the
        // last actions the sessions below emit go out as they are dispatched.
        // A delta still waiting on the timer would otherwise be broadcast by a
        // timer that outlives the host it belongs to.
        deltas.stop();
        ctx.closed = true;
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
          catch (error) { log(`closing ${what} failed: ${reason(error)}`); }
        };
        const going: Promise<void>[] = [];
        for (const held of sessions.values()) {
          for (const [uri, chat] of held.chats) going.push(step(uri, () => chat.close()));
        }
        // A run already past its guard ends here, refused at `spawn` or started
        // and so among the sessions; its outcome is the run's to report.
        for (const run of starting) going.push(run.then(() => undefined, () => undefined));
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
         * against its plugin and the next one still runs - decision
         * `a-plugin-is-told-when-the-host-closes`.
         */
        for (const { by, close } of options.closers ?? []) {
          await step(`the plugin ${by}`, close);
        }
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
    accept(peer: Peer, principal?: Principal, root?: boolean) {
      const connection: Connection = {
        peer, clientId: '', watching: new Set<string>(),
        tokens: new Map<string, Credential>(), aliases: new Map<string, string>(),
        /*
         * A socket that arrived on a personal connection token is already
         * somebody, so the gate reads this before the first command rather
         * than waiting for an `authenticate` the client may never send.
         *
         * Frozen here as well as where it was built, because this is the last
         * place this host sees it before a provider, a hook or a scheme's own
         * methods are handed it - and an embedder that built its own answered
         * for nothing beyond this process. `heldPrincipal` is that freeze, and
         * it takes the roles with it. Decision
         * `a-plugin-gets-frozen-copies-of-host-values`.
         */
        ...(principal === undefined ? {} : { principal: heldPrincipal(principal) }),
        // And one admitted on the deployment's own token is the host itself.
        ...(root === true ? { root: true } : {}),
      };
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

      const conn = { connection, alive: true, containers: new Map() } as ConnectionContext;
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
      /**
       * This connection's dispatches that wait, in the order it sent them.
       *
       * Two kinds of dispatch cannot be applied at once: one into a session
       * being started again, which waits for the start, and a config change
       * for a session nothing is running, which reads its transcript to learn
       * whether it is one. Each is applied once what it waits on answers, and
       * every dispatch this connection sends meanwhile goes behind it: a
       * client that changes the config and then starts a turn means that
       * order. Undefined when nothing waits, which is when a dispatch is
       * applied at once.
       */
      let waiting: Promise<void> | undefined;
      /**
       * `wait`, or a failure saying what was waited on once `WAIT_LIMIT` has
       * passed without it.
       */
      const bounded = <T>(wait: Promise<T>, what: string): Promise<T> => new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error(`${what} took longer than ${WAIT_LIMIT / 1000}s`)); }, WAIT_LIMIT);
        wait.then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
        );
      });
      /** A dispatch applied now, as the one this host is applying. */
      const applyNow = (params: Record<string, unknown>, origin: Origin): Promise<void> | undefined => {
        applying = origin;
        try { return applyDispatch(params, origin); }
        finally { applying = undefined; }
      };
      /**
       * `waiting`, extended by one step for the dispatch in `params`.
       *
       * A step whose connection left while it waited is dropped: there is
       * nobody to answer or echo it to. A step that fails is refused to the
       * client, as any other action this host will not apply.
       */
      conn.bounded = bounded;
      conn.applyNow = applyNow;
      const behind = (params: Record<string, unknown>, origin: Origin, step: () => Promise<void> | undefined): void => {
        const next = (waiting ?? Promise.resolve()).then(() => (connections.has(connection) ? step() : undefined)).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          log(`a dispatch from ${connection.clientId || 'anonymous'} failed: ${reason}`);
          if (!connections.has(connection)) return;
          const action = (typeof params.action === 'object' && params.action !== null ? params.action : {}) as Record<string, unknown>;
          refuse(connection.peer, meantBy(String(params.channel ?? '')), action, origin, reason);
        });
        waiting = next;
        void next.then(() => { if (waiting === next) waiting = undefined; });
      };
      /** Notifications: no id, no answer, and that is the whole difference. */
      const notifications: Record<string, (params: Record<string, unknown>) => void> = {
        unsubscribe: (params) => {
          // This connection stops watching. Not the channel - doing that to
          // shed one consumer kills the stream the others are reading.
          const channel = String(params.channel ?? '');
          connection.watching.delete(channel);
          // A changeset nobody watches any more is a directory with no reason
          // for a git watch, so the last unsubscribe is what closes it.
          const at = changesetAt(channel);
          if (at !== undefined) stopUnwatched(at.dir);
          for (const [meant, alias] of connection.aliases) {
            if (alias === channel) connection.aliases.delete(meant);
          }
          // Except for a resource watch, where the protocol says the opposite
          // in as many words: it has no dispose command, so the last
          // unsubscribe is what releases the watcher.
          releaseWatch(channel);
          // And unsubscribing from a session is one of the three ways the
          // protocol says a client stops being active in it.
          leaves(channel, connection.clientId || 'anonymous');
        },
        /**
         * What the client says happened.
         *
         * `applying` is held across the whole of `applyDispatch` and cleared
         * after, so every action the dispatch causes - including the ones
         * emitted from inside a session, several layers down - goes out
         * carrying the `clientSeq` the client sent. Nothing in there is
         * awaited, which is what makes that safe: no second dispatch can
         * begin while this one is being applied. A dispatch that has to wait
         * returns what it waits on instead, and this connection's later
         * dispatches go behind it in `waiting`.
         */
        dispatchAction: (params) => {
          const origin: Origin = {
            clientId: connection.clientId || 'anonymous',
            clientSeq: typeof params.clientSeq === 'number' ? params.clientSeq : 0,
          };
          if (waiting !== undefined) {
            behind(params, origin, () => applyNow(params, origin));
            return;
          }
          const later = applyNow(params, origin);
          if (later !== undefined) behind(params, origin, () => later);
        },
      };
      return {
        /*
         * The keys of the table above, which is the only place they exist: it
         * is rebuilt per connection, and the suite reads them here to assert
         * that every one is classified in `GATE`.
         */
        methods: Object.keys(handlers),
        async handle(request) {
          const notify = notifications[request.method];
          if (notify) {
            // Dropped rather than refused: a notification carries no id, so
            // there is nowhere to say no, and a client that has not
            // introduced itself has no subscriptions to unsubscribe and no
            // `clientSeq` an echo could be matched against.
            if (!conn.handshook) return undefined;
            notify(request.params);
            return undefined;
          }
          const handler = handlers[request.method];
          if (!handler) {
            // Said, not silently accepted. A host that answers an empty
            // success to a method it does not have leaves the client waiting
            // for state that is never coming.
            throw new RpcError(METHOD_NOT_FOUND, `This host does not serve ${request.method} yet`);
          }
          // Everything before the handshake is `-32601`, which reads oddly
          // for a method this host plainly has and is what the protocol
          // leaves for it: there is no code for "not yet", and the reference
          // host answers exactly this. `ping` is the one exception the spec
          // states outright - the round trip is a liveness check, and a
          // liveness check that needs a handshake first cannot tell a
          // half-open socket from a busy one.
          if (!conn.handshook && !GREETINGS.has(request.method)) {
            throw new RpcError(METHOD_NOT_FOUND, `This host does not serve ${request.method} before initialize`);
          }
          /*
           * The one gate.
           *
           * Every command passes here, so a handler added later is refused
           * rather than served by omission - which is the property `needsWrite`
           * did not have when five handlers each remembered to call it. It sits
           * before the client relay below on purpose: a URI another client owns
           * is that client's to answer, and this host's roles do not reach into
           * it.
           *
           * A host with no user directory has no principal and refuses nothing,
           * which is what keeps every install that never configured one exactly
           * as it was.
           */
          const gate = admit(request.method, (request.params ?? {}) as Record<string, unknown>);
          if (gate !== undefined) await gate;
          // And a second `initialize` is no longer one of them: the version
          // is agreed, and re-agreeing it would re-key every subscription
          // this connection is holding.
          if (conn.handshook && request.method === 'initialize') {
            throw new RpcError(METHOD_NOT_FOUND, `${connection.clientId || 'This client'} has already initialized`);
          }
          /*
           * A URI another client published is that client's to answer.
           *
           * Before the handler, because the handler is this host's
           * filesystem and the resource is not on it. What goes back is
           * whatever the owning client said, verbatim - including its
           * refusal, which is the owner's to make.
           */
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
          const fixed = DECLARED[request.method];
          const named = (request.params as { channel?: unknown } | undefined)?.channel;
          // The catalogue and the root under any of their spellings are still themselves.
          if (fixed !== undefined && typeof named === 'string' && named !== '' && named !== fixed
            && !(fixed === AUTOMATIONS && isAutomations(named))
            && !(fixed === ROOT && isRootChannel(named))) {
            throw new RpcError(INVALID_PARAMS, `${request.method} is answered on ${fixed}, not on ${named}`);
          }
          if (REVERSE.has(request.method)) {
            const away = await elsewhere(request.method, request.params ?? {});
            if (away !== undefined) return away.result;
          }
          return handler(request.params);
        },
        close() {
          const was = [...connection.watching];
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
          connections.delete(connection);
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
          for (const resource of [...conn.expiring.keys()]) conn.forgetExpiry(resource);
          // And the watches it was keeping for other clients: the channel was
          // its to report on, and with it gone nothing ever will again.
          for (const [channel, away] of [...relayed]) {
            if (away.owner === connection) relayed.delete(channel);
          }
          // Before anything else looks: a watch this client owned and never
          // subscribed to has nobody left to subscribe to it.
          for (const channel of [...watches.keys()]) releaseWatch(channel);
          /*
           * Gone without reconnecting, which is the second of the three ways -
           * and the one that waits rather than leaving at once. The connection
           * is out of the set above before the wait begins, so what the wait
           * finds at the end of it is every *other* connection this client has
           * and not this one; a client that subscribes again inside the window
           * has not gone anywhere, and the wait is called off.
           */
          for (const channel of was) waitsOut(channel, connection.clientId || 'anonymous');
          log(`${connection.clientId || 'a client'} went away`);
        },
      };
    },
  };
}
export { ROOT, isRootChannel, type Summary };

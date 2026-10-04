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

import { annotationsReducer, chatReducer, IS_CLIENT_DISPATCHABLE, negotiateProtocolVersion, SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import type { AnnotationsAction, AnnotationsState, ChatAction, ChatState, SessionInputRequestKind, ToolDefinition, Turn } from '@microsoft/agent-host-protocol';
import type { WireTurn } from './types/wire.js';
import { RpcError, INTERNAL_ERROR, METHOD_NOT_FOUND } from './rpc.js';
import { notServed } from './resources.js';
import { computerId, computersFor } from './computers.js';
import { nestedAgent } from './nested.js';
import { createCallLinks } from './calllinks.js';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { worktreeFor, worktreesOf } from './repo/worktrees.js';
import { idFor, idOf, uriFor, Status } from './catalog.js';
import { tail, older } from './paging.js';
import { memorySessions } from './sessions.js';
import { meter } from './meter.js';
import { namesOf } from './scopes.js';
import { accepts } from './configvalues.js';
import { debugLogs, hostLogPath } from './debuglogs.js';
import type { LogFile } from './debuglogs.js';
import { lookup } from 'node:dns/promises';
import type { Terminal } from './types/terminals.js';
import type { ContainerConnect, ContainerConnectResult, ContainerSink } from './types/containers.js';
import type { SessionConfigAnswerer, SessionConfigAsk } from './types/completions.js';
import type { MessageAttachment, MessageFrom } from './types/session.js';
import type { WriteMode } from './types/resources.js';
import type { Connection, Credential, Host, HostOptions, HostTool, TitleStrategy, ToolCall } from './types/host.js';
import type { Grant, Principal } from './types/users.js';
import type { Summary } from './types/catalog.js';
import type { Agent, BoundTool, Listed, McpServer } from './types/agent.js';
import type { ToolsEndpoint } from './toolserver.js';
import type { Bag } from './types/common.js';
import type { Session, SubagentChat, SubagentRequest } from './types/session.js';
import type { Peer } from './types/rpc.js';
import type { Owner } from './types/usage.js';
import { need, reason, CLOSING, BANG, HOSTS_OWN } from './host/common.js';
import {
  ROOT, isRootChannel, AUTOMATIONS, MARKS, uriOf, schemeOf, spaceOf, baseOf, URI_KEYS, named,
  chatUriFor, subagentChatUri, WORKER_ACTIONS, toolCallOfSubagentChat, isAutomations,
} from './host/channels.js';
import type { Space } from './host/channels.js';
import { Claiming } from './host/state.js';
import type { Claimed, Held, Learned, LiveSubagent, NameKind, Origin } from './host/state.js';
import { GREETINGS, UNGATED, dispatchNeeds, computerNeeds, PER_CONNECTION, seesConfig, ACTION_HOMES, HOME_WORDS, DECLARED, REVERSE } from './host/gate.js';
import type { Home } from './host/gate.js';
import { createRouting } from './host/routing.js';
import { createRelay } from './host/relay.js';
import { createChangesets } from './host/changesets.js';
import { createFacts } from './host/facts.js';
import { createOwners } from './host/owners.js';
import { createMachines } from './host/machines.js';
import { createSessionConfig, SEEDS } from './host/sessionconfig.js';
import { createRoot } from './host/root.js';
import { createCatalogue } from './host/catalogue.js';
import { createSpawn } from './host/spawn.js';
import { createLifecycle } from './host/lifecycle.js';
import { createTooling } from './host/tooling.js';
import { claimOf, createTerminals } from './host/terminals.js';
import { createAutomations } from './host/automations.js';
import { createHistory } from './host/history.js';
import { createSnapshots } from './host/snapshots.js';
import { createTelemetry } from './host/telemetry.js';
import { createAuth } from './host/auth.js';
import { createAdmission } from './host/admission.js';
import type { HostContext } from './host/context.js';
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
 * Where a write may be placed, as the protocol's `ResourceWriteMode` has them.
 *
 * Written out here because this is the one place a *client's* string has to be
 * checked against the vocabulary rather than assigned to it - and the list is
 * held to the protocol's by the type on the next line, so it cannot drift.
 */
const WRITE_MODES: string[] = ['truncate', 'append', 'insert'] satisfies WriteMode[];

/** The proxy variables the network diagnostics report, when set. */
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'] as const;
/** How long a network probe waits, and how much of the body it keeps. */
const PROBE_TIMEOUT = 10_000;
const MAX_BODY = 64 * 1024;
/**
 * How long `Host.close` waits for the agents and terminals it ended to exit.
 *
 * Long enough for a backend to take its process down after stdin closes, and
 * short enough that a process that ignores its kill does not hold a stop or a
 * restart for ever: what is still running then is left to the operating system.
 */
export const HOST_CLOSE_WAIT_MS = 5_000;

/** One address lookup for the network diagnostics, timed and never thrown. */
const resolved = async (host: string, family: 4 | 6): Promise<{ address?: string; durationMs: number; error?: string }> => {
  const began = Date.now();
  try {
    const { address } = await Promise.race([
      lookup(host, { family }),
      new Promise<never>((_, reject) => { setTimeout(() => { reject(new Error(`Timed out after ${PROBE_TIMEOUT / 1000}s`)); }, PROBE_TIMEOUT).unref?.(); }),
    ]);
    return { address, durationMs: Date.now() - began };
  }
  catch (error) {
    return { durationMs: Date.now() - began, error: reason(error) };
  }
};

/**
 * How long a dispatch waits on a session being started again or on a read
 * of the catalogue, in milliseconds, before it is refused and the
 * connection's later dispatches go on without it.
 */
const WAIT_LIMIT = 60_000;

/**
 * The most rows this host will serve in one page, however many were asked for.
 *
 * The protocol says a server MAY impose its own cap, and one exists so that a
 * client asking for a million does not turn a page into the whole catalogue
 * plus the work of slicing it.
 */
const PAGE_CAP = 500;

/**
 * The most rows a client that asked for no page size is handed at once.
 *
 * Deliberately far above any real catalogue rather than at a page's size:
 * neither client that connects to this host reads `nextCursor`, so anything
 * smaller would be a catalogue silently cut down to it. This is not a page
 * size - it is the point past which a single frame stops being servable at
 * all, and reaching it is written to the log because the client cannot see it.
 */
const PAGE_MOST = 1_000;

/**
 * A pagination cursor, which is opaque by contract.
 *
 * It is the resource of the last row served, encoded - so it says nothing a
 * client is invited to read, parse or keep. The protocol says cursors are
 * server-defined and MUST be treated as opaque; encoding is what makes that
 * true rather than merely asked for.
 */
const sealed = (resource: string): string => Buffer.from(resource, 'utf8').toString('base64url');

/** The resource a cursor named, or nothing a row will match. */
const opened = (cursor: string): string => {
  try { return Buffer.from(cursor, 'base64url').toString('utf8'); }
  catch { return ''; }
};

/**
 * The protocol's own answer to "may a client send this?", by action type.
 *
 * Widened from the generated exhaustive map, which is keyed by the action
 * types the package knows: a type read off the wire is a string and may be
 * none of them, and `undefined` there means "no such action" rather than
 * "host-only".
 */
const dispatchable = IS_CLIENT_DISPATCHABLE as Record<string, boolean | undefined>;

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
  /** How long an unclaimed handle, or a claimed one nobody has seen, is kept before a reconcile may reap it. */
  const DETACHED_GRACE = 24 * 60 * 60 * 1000;

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
  const dispatch = (channel: string, given: Record<string, unknown>, origin = applying): void => {
    const action = ctx.withWorkerUri(channel, given);
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
    replayable.push({ ...envelope, action: structuredClone(action) });
    if (replayable.length > REPLAY) replayable.shift();
    broadcast(channel, 'action', envelope, (connection) => seenBy(connection, envelope));
  };
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
  /*
   * One object every area of the host reaches for, built once from the maps
   * and the helpers declared above it.
   */
  const ctx = {
    options, claims, agents, first, connections, holders, sessions, byChat, subagents, owners, names,
    leadOf, wheres, worktrees, githubFacts, kept, offered, decided, about, terminals,
    madeFrom, origins, births, moves, browsable, broadcast, presence, beside, marks, lives, learned, starting,
    serverSeq: 0,
    closed: false, described, links,
    watches, marksOf, resumedSessions, activeClientsOf, drafts,
    restartNeeded: false,
    dispatch,
  } as HostContext;
  Object.assign(ctx, createTelemetry(ctx));
  Object.assign(ctx, createAuth(ctx));
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
    sessionMachines, enteredIn, inMachine, leaveForgotten, machineFor, admitted, placedIn,
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
    past, history, subHistory, titles, listNow, catalogue,
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
  /** What the window's "collect logs" gets, and reads back. */
  const logs = debugLogs();

  /**
   * The backend's own file for a session, or for one chat of it.
   *
   * A chat here is its own backend session with an id of its own, so a chat
   * named is that id; a session named is its lead's. A row that is not
   * running has the id in its URI, which is what the catalogue listed it by.
   */
  const stateFileOf = (session: string, chat?: string): string | undefined => {
    const uri = sessions.has(session) ? session : sessionFor(session);
    const held = sessions.get(uri);
    const agent = held?.agent ?? owners.get(uri);
    const dir = dirOf(uri);
    const chosen = chat === undefined ? undefined : byChat.get(chatOf(chat));
    if (chat !== undefined && chosen?.uri !== uri) throw new RpcError(-32602, 'chat must belong to the requested Agent Session');
    if (agent?.stateFile === undefined || dir === undefined) return undefined;
    const live = chosen?.chat ?? (held ? leadOf(held) : undefined);
    return agent.stateFile(live?.agentId() ?? idOf(uri), dir);
  };

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
        ctx.closed = true;
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
        await step('the automation store', () => options.automations?.close?.());
        await step('the session store', () => kept.close?.());
      })();
      return closing;
    },
    turning: () => [...sessions.keys()]
      .filter((uri) => (statusOf(uri) & (Status.InProgress | Status.InputNeeded)) !== 0),
    accept(peer: Peer, principal?: Principal, root?: boolean) {
      const connection: Connection = {
        peer, clientId: '', watching: new Set<string>(),
        tokens: new Map<string, Credential>(), aliases: new Map<string, string>(),
        // A socket that arrived on a personal connection token is already
        // somebody, so the gate reads this before the first command rather
        // than waiting for an `authenticate` the client may never send.
        ...(principal === undefined ? {} : { principal }),
        // And one admitted on the deployment's own token is the host itself.
        ...(root === true ? { root: true } : {}),
      };
      /*
       * A person this host was given rather than one that signed in.
       *
       * `principals` is how an owner is resolved to the memberships behind the
       * name, and it is filled from `authenticate`. A socket handed a principal
       * never sends one, so without this a session it owns has no principal and
       * every check against it is skipped - the work runs unchecked rather than
       * refused, which is the worse of the two answers.
       */
      if (principal !== undefined) principals.set(`user:${principal.id}`, principal);
      /**
       * Whether this connection has been introduced.
       *
       * The protocol opens with `initialize`, or with `reconnect` for a client
       * coming back to a host it has met. Until one of them has been answered
       * there is no negotiated version, no `clientId` and nothing to key a
       * subscription by - so serving anything else means serving a client
       * this host has agreed on nothing with.
       */
      let handshook = false;

      /**
       * What this client pushed, narrowed to what that backend asked for.
       *
       * Narrowed rather than handed over whole: a token for one resource is
       * not a token for another, and a backend has no business seeing a
       * credential meant for something it does not speak to.
       */
      const tokensFor = (provider: string): Record<string, string> => {
        const agent = agents.get(provider);
        const out: Record<string, string> = {};
        for (const one of agent?.protectedResources ?? []) {
          const id = (one as { resource?: unknown }).resource;
          if (typeof id !== 'string') continue;
          const held = connection.tokens.get(id);
          // Not one that has run out. The timer below takes it away at the
          // moment it expires, but a session asked for in the same tick would
          // still find it here, and would start on a credential the client
          // was about to be told is gone.
          if (held !== undefined && !(held.expiresAt !== undefined && held.expiresAt <= Date.now())) out[id] = held.token;
        }
        return out;
      };
      /**
       * When each token runs out, so the client that pushed it is told.
       *
       * The protocol has a word for this - `auth/required` with
       * `reason: 'expired'` - and until `expiresIn` arrived on `authenticate`
       * this host had no way to earn it: nothing here verifies a token, so it
       * never learned that one had gone stale. Now the client says how long
       * it has, and the moment it runs out is a fact this host holds alone.
       * Said to that connection and no other, because the token was theirs.
       *
       * `setTimeout` takes at most 2^31-1 milliseconds, a little under
       * twenty-five days; a token good for longer is checked again at that
       * boundary rather than fired early.
       */
      const expiring = new Map<string, ReturnType<typeof setTimeout>>();
      const LONGEST = 2 ** 31 - 1;
      const expire = (resource: string): void => {
        /*
         * The host's own resource holds no token to expire - what it leaves is
         * a principal - so it is the one case this path answers differently.
         * The notification is the same either way, because what a client has
         * to do about it is the same.
         */
        if (options.users !== undefined && resource === loginId()) {
          const until = connection.principalUntil;
          if (until === undefined) return;
          const left = until - Date.now();
          if (left > 0) {
            expiring.set(resource, setTimeout(() => expire(resource), Math.min(left, LONGEST)));
            expiring.get(resource)?.unref?.();
            return;
          }
          expiring.delete(resource);
          delete connection.principal;
          delete connection.principalUntil;
          log(`${connection.clientId || 'a client'}'s sign-in expired`);
          connection.peer.notify('auth/required', {
            channel: channelAwaiting(resource),
            resource: metadataFor(resource),
            reason: 'expired',
          });
          return;
        }
        const held = connection.tokens.get(resource);
        if (held?.expiresAt === undefined) return;
        const left = held.expiresAt - Date.now();
        if (left > 0) {
          expiring.set(resource, setTimeout(() => expire(resource), Math.min(left, LONGEST)));
          expiring.get(resource)?.unref?.();
          return;
        }
        expiring.delete(resource);
        connection.tokens.delete(resource);
        log(`${connection.clientId || 'a client'}'s token for ${resource} expired`);
        connection.peer.notify('auth/required', {
          channel: channelAwaiting(resource),
          resource: metadataFor(resource),
          reason: 'expired',
        });
      };
      /** Stop watching a token's clock: it was replaced, revoked, or the client left. */
      const forgetExpiry = (resource: string): void => {
        const timer = expiring.get(resource);
        if (timer !== undefined) clearTimeout(timer);
        expiring.delete(resource);
      };
      connections.add(connection);

      /**
       * Which store serves a URI.
       *
       * `file:` is the store the host was given, and anything else is a scheme
       * a plugin registered under `resourceProviders`. A scheme nobody serves
       * falls through to that same store, which is where the sentence about a
       * foreign scheme is written - so an unserved URI reads as somebody
       * else's rather than as a host that forgot it.
       *
       * A URI a connected client published never reaches here: the relay in
       * `handle` answers it before any handler, which is the order that keeps
       * a plugin from shadowing a client's own resources.
       */
      const storeFor = (uri: string) => {
        const scheme = schemeOf(uri);
        if (scheme === '' || scheme === 'file') return options.resources;
        const provider = options.resourceProviders?.[scheme];
        // A scheme nobody serves is not the file store's to read, and it is
        // not a permission answer either: the host has nothing for it, which
        // is `-32601` - decision `a-scheme-nobody-serves-is-not-a-permission-error`.
        if (provider === undefined) throw notServed(uri);
        return provider;
      };

      const { admit } = createAdmission(ctx, { connection, storeFor });

      /**
       * Whether this connection is still here.
       *
       * A container takes time to build, and a client that went while its image
       * was building must not leave a relay running behind it.
       */
      let alive = true;

      /**
       * The dev containers this connection opened, by the client's own name.
       *
       * Per connection, because a relay is one client's: the name is theirs,
       * nothing another client can spell reaches it, and a socket that drops
       * takes its containers with it. That is where the reference host keeps
       * them too - decision `the-relay-surface-is-the-reference-one`.
       *
       * `tail` is the launcher's own last words, kept only so a container that
       * dies can say why in this log - see `ended` below.
       */
      const containers = new Map<string, { name: string; folder: string; tail: string[] }>();

      /** How much of the launcher's output is kept to explain an ending. */
      const CONTAINER_TAIL = 24;

      /**
       * The three strings a connect carries from the client, checked once.
       *
       * A `connectionId` is a name a client chose, so it is bounded: non-empty,
       * no NUL, and short enough to be an identifier rather than a payload.
       * Whether the folder exists and has a container definition is the
       * launcher's to answer, because that is a question about a filesystem.
       * The owner is not among them: the client does not name one, and the
       * call below fills it from the connection the ask arrived on.
       */
      const containerAsk = (params: Record<string, unknown>): ContainerConnect => {
        const id = typeof params.connectionId === 'string' ? params.connectionId : '';
        if (id.trim() === '' || id.length > 256 || id.includes('\0')) {
          throw new RpcError(-32602, 'connectionId must be a non-empty identifier');
        }
        const folder = typeof params.workspaceFolder === 'string' ? params.workspaceFolder : '';
        if (folder.trim() === '' || folder.includes('\0')) {
          throw new RpcError(-32602, 'workspaceFolder must be a path on this host');
        }
        const name = typeof params.name === 'string' ? params.name : '';
        if (name.trim() === '' || name.includes('\0')) {
          throw new RpcError(-32602, 'name must be non-empty');
        }
        return { connectionId: id, workspaceFolder: folder, name };
      };

      /**
       * The one string a `disconnect` or a `relaySend` carries.
       *
       * The reference sends `{ connectionId }` and `{ connectionId, data }`,
       * so a folder is not asked for again: the connection was made with one.
       */
      const namedContainer = (params: Record<string, unknown>): string => {
        const id = typeof params.connectionId === 'string' ? params.connectionId : '';
        if (id.trim() === '' || id.length > 256 || id.includes('\0')) {
          throw new RpcError(-32602, 'connectionId must be a non-empty identifier');
        }
        return id;
      };

      const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
        /**
         * The handshake.
         *
         * Version negotiation is the highest version the client offered that
         * is compatible with one of `SUPPORTED_PROTOCOL_VERSIONS`, which is
         * what the specification asks for and what `negotiateProtocolVersion`
         * is for. A host that answers with a version the client did not offer
         * has answered with a version the client cannot read.
         */
        initialize: async (params) => {
          const offered = Array.isArray(params.protocolVersions)
            ? params.protocolVersions as string[]
            : [];
          let agreed: string | undefined;
          try {
            agreed = negotiateProtocolVersion(offered);
          } catch (problem) {
            // An entry that is not a `MAJOR.MINOR.PATCH` string is malformed
            // rather than merely incompatible, and the package throws on one.
            // An uncaught throw is not a JSON-RPC error a client can read.
            throw new RpcError(-32602, problem instanceof Error ? problem.message : String(problem));
          }
          if (!agreed) {
            // `supportedVersions`, which is the name the protocol gives this
            // field and the only reason the error is recoverable: it is what a
            // client reads to pick a version to retry with. Under any other
            // spelling, the one way out of a version mismatch reads
            // `undefined`.
            throw new RpcError(-32005, 'No protocol version in common', { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
          }
          /*
           * Whether a container can be made here, asked before the answer
           * that says so.
           *
           * Once per handshake rather than once per host: the question costs
           * two version probes, the answer can change under a running daemon
           * - Docker started, the CLI installed - and a client that is told
           * no is a client that never offers the flow. A probe that throws is
           * a no, because it answered nothing.
           */
          const containersReady = options.containers === undefined
            ? false
            : await options.containers.available().catch(() => false);
          connection.clientId = typeof params.clientId === 'string' ? params.clientId : 'anonymous';
          // Met, so a later `reconnect` under this id is answerable.
          known.add(connection.clientId);
          void fire({ type: 'client_connect', client: connection.clientId });
          // Introduced. Said after the version is agreed, so a client this
          // host cannot speak to is not one it has shaken hands with.
          handshook = true;
          const wanted = Array.isArray(params.initialSubscriptions)
            ? params.initialSubscriptions.filter((uri) => typeof uri === 'string')
            : [];
          const snapshots = [];
          for (const channel of wanted) {
            // A handshake that fails because one requested channel is gone is
            // a client that cannot connect at all. Take what can be taken.
            try {
              // Gated, resolved and answered the way `subscribe` is: the
              // root, a session or a chat under another spelling is told
              // under that spelling. Awaited only when the gate is waiting on
              // a scheme, so a handshake does not spend a turn of the loop on a
              // question it will not be asked.
              const held = admit('subscribe', { channel });
              if (held !== undefined) await held;
              const snapshot = await snapshotOf(meantBy(channel), connection.config ?? {}, connection);
              answeredAs(connection, channel, snapshot);
              snapshots.push(snapshot);
              connection.watching.add(channel);
            }
            catch { /* not subscribed, and the client will be told if it asks */ }
          }
          log(`${connection.clientId} connected, speaking ${agreed}`);
          return {
            protocolVersion: agreed,
            serverSeq: ctx.serverSeq,
            serverInfo: { name: 'ahpd', version: options.diagnostics?.version ?? '0.0.1' },
            snapshots,
            defaultDirectory: `file://${dir}`,
            // What the client should ask about rather than send. A slash is a
            // skill or a prompt the host contributed; an at-sign is a file.
            // Without this the client has no reason to believe either means
            // anything here, and types them into the chat as text.
            completionTriggerCharacters: ['/', '@'],
            // What this host emits, so a client knows there is a log to watch.
            // A template, because the variable is the severity a subscriber
            // wants rather than something the host fills in.
            telemetry: { logs: `${LOGS}/{level}`, traces: TRACES, metrics: METRICS },
            /*
             * Whether there are automations here at all.
             *
             * Presence is what *permits* the feature: the protocol says a
             * client may subscribe to `ahp-automations://` and dispatch the
             * automation actions when this is here, and that the host has
             * neither when it is not. So a host serving the channel and the
             * three commands while advertising nothing is a host whose
             * automations no correct client will ever touch - which is what
             * this was, and it worked only against a client that subscribed
             * regardless and caught the refusal.
             *
             * `create` because every store writes one. `schedules` with no
             * `minIntervalMinutes` because the cron grammar is the protocol's
             * own and this host restricts nothing beyond its one-minute
             * resolution. `runCancellation` is absent because it is not served
             * - a run here is a session, and disposing it is how it stops - and
             * `runHistoryLimit` because retention is the store's, which is what
             * an absent one means.
             */
            ...(options.automations ? { automations: { create: {}, schedules: {} } } : {}),
            /*
             * `!` at the start of a message means "run this", not "answer this".
             *
             * Advertised only when there is a shell to run it in. Absence is
             * the protocol's own way of saying the shorthand is unsupported,
             * so a host with no `terminals` port says nothing here and a
             * client types `!ls` into the conversation as text - which is the
             * right outcome for a host that cannot run it.
             */
            ...(options.terminals ? { terminalCommandPrefix: BANG } : {}),
            /*
             * What the reference client may ask beyond the protocol.
             *
             * Its window reads these flags off `initialize` and offers the
             * feature only where the host said so: `vscode/removeSessionArtifact`
             * is the close button on an artifact pill, and the detached
             * worktree five are its dev container flow.
             */
            _meta: {
              'vscode.removeSessionArtifact': true,
              'vscode.detachedWorktrees': true,
              'vscode.getAgentHostSessionStateFile.chat': true,
              // The dev container surface. A client reads this before it
              // offers the flow, so it is true only where a container can
              // actually be made: a host with the launcher loaded and no
              // Docker, or no Dev Container CLI, omits it and is never asked -
              // decision `a-dev-container-is-made-by-the-dev-container-cli`.
              ...(containersReady ? { 'vscode.devContainers': true } : {}),
              // What this host serves beside `file:`, so a client can draw a
              // screen for a scheme before it has a URI to ask.
              ...(advertisedSchemes() === undefined ? {} : { 'ahpd.resourceProviders': advertisedSchemes() }),
              // Who this connection is, so a client can read that person's own
              // `user://<id>` and needs no grant to do it. Absent where the
              // connection is nobody, which is every host with no users
              // directory - decision
              // `a-connection-is-told-who-it-is-on-initialize-and-in-root-state`.
              ...(ownerFor(connection) === undefined ? {} : { 'ahpd.principal': ownerFor(connection) }),
            },
          };
        },
        ping: async () => ({}),
        /**
         * A client that dropped, coming back.
         *
         * `serverSeq` is what makes this answerable: it advances with state
         * and never with messages, so "everything after the last one I saw"
         * is a well-formed question. The subscriptions come from the client
         * because they were its own - this host forgot them when the
         * connection went.
         *
         * Two answers, and the difference is whether the gap still fits in
         * the buffer. Replay is cheap and exact; a snapshot is neither, and
         * is what an hour-long disconnection gets.
         */
        reconnect: async (params) => {
          const clientId = typeof params.clientId === 'string' ? params.clientId : connection.clientId;
          /*
           * A client this host has never met, refused - and refused with this
           * code in particular.
           *
           * `reconnect` resumes a conversation about *this* host's sequence
           * numbers. To a client it has never seen, the honest answer is not an
           * empty replay - "you have missed nothing" - because that is a claim
           * about a stream the client was never reading. It answered exactly
           * that to a VS Code returning after a daemon restart, saying up to
           * 419 to a host that had issued nine, and was believed: the client
           * concluded its state was current and never subscribed to anything
           * again, so every pane it had stayed empty against a host that was
           * working perfectly.
           *
           * `-32008` is what the reference host answers here, and its client
           * reads that one code as "the server forgot me" and falls back to a
           * fresh `initialize` - which is the only path on which it restores
           * its subscriptions. Any other error is rethrown and the connection
           * fails, so this is not a detail: it is the whole recovery.
           */
          if (!known.has(clientId)) {
            throw new RpcError(-32008, `${clientId || 'That client'} is not a client this host has seen`);
          }
          /*
           * Under a users directory, a person signed in resumes only an id
           * that is theirs or nobody's, and is answered `-32008` otherwise,
           * so their client falls back to a fresh `initialize`. A connection
           * nobody has signed in on resumes any id it names: what it may not
           * read is `missing`, and `claimsId` gives it no claim on an id
           * somebody holds until that person signs in on it.
           */
          const holder = holders.get(clientId);
          if (options.users !== undefined && connection.root !== true && connection.principal !== undefined
            && holder !== undefined && holder !== connection.principal.id) {
            throw new RpcError(-32008, `${clientId || 'That client'} is not a client this connection may resume`);
          }
          // A person signed in resuming an id nobody holds holds it from now.
          if (options.users !== undefined && connection.principal !== undefined && holder === undefined && ownId(clientId)) {
            holders.set(clientId, connection.principal.id);
          }
          connection.clientId = clientId;
          void fire({ type: 'client_connect', client: connection.clientId });
          // The other way in. A client that dropped resumes with this rather
          // than a fresh `initialize`, and it is as much an introduction.
          handshook = true;
          // What this connection was watching before the drop. Whatever it
          // does not ask back for is the third way the protocol says a client
          // stops being active in a session: reconnecting without
          // resubscribing to it.
          const before = [...connection.watching];
          connection.watching.clear();
          const wanted = Array.isArray(params.subscriptions)
            ? params.subscriptions.filter((uri): uri is string => typeof uri === 'string')
            : [];
          const since = typeof params.lastSeenServerSeq === 'number' ? params.lastSeenServerSeq : 0;

          const missing: string[] = [];
          /** Each channel resumed, by the name this host dispatches under, with the name the client used. */
          const resumed = new Map<string, string>();
          for (const channel of wanted) {
            try {
              // Resolved the way `subscribe` resolves it, so a client coming
              // back under its own spelling of a chat, a session, or the
              // automations catalogue is resumed rather than told the channel
              // has gone - and is replayed, which is keyed by the name this
              // host dispatches under rather than the one the client used.
              const held = admit('subscribe', { channel });
              if (held !== undefined) await held;
              const meant = meantBy(channel);
              await snapshotOf(meant, connection.config ?? {}, connection);
              if (meant !== channel) connection.aliases.set(meant, channel);
              connection.watching.add(channel);
              resumed.set(meant, channel);
            }
            catch {
              // A session whose agent has gone, or one this client may no
              // longer see. Named, so the client drops it rather than waiting
              // on a channel that will never speak again.
              missing.push(channel);
            }
          }

          // Whatever it did not ask back for, it has left.
          for (const channel of before) {
            if (!connection.watching.has(channel)) leaves(channel, clientId);
          }

          const oldest = replayable[0]?.serverSeq;
          // Nothing buffered means nothing has happened since, which is a
          // replay of nothing rather than a reason to re-snapshot. A client
          // ahead of this host is the other way round and cannot be replayed to
          // at all - whatever it counted, it was not this stream - so it is
          // sent state rather than a difference.
          const replayable_ = since <= ctx.serverSeq && (oldest === undefined || since >= oldest - 1);
          if (replayable_) {
            log(`${clientId} came back at ${since}, replaying`);
            return {
              type: 'replay',
              actions: replayable.flatMap((held) => {
                const alias = resumed.get(held.channel);
                if (held.serverSeq <= since || alias === undefined) return [];
                const envelope = seenBy(connection, held);
                // A session's actions under the name this connection uses for
                // it, as they went out live; any other channel, the
                // automations catalogue among them, under the held name.
                return [spellingOf(connection, held.channel) === undefined ? envelope : { ...envelope, channel: alias }];
              }),
              missing,
            };
          }
          log(`${clientId} came back at ${since}, too far behind ${oldest} - snapshotting`);
          const snapshots = [];
          for (const channel of resumed.values()) {
            const snapshot = await snapshotOf(meantBy(channel), connection.config ?? {}, connection);
            answeredAs(connection, channel, snapshot);
            snapshots.push(snapshot);
          }
          return { type: 'snapshot', snapshots };
        },
        /**
         * A snapshot, and everything that happened while it was being taken.
         *
         * `snapshotOf` is asynchronous, and until it returns this connection
         * is not on the watch list - so an action dispatched in that window
         * goes to nobody, and is in no snapshot taken before it happened. It
         * is a small window and it is wide enough: a client that subscribes
         * and sends in the same breath - which is what opening a session from
         * a composer *is* - loses the `chat/turnStarted` its own message
         * caused. What follows is worse than one missing action, because
         * every delta after it names a turn the client was never told about
         * and the reducer drops each one in turn: the transcript stays empty
         * for the rest of the session, and nothing anywhere reports an error.
         *
         * Replayed from the buffer rather than closed by joining the watch
         * list first, because that order has a hole of its own - the client
         * would be sent actions the snapshot already contains, and a
         * `chat/delta` applied twice is the word written twice. The sequence
         * number is what tells "already in the snapshot" from "after it", and
         * this host keeps one for exactly this reason.
         */
        /**
         * Watch a channel, and answer with what it holds now.
         *
         * Subscribing twice to one channel answers twice. Nothing here marks a
         * subscription pending while its snapshot is taken, so a second
         * request that arrives during the first is an ordinary second request
         * rather than a replacement - the reference host cancels the earlier
         * one and answers it `-32001` naming a channel it is actively serving,
         * which reads like a session that does not exist.
         */
        subscribe: async (params) => {
          const channel = String(params.channel ?? '');
          // What it means here, and what it was called there. The snapshot is
          // taken of the channel and returned under the name the client used -
          // a client that asked about one URI and was answered about another
          // has been answered about something it is not watching.
          const snapshot = await snapshotOf(meantBy(channel), connection.config ?? {}, connection);
          /*
           * Resolved again, after the snapshot rather than before it.
           *
           * Opening a browsed row is what makes this host ask its backend for
           * a catalogue, and until it has asked there is no name for the row
           * to be an alias *of* - so a name resolved beforehand came back
           * unchanged, no alias was recorded, and every action about that
           * session afterwards went out under a name this client was not
           * watching.
           */
          const meant = answeredAs(connection, channel, snapshot);
          connection.watching.add(channel);
          // From here on, an unsubscribe means something: a watch nobody has
          // subscribed to yet is not one everybody has finished with.
          const held = watches.get(channel);
          if (held) held.opened = true;
          // Nothing is awaited between the line above and this one, so
          // nothing can be dispatched in between: what the filter finds is
          // the whole of what was missed, and what it leaves is already in
          // the snapshot or still to come by the ordinary route.
          const at = typeof snapshot.fromSeq === 'number' ? snapshot.fromSeq : 0;
          for (const held of replayable) {
            if (held.channel === meant && held.serverSeq > at) {
              const envelope = seenBy(connection, held);
              connection.peer.notify('action', meant === channel
                ? envelope
                : { ...envelope, channel });
            }
          }
          return { snapshot };
        },
        /**
         * Older turns, on demand.
         *
         * The result is deliberately empty: the turns arrive as
         * `chat/turnsLoaded` on the channel, so every client watching the chat
         * gets the page - not only the one that asked for it. A host that
         * answered in the result would be telling one client something the
         * others would never learn.
         */
        fetchTurns: async (params) => {
          // Under whatever spelling the client used: a chat may be addressed
          // by a URI this host did not mint, and a page of turns asked for
          // under that name is the same chat.
          const channel = meantBy(String(params.channel ?? ''));
          const live = byChat.get(channel);
          // Asked before the transcript, so a page asked for out of a session
          // waiting for its agent names that agent rather than saying the
          // session is nowhere.
          const missing = waitingFor(idOf(sessionFor(channel)));
          if (missing !== undefined) throw new RpcError(-32002, `${missing} is not loaded on this host`);
          const all = live ? live.chat.allTurns() : await past(idOf(sessionFor(channel)));
          if (!all)
            throw new RpcError(-32001, `No agent for session ${channel}`);
          const asked = typeof params.cursor === 'string' ? params.cursor : undefined;
          // No cursor means "load whatever is next", which is the page before
          // the one the snapshot carried.
          const from = asked ?? tail(all).turnsNextCursor;
          if (from === undefined) {
            // A session whose state holds every retained turn has no older
            // page and no cursor to carry. The protocol asks for that page
            // "if any", so there being none is an answer and not a refusal.
            return {};
          }
          const page = older(all, from);
          if (!page) {
            // An omitted cursor can only fail here on a transcript that moved
            // under the read, which is still an answer of "nothing older".
            if (asked === undefined) return {};
            // Guessing at a cursor this host did not issue would answer a
            // question about old turns with new ones, and the client would
            // page for ever without noticing.
            throw new RpcError(-32602, `Unrecognised cursor ${String(asked)}`);
          }
          dispatch(channel, {
            type: 'chat/turnsLoaded',
            // The action declares no `_meta` of its own, so the turns are the
            // whole of it: a client paging back through a conversation must not
            // find the sender gone on the oldest page.
            turns: withSender(idOf(sessionFor(channel)), page.turns),
            ...(page.turnsNextCursor ? { turnsNextCursor: page.turnsNextCursor } : {}),
          });
          return {};
        },
        /**
         * Completions for the text a person is composing.
         *
         * Answers `/` with the commands available to the session, or the
         * harness-wide list when it has none yet. `@` means a file and is not
         * served, so it returns nothing.
         */
        completions: async (params) => {
          if (String(params.kind ?? '') !== 'userMessage')
            return { items: [] };
          const text = String(params.text ?? '');
          const offset = typeof params.offset === 'number'
            ? Math.max(0, Math.min(params.offset, text.length))
            : text.length;
          const before = text.slice(0, offset);
          /*
           * An at-sign at the start of a word, and a path since.
           *
           * Answered before the slash, because the two cannot both match and
           * a file is the more specific question. What follows may contain
           * slashes - `@src/ho` is a path being typed, not a command - so the
           * pattern stops at whitespace rather than at a separator.
           */
          const asked = /(?:^|\s)@(\S*)$/.exec(before);
          if (asked) {
            const typed_ = asked[1] ?? '';
            const from = offset - typed_.length - 1;
            const asking = meantBy(String(params.channel ?? ''));
            const chat_ = byChat.get(asking)?.chat
              ?? (sessions.get(asking) ? leadOf(sessions.get(asking) as Held) : undefined);
            // Relative to the session's own directory, which is what a person
            // means by a path while talking to an agent working there.
            const base = chat_?.workingDirectories()[0]?.replace(/^file:\/\//, '') ?? dir;
            // Nothing rather than an error: this same command serves `/`,
            // and a host with no filesystem still has commands to offer.
            if (!options.resources) return { items: [] };
            const paths = await options.resources.complete(typed_, base);
            return {
              items: paths.map((path) => ({
                insertText: `@${path}`,
                rangeStart: from,
                rangeEnd: offset,
                attachment: {
                  // A reference, not the bytes: the file is fetched with
                  // `resourceRead` if anything needs it, and a completion that
                  // carried a megabyte would carry it per keystroke.
                  type: 'resource',
                  uri: uriOf(`${base}/${path}`.replace(/\/{2,}/g, '/')),
                  label: path,
                },
              })),
            };
          }
          // A slash at the start of a word, and nothing but word characters
          // since. A slash mid-sentence is a path, not a command.
          const found = /(?:^|\s)\/([\w:-]*)$/.exec(before);
          if (!found)
            return { items: [] };
          const typed = (found[1] ?? '').toLowerCase();
          const start = offset - typed.length - 1;
          const asked_ = meantBy(String(params.channel ?? ''));
          const session = byChat.get(asked_)?.chat
            ?? (sessions.get(asked_) ? leadOf(sessions.get(asked_) as Held) : undefined);
          // A live session's own list wins: two sessions in one directory can
          // be handed different things.
          /*
           * Inside the containers, because that is where a leaf lives.
           *
           * A top-level customization is a plugin or a directory and a skill
           * or a prompt is one of its `children` - so a filter that looked
           * only at the top level found nothing, every time, and this fell
           * back to the backend-wide list on every keystroke. Which answered
           * correctly and by accident: the whole point of `own` is that two
           * sessions in one directory can be handed different things.
           */
          const leaves = (session?.customizations() ?? []).flatMap((entry) => {
            const children = Array.isArray(entry.children) ? entry.children as Bag[] : [];
            return children.length > 0 ? children : [entry];
          });
          const own = leaves
            // Skills as well as prompts, and not the ones the CLI keeps for
            // the agent: offering one it will refuse is worse than not
            // offering it.
            .filter((entry) => (entry.type === 'prompt' || entry.type === 'skill')
              && entry.disableUserInvocation !== true)
            .map((entry) => ({
            name: String(entry.name),
            description: typeof entry.description === 'string' ? entry.description : undefined,
            argumentHint: typeof entry.argumentHint === 'string' ? entry.argumentHint : undefined,
            isSkill: entry.type === 'skill',
          }));
          /*
           * Which of the backend-wide commands are skills.
           *
           * The probe's flat command list cannot say - the CLI reports a
           * skill behind a slash as a command like any other - but its
           * customizations can, and a skill is a leaf of one of them. Read
           * once per answer rather than per item.
           */
          const skillsOf = (provider: string): Set<string> => {
            const out = new Set<string>();
            for (const entry of about(provider).seeds) {
              const children = Array.isArray(entry.children) ? entry.children as Bag[] : [];
              for (const leaf of children.length > 0 ? children : [entry]) {
                if (leaf.type === 'skill' && typeof leaf.name === 'string') out.add(leaf.name);
              }
            }
            return out;
          };
          const skilled = (provider: string) => {
            const skills = skillsOf(provider);
            return about(provider).commands.map((command) => ({ ...command, isSkill: skills.has(command.name) }));
          };
          /*
           * ...but an empty list means *not known yet*, not *none*.
           *
           * A session created a moment ago has not heard back from its
           * backend, and preferring its silence over the backend-wide list is
           * a slash menu that is empty for exactly as long as somebody is
           * likely to use it.
           *
           * With no session it is the root channel being asked, and the
           * answer is every backend's - narrowed to one when the client says
           * which provider it is composing for, because that is the only
           * thing that knows.
           */
          const named = String(params.provider ?? '');
          const wide = named !== '' && agents.has(named)
            ? skilled(named)
            : [...agents.keys()].flatMap((provider) => skilled(provider));
          const offered = own.length > 0 ? own : wide;
          const matches = offered
            .filter((command) => command.name.toLowerCase().includes(typed))
            // What was typed a prefix of, first. A substring match is useful
            // and is not what somebody typing `de` is looking for.
            .sort((a, b) => {
            const rank = Number(b.name.toLowerCase().startsWith(typed))
              - Number(a.name.toLowerCase().startsWith(typed));
            return rank !== 0 ? rank : a.name.localeCompare(b.name);
          })
            /*
             * A menu's worth when something was typed; the list when nothing
             * was.
             *
             * A bare slash is a client asking what there is, and it may well
             * filter the answer itself rather than ask again per keystroke -
             * so truncating that to a screenful drops commands it would then
             * never offer, silently and always the same ones. A narrowing
             * query is the interactive case and stays bounded.
             */
            .slice(0, typed === '' ? 500 : 50);
          return {
            items: matches.map((command) => ({
              // The space only when it takes an argument: a trailing space on
              // a command that takes none is a character somebody deletes.
              insertText: command.argumentHint ? `/${command.name} ` : `/${command.name}`,
              rangeStart: start,
              rangeEnd: offset,
              attachment: {
                type: 'simple',
                label: `/${command.name}`,
                ...(command.description ? { modelRepresentation: command.description } : {}),
                /*
                 * What makes it a *command* rather than a line of text.
                 *
                 * The protocol declares `SimpleMessageAttachment` with a label
                 * and no notion of a slash command, so the reference client
                 * reads one out of `_meta`: a bag carrying `command` is a
                 * slash command, one carrying `uri` is a skill, and a bag
                 * carrying neither is dropped without a word. That is the
                 * whole reason a menu can come back full and draw empty -
                 * every item was answered and none was a command.
                 *
                 * `description` is the second column and `argumentHint` is
                 * the ghost text after an accepted one.
                 */
                _meta: {
                  command: command.name,
                  // A skill, said so: the reference client keeps a runtime
                  // skill in an automation's text only when the flag is
                  // there, and drops it as a command it cannot find a file
                  // for otherwise. `true` or absent, the way it is read.
                  ...(command.isSkill ? { isSkill: true } : {}),
                  ...(command.description ? { description: command.description } : {}),
                  ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
                },
              },
            })),
          };
        },
        /**
         * The catalogue, in pages when a client asks for one.
         *
         * Only when it asks. `limit` omitted is the protocol's own "let the
         * server choose the page size", and the size this host chooses is all
         * of them - because neither client that connects to it reads
         * `nextCursor`: VS Code's `listSessions` sends `{ channel }` and takes
         * `items`, and so does ahpc. A default page would silently be the
         * whole catalogue to both of them.
         */
        listSessions: async (params) => {
          const rows = await listNow();
          const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
          const after = cursor === undefined
            ? 0
            : rows.findIndex((row) => row.resource === opened(cursor)) + 1;
          // Refused rather than guessed at, the way an unrecognised turn
          // cursor is: a cursor whose row has been disposed would otherwise
          // resume from the top, and the client would page for ever.
          if (cursor !== undefined && after === 0)
            throw new RpcError(-32602, `Unrecognised cursor ${cursor}`);
          const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
            ? Math.max(1, Math.min(Math.floor(params.limit), PAGE_CAP))
            : PAGE_MOST;
          const items = rows.slice(after, after + limit);
          // Said out loud, because it is the one case a client cannot see: a
          // catalogue past the bound is one this host can no longer hand over
          // whole, and neither client that connects to it reads `nextCursor`.
          if (limit === PAGE_MOST && rows.length - after > PAGE_MOST) {
            log(`${String(rows.length)} sessions is past ${String(PAGE_MOST)}: paging, which no client here asks for`);
          }
          const last = items[items.length - 1];
          return {
            items,
            ...(last && after + items.length < rows.length ? { nextCursor: sealed(last.resource) } : {}),
          };
        },
        /*
         * The host's filesystem, as far as a client is allowed to see it.
         *
         * Both halves are served. The read half answers any connection, and
         * the write half - `resourceWrite`, `resourceDelete`, `resourceMkdir`,
         * `resourceMove` and `resourceCopy` - does too, because the connection
         * token has already decided who may be here and `resourceRequest`
         * grants any `file:` URI to anyone who asks. What decides a write is
         * the store's own rule about the path, not a grant this connection
         * holds; only a host with no store that writes answers `-32601`.
         */
        /**
         * A shell on this machine.
         *
         * The client picks the URI, as it does for a session, so it can
         * subscribe without a round trip in between. `cwd` is checked against
         * the directories this host serves - a terminal is arbitrary code on
         * the machine, and one that started anywhere would be a host that
         * hands out a shell wherever it is asked.
         */
        createTerminal: async (params) => {
          // Before the URI is looked at. A host that opens no shells at all
          // should say that, not complain about the argument to a request it
          // was never going to answer.
          const shells = need(options.terminals, 'createTerminal');
          const uri = named(String(params.channel ?? ''), 'terminal');
          if (terminals.has(uri))
            throw new RpcError(-32003, `${uri} already exists`);
          claimable(uri, 'terminal');
          const asked = typeof params.cwd === 'string' ? params.cwd.replace(/^file:\/\//, '') : dir;
          /*
           * Whose terminal this is, checked rather than taken.
           *
           * A claim used to be a `Bag` and anything at all was accepted, so a
           * client could take a terminal with `{}` and the channel then said
           * so to everyone watching. Absent is this connection, which is the
           * ordinary case; present and malformed is a refusal, because a
           * client that meant to name a session and got it wrong should hear
           * about it rather than quietly become the owner.
           */
          const claim = params.claim === undefined
            ? { kind: 'client' as const, clientId: connection.clientId }
            : claimOf(params.claim);
          if (!claim) throw new RpcError(-32602, 'That is not a terminal claim');
          if (ctx.closed) throw new RpcError(INTERNAL_ERROR, CLOSING);
          const terminal = shells.create({
            uri,
            cwd: asked,
            claim,
            // This connection's own shell, if it pushed one. Per connection
            // rather than per host: two people on one daemon each get theirs,
            // and neither can name the binary the other's terminal opens.
            ...(typeof connection.config?.defaultShell === 'string'
              ? { shell: connection.config.defaultShell }
              : {}),
            ...(typeof params.name === 'string' ? { name: params.name } : {}),
            ...(typeof params.cols === 'number' ? { cols: params.cols } : {}),
            ...(typeof params.rows === 'number' ? { rows: params.rows } : {}),
            emit: (_channel, action) => {
              dispatch(uri, action);
              /*
               * A terminal that exited is a different row on the root channel
               * as well, and that list only moved when one was created or
               * disposed - so the catalogue went on describing a dead shell as
               * running until somebody closed it.
               *
               * Worse since 0.9.0 rather than new: the old shape said nothing
               * about a terminal that had not exited, and this one says
               * `{ status: 'running' }` out loud. A stale silence is a client
               * with less to go on; a stale assertion is a client that has
               * been told something untrue.
               */
              if ((action as Bag).type === 'terminal/exited') {
                dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
                // A command that ran in this session's directory may have moved
                // it: a commit, a checkout, or anything that wrote a file.
                const ranIn = dirOfFile(asked);
                if (ranIn !== undefined) void refreshWatched(ranIn);
              }
            },
          });
          terminals.set(uri, terminal);
          void fire({ type: 'terminal_open', terminal: uri, cwd: asked });
          log(`opened ${uri} in ${asked}`);
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
          return {};
        },
        disposeTerminal: async (params) => {
          const uri = String(params.channel ?? '');
          const terminal = terminals.get(uri);
          if (!terminal)
            throw new RpcError(-32008, `No terminal at ${uri}`);
          terminal.close();
          terminals.delete(uri);
          log(`closed ${uri}`);
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
          return {};
        },
        resourceList: async (params) => {
          const uri = String(params.uri ?? '');
          const store = storeFor(uri);
          return { entries: await need(need(store, 'resourceList').list, 'resourceList')(uri, connection.principal) };
        },
        resourceRead: async (params) => {
          const uri = String(params.uri ?? '');
          // The `before` side of an edit is not a file on disk - it is what a
          // file used to be - so the changeset source is asked before the
          // scheme is: it answers only for the URIs it minted, and a scheme a
          // plugin registered is asked after it.
          const own = await options.changes?.read?.(uri);
          if (own) return own;
          return await need(need(storeFor(uri), 'resourceRead').read, 'resourceRead')(
            uri,
            typeof params.encoding === 'string' ? params.encoding : undefined,
            connection.principal,
          );
        },
        /**
         * What kinds of trigger this host understands.
         *
         * Asked before any automation exists, because it is what a client
         * needs to draw the form. A store that schedules nothing answers with
         * no schedule trigger, and the client then offers no cron box - which
         * is better than a box that takes an expression nothing will ever act
         * on.
         */
        listAutomationTriggerDefinitions: async (params) => ({
          items: need(options.automations, 'listAutomationTriggerDefinitions').triggers({
            ...(typeof params.provider === 'string' ? { provider: params.provider } : {}),
            ...(Array.isArray(params.workingDirectories)
              ? { workingDirectories: params.workingDirectories.filter((one): one is string => typeof one === 'string') }
              : {}),
          }),
        }),
        /**
         * Start one now.
         *
         * The session is created here rather than in the store, because only
         * this file knows what a session is - the store is handed a function
         * and gets a URI back. `requestId` is echoed nowhere: the protocol has
         * it so a client can match its own request to the run it gets, and the
         * run URI in the result is that match.
         *
         * The origin is `{ kind: 'manual' }` and nothing else, because that is
         * the whole of `AutomationManualRunOrigin` - it carries no room for
         * who asked, and a run's origin goes on the wire in every catalogue
         * row the automation appears in.
         *
         * Which is why a run pressed here is the automation maker's work and
         * not the presser's: the owner rides on the automation and travels
         * with the run, and this origin says only that a person pressed it.
         */
        runAutomation: async (params) => {
          const store = need(options.automations, 'runAutomation');
          const automation = String(params.automation ?? '');
          const run = await store.run(automation, { kind: 'manual' }, startForAutomation);
          if (!run) throw new RpcError(-32001, `No automation at ${automation}, or it is switched off`);
          return { resource: run.resource };
        },
        /**
         * A token for something this host advertised.
         *
         * Held against this connection and nowhere else: the specification is
         * explicit that authentication status is per connection, each client
         * authenticating independently, which is also why it is a command and
         * a notification rather than anything in root state.
         *
         * The resource is checked against what was advertised because the
         * protocol requires it to match, and because the alternative is a host
         * that accepts credentials for things it has never heard of. An
         * unknown one is `-32602`: it is a bad parameter, not a demand to
         * authenticate, and answering `-32007` would send a client round a
         * loop it cannot get out of.
         *
         * The token itself is not verified. This host has no way to ask
         * Anthropic whether a key is good without spending a request on the
         * question, and a session started with a bad one fails saying so.
         */
        authenticate: async (params) => {
          const resource = String(params.resource ?? '');
          const token = String(params.token ?? '');
          /*
           * A backend's own resource, or one of its MCP servers'.
           *
           * The second kind is advertised on a server's `authRequired` state
           * rather than on the agent, and is just as much a resource this host
           * named - the protocol's rule is that a client's `resource` matches
           * one the server advertised, and both of these are.
           */
          const waiting = [...sessions.values()]
            .flatMap((held) => [...held.chats.values()])
            .filter((chat) => chat.awaiting?.().includes(resource) === true);
          if (waiting.length === 0 && !advertised().has(resource)) {
            throw new RpcError(-32602, `${resource || 'That'} is not a resource this host advertises`);
          }
          /*
           * An empty token takes the credential back.
           *
           * The protocol says so beside `expiresIn` - "when `token` is empty
           * to revoke authentication" - and the reference host deletes what
           * it held on one. This answered `-32602`, which left a client that
           * had signed out with no way to say so: its next session here would
           * have started on a credential it no longer meant to lend. Nothing
           * running is told; a token is spent at start, and what is already
           * running has it in its environment and no way to give it back.
           */
          if (token === '') {
            const had = connection.tokens.delete(resource);
            forgetExpiry(resource);
            const signedOut = options.users !== undefined && resource === loginId()
              && connection.principal !== undefined && connection.root !== true;
            if (signedOut) {
              delete connection.principal;
              delete connection.principalUntil;
            }
            log(`${connection.clientId || 'a client'} ${had ? 'revoked' : 'had no'} token for ${resource}${signedOut ? ' and signed out' : ''}`);
            return {};
          }
          /*
           * How long it is good for, if the client knows.
           *
           * Seconds, a positive integer, already less the time since the
           * authorization server answered - the protocol puts the subtraction
           * on the client. Anything else is a bad parameter rather than a
           * token with no expiry: a client that sent `0` or `-1` meant
           * something, and taking it as "forever" is the opposite of it.
           */
          const expiresIn = params.expiresIn;
          if (expiresIn !== undefined && !(typeof expiresIn === 'number' && Number.isInteger(expiresIn) && expiresIn > 0)) {
            throw new RpcError(-32602, 'expiresIn must be a positive integer of seconds');
          }
          /*
           * The deployment's own key needs no credential.
           *
           * A socket on it is already the host, so signing in here could only
           * demote it and signing out could only lose the key - decision
           * `the-door-token-is-the-host`. Answered as accepted and otherwise
           * ignored, because the client asked for something that is already so.
           */
          if (connection.root === true && options.users !== undefined && resource === loginId()) return {};
          /*
           * The host's own resource: the one credential here that is checked.
           *
           * Every other token is a backend's or an MCP server's, held
           * unverified and spent elsewhere, which is what the block below
           * still does. This one is a person, and the directory is the only
           * thing that can say whether the token belongs to one.
           */
          if (options.users !== undefined && resource === loginId()) {
            const held = await options.users.verify(token);
            if (held === undefined) {
              throw new RpcError(-32007, 'That credential is not one this host knows', {
                resources: [options.users.resource],
              });
            }
            // The clock this replaces, stopped before a second one is armed:
            // signing in again is the same thing to this resource that a
            // replaced token is to any other, and the path below forgets that
            // one for the same reason.
            /*
             * A client id is the first person's who signed in under it, and
             * nobody else signs in under it: the id is who a published
             * resource is routed to. `InitializeResult` carries no client id,
             * so the connection cannot be handed another one.
             */
            const holder = holders.get(connection.clientId);
            if (holder !== undefined && holder !== held.id) {
              throw new RpcError(-32003, `${connection.clientId} is another person's client id here; connect under one of your own`);
            }
            forgetExpiry(resource);
            connection.principal = held;
            principals.set(`user:${held.id}`, held);
            if (ownId(connection.clientId)) holders.set(connection.clientId, held.id);
            if (expiresIn !== undefined) {
              connection.principalUntil = Date.now() + expiresIn * 1000;
              expire(resource);
            }
            else delete connection.principalUntil;
            // A person's id rather than the clientId, which is the thing about
            // this connection that was actually checked.
            void fire({ type: 'authenticated', client: held.id, resource });
            log(`${held.id} signed in${expiresIn !== undefined ? `, for ${expiresIn}s` : ''}`);
            return {};
          }
          /*
           * Applied where it belongs, rather than only remembered.
           *
           * A token for an MCP server is that server's `Authorization` header
           * and nothing else's; a token for a backend is a credential its next
           * session starts with. The first takes effect now, on the sessions
           * that were waiting for it.
           */
          for (const chat of waiting) void chat.authenticated?.(resource, token);
          forgetExpiry(resource);
          connection.tokens.set(resource, {
            token,
            ...(expiresIn !== undefined ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
          });
          void fire({ type: 'authenticated', client: connection.clientId || 'anonymous', resource });
          if (expiresIn !== undefined) expire(resource);
          log(`${connection.clientId || 'a client'} authenticated for ${resource}${expiresIn !== undefined ? `, for ${expiresIn}s` : ''}`);
          // A GitHub token is a reason to ask GitHub again: a lookup that
          // answered nothing as nobody may answer as this person.
          if (resource === String(options.github?.resource.resource ?? '')) {
            for (const dir of browsable()) {
              void refreshPullRequests(dir).then((moved) => { if (moved) metaMoved(dir); }).catch(() => {});
            }
          }
          return {};
        },
        /** A page of what one automation has done, newest first. */
        fetchAutomationRuns: async (params) => need(options.automations, 'fetchAutomationRuns').runs(
          String(params.automation ?? ''),
          typeof params.cursor === 'string' ? params.cursor : undefined,
        ),
        /**
         * Tell me when that changes.
         *
         * The client gets a channel back and subscribes to it; there is no
         * dispose command, and the last `unsubscribe` is what releases the
         * watcher. Gated the way `resourceRead` is rather than the way a write
         * is: watching is a read, and a client already able to read a
         * directory learns nothing new by being told when it moved.
         */
        createResourceWatch: async (params) => {
          const uri = String(params.uri ?? '');
          const store = need(storeFor(uri), 'createResourceWatch');
          const start = need(store.watch, 'createResourceWatch');
          const items = (value: unknown): string[] => {
            const held = (typeof value === 'object' && value !== null ? value : {}) as { items?: unknown };
            return Array.isArray(held.items) ? held.items.filter((one): one is string => typeof one === 'string') : [];
          };
          const recursive = params.recursive === true;
          const excludes = items(params.excludes);
          const includes = items(params.includes);
          const channel = `ahp-resource-watch:/${crypto.randomUUID()}`;
          const watcher = await start.call(store, uri, { recursive, excludes, includes }, (changes) => {
            // Only if it still exists: a batch can be in flight when the last
            // subscriber leaves, and dispatching to a released channel is a
            // client being told about a watch it has forgotten.
            if (!watches.has(channel)) return;
            dispatch(channel, { type: 'resourceWatch/changed', changes: { items: changes } });
          });
          watches.set(channel, {
            watcher,
            owner: connection,
            opened: false,
            state: {
              root: uri,
              recursive,
              ...(excludes.length > 0 ? { excludes: { items: excludes } } : {}),
              ...(includes.length > 0 ? { includes: { items: includes } } : {}),
            },
          });
          log(`${connection.clientId} is watching ${uri}${recursive ? ' and under it' : ''}`);
          return { channel };
        },
        /*
         * The write half of `resource*`.
         *
         * Every one takes the same gate, and it is the store's: the path is
         * checked there, because only it knows what a path means - and it
         * resolves the parent rather than the target, so a symlink pointing
         * out of the served set cannot be written through.
         *
         * `need` twice, because there are two ways not to have this: a host
         * given no `resources` port at all, and one given a store that only
         * reads. Both answer `-32601`, which is what the protocol has for a
         * method that is not here, and neither is a refusal about a path.
         */
        resourceWrite: async (params) => {
          const uri = String(params.uri ?? '');
          const encoding = params.encoding === 'base64' ? 'base64' as const : 'utf-8' as const;
          /*
           * Whose the write is, handed on to the store.
           *
           * The `file:` store has no use for it. A plugin's scheme may: what a
           * write makes is sometimes charged to whoever asked, and a machine
           * made by a `computer:` write is up from then on - decision
           * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`.
           */
          const owner = ownerFor(connection);
          await need(need(storeFor(uri), 'resourceWrite').write, 'resourceWrite')(uri, {
            data: String(params.data ?? ''),
            encoding,
            /*
             * Checked rather than cast, and it changes no behaviour.
             *
             * A client's string used to go straight into a field the rest of
             * this codebase reads as one of three words, so `mode: 'overwrite'`
             * reached the store typed as something it was not. The store's
             * fallback happens to be `truncate`, so nothing was ever visibly
             * wrong - which is the whole reason it survived. This is the same
             * defect as a hand-copied vocabulary, one layer in: a value the
             * compiler believes is a `WriteMode` and is not.
             */
            ...(WRITE_MODES.includes(String(params.mode)) ? { mode: String(params.mode) as WriteMode } : {}),
            ...(typeof params.position === 'number' ? { position: params.position } : {}),
            ...(params.createOnly === true ? { createOnly: true } : {}),
            ...(typeof params.ifMatch === 'string' ? { ifMatch: params.ifMatch } : {}),
          }, owner);
          void fire({ type: 'resource_write', uri });
          log(`${connection.clientId} wrote ${uri}`);
          wroteThrough(uri);
          return {};
        },
        resourceDelete: async (params) => {
          const uri = String(params.uri ?? '');
          await need(need(storeFor(uri), 'resourceDelete').remove, 'resourceDelete')(
            uri, params.recursive === true,
          );
          log(`${connection.clientId} removed ${uri}`);
          wroteThrough(uri);
          return {};
        },
        resourceMkdir: async (params) => {
          const uri = String(params.uri ?? '');
          await need(need(storeFor(uri), 'resourceMkdir').mkdir, 'resourceMkdir')(uri);
          wroteThrough(uri);
          return {};
        },
        /*
         * Both ends are the store's business, including the source.
         *
         * The source is emptied and the destination is filled, so a store that
         * can write one and not the other refuses the half it cannot do. A
         * `copy` reads the source, which the read half already allows inside a
         * served directory.
         *
         * Two different schemes are refused rather than attempted: neither
         * provider could carry out the other's half, which is the same answer
         * two different clients already get for a cross-client move.
         */
        resourceMove: async (params) => {
          const source = String(params.source ?? '');
          const destination = String(params.destination ?? '');
          const held = storeFor(source);
          if (held !== storeFor(destination)) throw new RpcError(-32602, `${source} and ${destination} are served by different providers`);
          await need(need(held, 'resourceMove').move, 'resourceMove')(
            source, destination, params.failIfExists === true,
          );
          log(`${connection.clientId} moved ${source} to ${destination}`);
          wroteThrough(source);
          wroteThrough(destination);
          return {};
        },
        resourceCopy: async (params) => {
          const source = String(params.source ?? '');
          const destination = String(params.destination ?? '');
          const held = storeFor(destination);
          if (storeFor(source) !== held) throw new RpcError(-32602, `${source} and ${destination} are served by different providers`);
          await need(need(held, 'resourceCopy').copy, 'resourceCopy')(
            source, destination, params.failIfExists === true,
          );
          wroteThrough(destination);
          return {};
        },
        /**
         * May I read this, may I write it.
         *
         * The negotiated form of the question, and a client that asks is told
         * yes for any `file:` URI, the way the reference host answers it:
         * there is no person at a daemon to prompt, and the connection token
         * has already decided who may be here.
         *
         * It grants nothing, because there is nothing left to grant: the write
         * half is served to any connection, and the read half always was. The
         * answer is kept because the protocol has the method and a client that
         * asks deserves the same answer the reference gives, and the ask is
         * logged so a host operator can see it.
         */
        resourceRequest: async (params) => {
          const uri = String(params.uri ?? '');
          if (!uri.startsWith('file://')) throw new RpcError(-32009, `This host does not mediate ${uri}`);
          // Neither flag is a read, which is what the protocol tells receivers
          // to make of a request that sets nothing.
          const write = params.write === true;
          log(`${connection.clientId} may ${write ? 'write' : 'read'} ${uri}`);
          return {};
        },
        /**
         * Run one of the verbs a changeset advertised.
         *
         * Three gates, and none of them is a flag on this host: the id has to
         * be one this changeset offers *now*, the target has to be a kind that
         * operation accepts, and the session must not be mid-turn. The list is
         * the access model - a client can invoke nothing that was not already
         * put in front of it. An operation that writes is not gated on a
         * `resourceRequest`, because the resource half is not either.
         */
        invokeChangesetOperation: async (params) => {
          const channel = String(params.channel ?? '');
          const at = changesetAt(channel);
          if (!at) throw new RpcError(-32001, `No changeset at ${channel}`);
          const source = need(options.changes, 'invokeChangesetOperation');
          const operationId = String(params.operationId ?? '');
          const context = operationContext(at.owner, at.dir);
          const offered = (source.operations?.(at.dir, at.owner, at.scope, context) ?? [])
            .find((one) => one.id === operationId);
          if (!offered)
            throw new RpcError(-32602, `No operation called ${operationId} on ${channel}`);

          const raw = params.target as Record<string, unknown> | undefined;
          const target = raw !== undefined && typeof raw === 'object'
            ? {
              kind: raw.kind === 'range' ? 'range' as const : 'resource' as const,
              resource: String(raw.resource ?? ''),
              ...(raw.side === 'before' || raw.side === 'after' ? { side: raw.side as 'before' | 'after' } : {}),
              ...(typeof raw.range === 'object' && raw.range !== null
                ? { range: raw.range as { startLine: number; endLine: number } }
                : {}),
            }
            : undefined;
          // No target is the changeset itself, which is how the protocol says
          // a changeset-scoped invocation.
          const kind = target?.kind ?? 'changeset';
          if (!offered.scopes.includes(kind))
            throw new RpcError(-32602, `${operationId} cannot be invoked on a ${kind}`);

          // Refused rather than queued. The agent is writing to this tree, and
          // an operation that rewrote a file underneath it would be racing the
          // thing whose work the changeset is about.
          // `-32004`, which the protocol has for exactly this: the operation
          // requires no active turn and there is one. `-32002` is
          // `ProviderNotFound`, so a client branching on the code was told to
          // try another provider when what it should do is wait.
          if ((statusOf(at.owner) & Status.InProgress) !== 0)
            throw new RpcError(-32004, `${at.owner} is mid-turn`);

          const key = opKey(channel, operationId);
          inFlight.add(key);
          lastError.delete(key);
          dispatch(channel, { type: 'changeset/operationStatusChanged', operationId, status: 'running' });
          try {
            const meta = typeof params._meta === 'object' && params._meta !== null ? params._meta as Record<string, unknown> : undefined;
            const result = await need(source.invoke, 'invokeChangesetOperation').call(source, {
              ...context,
              dir: at.dir,
              session: at.owner,
              scope: at.scope,
              operationId,
              ...(target !== undefined ? { target } : {}),
              ...(meta !== undefined ? { meta } : {}),
            });
            inFlight.delete(key);
            dispatch(channel, { type: 'changeset/operationStatusChanged', operationId, status: 'idle' });
            // Before the refresh, so GitHub's later answer is what survives.
            if (result.pullRequest !== undefined) recordPullRequest(at.owner, at.dir, result.pullRequest);
            // Something wrote to the tree, so every changeset of this session
            // is now describing a directory that has moved. The catalogue
            // first, because `refresh` is what makes the next read fresh.
            refreshFacts(at.dir);
            await options.changes?.refresh?.(at.dir).catch(() => false);
            await contentMoved(at.owner);
            return {
              ...(result.message !== undefined ? { message: result.message } : {}),
              // What the operation produced, when it produced something worth
              // opening. A pull request a push made is the case: the operation
              // succeeded, and the useful part of it is a page somewhere.
              ...(result.followUp !== undefined ? { followUp: result.followUp } : {}),
            };
          }
          catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            inFlight.delete(key);
            lastError.set(key, message);
            dispatch(channel, {
              type: 'changeset/operationStatusChanged',
              operationId,
              status: 'error',
              error: { message },
            });
            log(`${operationId} on ${channel} failed: ${message}`);
            // With the source's code and data when it chose them: a refusal
            // the reference client branches on is more than its message.
            const chosen = error as { code?: unknown; data?: unknown };
            if (typeof chosen.code === 'number') throw new RpcError(chosen.code, message, chosen.data);
            throw new RpcError(INTERNAL_ERROR, message);
          }
        },
        resourceResolve: async (params) => {
          const uri = String(params.uri ?? '');
          return await need(need(storeFor(uri), 'resourceResolve').resolve, 'resourceResolve')(
            uri,
            params.followSymlinks !== false,
          );
        },
        /**
         * Start one.
         *
         * The **client** chooses the URI and sends it as `channel` - which is
         * what makes the session addressable before this host has answered, so
         * the client can subscribe to it without a round trip in between.
         *
         * Held as `<provider>:/<id>`, with the id from the client's URI, which
         * is the name a listed session has and the one VS Code routes on. The
         * client's own URI stays a name for it: `heldAs` resolves it and a
         * connection subscribed under it is answered in its spelling -
         * decision `a-session-is-held-under-its-providers-name`.
         */
        createSession: async (params) => {
          if (ctx.closed) throw new RpcError(INTERNAL_ERROR, CLOSING);
          const given = named(String(params.channel ?? ''), 'session');
          const provider = String(params.provider ?? first.provider);
          const uri = `${provider}:/${idOf(given)}`;
          unheld(uri, given);
          /*
           * Both names, claimed before anything is made for the session, so a
           * second creation of either while this one waits on a worktree or
           * a machine is refused; let go again unless the session was made.
           */
          const pending: Claimed = { kind: 'session', of: uri };
          for (const one of new Set([uri, given])) claims.set(one, pending);
          const release = (): void => {
            for (const one of [uri, given]) if (claims.get(one) === pending) claims.delete(one);
          };
          try {
            const config = (typeof params.config === 'object' && params.config !== null
              ? params.config
              : {}) as Record<string, string>;
            /*
             * Where the client asked the agent to work.
             *
             * A list on the wire and one directory to a session, so the first is
             * the answer. `file://` comes off: everything below here deals in
             * paths, and a backend handed a URI would open a directory called
             * `file:`.
             */
            const wanted = (Array.isArray(params.workingDirectories) ? params.workingDirectories : [])
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.replace(/^file:\/\//, ''));
            const asked = wanted[0];
            const where = asked;
            // The peers of the first, which the protocol says are equal to each
            // other and to it in everything but which one the process is rooted
            // at. A backend that cannot take them is told none.
            const peers = agents.get(provider)?.multipleDirectories === true ? wanted.slice(1) : [];
            /*
             * The worktree, before anything is started in it.
             *
             * Made first because the backend is handed a directory and expected
             * to work in it: a session opened in the folder and then moved would
             * be an agent whose files changed under it. A failure here is a
             * session that never existed, which is the right outcome - the
             * alternative is one running somewhere the person did not choose.
             */
            /*
             * How far along, for the one thing here that takes visible time.
             *
             * `root/progress` echoes the `progressToken` the request carried, so
             * it is sent only when the client asked for one - and only to the
             * client that asked, because the token is that request's and means
             * nothing to anybody else. Making a worktree is `git worktree add`
             * plus a copy of whatever the client asked to bring along, which on
             * a large repository is seconds a person otherwise waits through
             * with nothing on screen.
             */
            const token = typeof params.progressToken === 'string' ? params.progressToken : undefined;
            const along = (progress: number, message: string): void => {
              if (token === undefined) return;
              connection.peer.notify('root/progress', { channel: ROOT, progressToken: token, progress, total: 2, message });
            };
            along(0, config.isolation === 'worktree' ? 'Making a working tree' : 'Starting the session');
            const running = await isolated(uri, config, where);
            along(1, 'Starting the agent');
            await settle(uri, where, config, connection.principal);
            /*
             * Checked before the machine is made, so a refused session makes
             * none, against the computer the client asked for and the scope the
             * session is charged to.
             */
            const refused = await admitted(connection.principal, charged.get(uri)?.scope, config, provider, uri, ownerFor(connection));
            if (refused !== undefined) throw new RpcError(-32009, refused);
            // A `disposable:<profile>` setting is a machine made for this
            // session, with this harness's needs and this folder, before the
            // backend is started with it.
            await placedIn(uri, provider, config, running, ownerFor(connection));
            // This connection's tokens and no other's. A client that pushed
            // nothing gets a session on the daemon's own credentials, which is
            // how every session worked before there was anything to push.
            // Handed over, since `openSession` refuses a name this still holds.
            release();
            // Whose this is: this connection's person, kept beside the session
            // so a scope change before the first turn is resolved against who
            // owns the work rather than against whoever sent it.
            openSession(uri, provider, backendsOwn(config), running, undefined, tokensFor(provider), peers, undefined,
              forWhom(ownerFor(connection), connection.principal));
            if (!claims.has(given)) claims.set(given, { kind: 'session', of: uri });
            // Complete, which the protocol spells as `progress === total`.
            along(2, 'Ready');
            /*
             * The creator claiming its place in the session it just made.
             *
             * The protocol's own words: "equivalent to dispatching a
             * `session/activeClientSet` immediately after creation". Answered
             * here rather than left to that dispatch because it saves the round
             * trip the field exists to save, and because a client that has to
             * announce itself afterwards owns a session that is briefly empty
             * of it.
             *
             * The `clientId` is this connection's, not the one in the payload.
             * The protocol says the two MUST match, and forcing it is what the
             * dispatch path does for the same reason: a client naming somebody
             * else is announcing a presence that is not theirs.
             */
            const claimed = typeof params.activeClient === 'object' && params.activeClient !== null
              ? params.activeClient as Bag
              : undefined;
            if (claimed !== undefined) {
              const clientId = connection.clientId || 'anonymous';
              const activeClient: Bag = {
                ...claimed,
                clientId,
                tools: Array.isArray(claimed.tools) ? claimed.tools : [],
              };
              const here = presence.get(idOf(uri)) ?? new Map<string, Bag>();
              presence.set(idOf(uri), here);
              here.set(clientId, activeClient);
              dispatch(uri, { type: 'session/activeClientSet', activeClient });
              retool(uri);
            }
            return {};
          }
          finally { release(); }
        },
        /**
         * A second conversation in one session.
         *
         * Same backend, same directory, same config - which is what makes the
         * chats peers rather than one being the other's child. `source` is
         * accepted: a `fork` resumes at the turn and seeds the copy from the
         * source transcript, and a `sideChat` copies nothing and carries that
         * turn's text on its first prompt.
         */
        createChat: async (params) => {
          const uri = heldAs(String(params.channel ?? ''));
          const chatUri = String(params.chat ?? '');
          const held = sessions.get(uri);
          if (!held)
            throw new RpcError(-32001, `No agent for session ${uri}`);
          if (idOf(chatUri) === '' || chatUri.indexOf(':') <= 0)
            throw new RpcError(-32602, `${chatUri} is not a chat URI`);
          if (byChat.has(chatUri))
            throw new RpcError(-32003, `${chatUri} already exists`);
          claimable(chatUri, 'chat');
          /*
           * Made out of another chat, when a client asks for that.
           *
           * A fork copies the conversation through one turn and continues it,
           * under an id of its own so the chat it came from is untouched. A
           * side chat copies nothing and is *told* what that turn said - the
           * protocol is explicit that the source transcript stays out of its
           * visible history, so the context rides on its first prompt.
           */
          const source = (typeof params.source === 'object' && params.source !== null
            ? params.source
            : undefined) as { kind?: unknown; chat?: unknown; turnId?: unknown } | undefined;
          let made: { resume?: string; seed?: Bag[]; forkAt?: string; context?: string } | undefined;
          let origin: Bag | undefined;
          if (source !== undefined) {
            const kind = String(source.kind ?? '');
            // The kind first, because it decides whether the rest of the
            // source means anything: an unknown one is a client asking for
            // something this host has never heard of, and saying "no such
            // turn" about it would send somebody looking at the turn.
            if (kind !== 'fork' && kind !== 'sideChat')
              throw new RpcError(-32602, `${kind} is not a chat source this host knows`);
            const from = byChat.get(chatOf(String(source.chat ?? '')));
            if (!from || from.uri !== uri)
              throw new RpcError(-32602, `${String(source.chat ?? '')} is not a chat in ${uri}`);
            const turnId = String(source.turnId ?? '');
            const all = from.chat.allTurns();
            const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
            if (at < 0)
              throw new RpcError(-32602, `${turnId} is not a turn in ${String(source.chat ?? '')}`);
            if (kind === 'fork') {
              if (held.agent.chats?.fork !== true)
                throw new RpcError(-32602, `${held.agent.provider} cannot fork a chat from a turn`);
              // The backend's own name for where that turn ended, which is
              // the only one it can be asked to continue from.
              const point = from.chat.forkPoint?.(turnId);
              const started = from.chat.agentId();
              if (point === undefined || started === undefined)
                throw new RpcError(-32602, `${turnId} is not a turn this host can fork from`);
              made = { resume: started, forkAt: point, seed: all.slice(0, at + 1) as Bag[] };
            }
            else {
              if (held.agent.chats?.sideChat !== true)
                throw new RpcError(-32602, `${held.agent.provider} cannot start a side chat from a turn`);
              const message = (all[at] as Bag | undefined)?.message;
              const said = typeof message === 'object' && message !== null
                ? (message as { text?: unknown }).text
                : undefined;
              made = { context: typeof said === 'string' ? said : '' };
            }
            /*
             * What the new chat says it was made from, kept for as long as it
             * is: the summary is re-sent whole on every change, so an origin
             * given only on `session/chatAdded` would be said once and then
             * overwritten with `user`. A selection is kept as the protocol
             * declares it, and only when it has text.
             */
            const picked = (source as { selection?: unknown }).selection as { text?: unknown; responsePartId?: unknown } | undefined;
            const selection = kind === 'sideChat' && typeof picked === 'object' && picked !== null
              && typeof picked.text === 'string' && picked.text !== ''
              ? { text: picked.text, ...(typeof picked.responsePartId === 'string' ? { responsePartId: picked.responsePartId } : {}) }
              : undefined;
            origin = { kind, chat: chatOf(String(source.chat ?? '')), turnId, ...(selection !== undefined ? { selection } : {}) };
          }
          /*
           * The directories this chat is about, when it is about fewer.
           *
           * The protocol requires every entry to be in the owning session's
           * set: a chat cannot reach anywhere its session cannot, and one that
           * named somewhere else would be asking the host to widen a session
           * through a chat. The first entry is the process root and is the
           * session's, so what a chat chooses among is the peers.
           */
          const asked = (Array.isArray(params.workingDirectories) ? params.workingDirectories : [])
            .filter((one): one is string => typeof one === 'string')
            .map((one) => one.replace(/^file:\/\//, ''));
          const own = [held.workingDirectory, ...(held.additional ?? [])].filter((one) => one !== undefined);
          const stray = asked.find((one) => !own.includes(one));
          if (stray !== undefined)
            throw new RpcError(-32602, `${stray} is not a working directory of ${uri}`);
          const peers = asked.length > 0
            ? asked.filter((one) => one !== held.workingDirectory)
            : held.additional;
          if (asked.length > 0) beside.set(chatUri, peers ?? []);
          const chat = spawn(held.agent, uri, chatUri, backendsOwn(held.config), made, held.workingDirectory, undefined, peers);
          if (origin !== undefined) madeFrom.set(chatUri, origin);
          log(`opened ${chatUri} in ${uri}`);
          // `summary`, not `chat`: the reducer reads `action.summary.resource`,
          // and a chat named any other way arrives as a TypeError inside it.
          dispatch(uri, { type: 'session/chatAdded', summary: chatSummary(uri, chatUri, chat) });
          const first_ = (typeof params.initialMessage === 'object' && params.initialMessage !== null
            ? params.initialMessage
            : undefined) as Record<string, unknown> | undefined;
          if (first_ !== undefined) {
            // No action to refuse here: a first message that cannot run as a
            // command fails the call, which the client shows as the chat not
            // opening with it.
            const refused = await beginOrRun(chat, held.agent.provider, crypto.randomUUID(), String(first_.text ?? ''), undefined, messageFrom(first_), ownerFor(connection));
            if (refused !== undefined) throw new Error(refused);
          }
          return {};
        },
        disposeChat: async (params) => {
          // Either spelling, like `subscribe` and a dispatch.
          const chatUri = chatOf(String(params.channel ?? ''));
          const found = byChat.get(chatUri);
          if (!found)
            throw new RpcError(-32001, `No chat at ${chatUri}`);
          const held = sessions.get(found.uri);
          if (held && held.chats.size === 1) {
            // The last one is the session. Removing it would leave a session
            // with nothing to talk to, which `disposeSession` says properly.
            throw new RpcError(-32602, `${chatUri} is the only chat in ${found.uri}; dispose the session instead`);
          }
          found.chat.close();
          byChat.delete(chatUri);
          drafts.delete(chatUri);
          madeFrom.delete(chatUri);
          ctx.links.forgetChat(chatUri);
          held?.chats.delete(chatUri);
          // And the name this chat was given. The store is what keeps a chat's
          // own title rather than the catalogue's derived one, so a chat that
          // has gone takes its title with it rather than leaving it for a chat
          // opened under that name years from now.
          kept.setChatTitle(idOf(found.uri), chatUri, '');
          if (held && held.defaultChat === chatUri) {
            held.defaultChat = [...held.chats.keys()][0] as string;
            dispatch(found.uri, { type: 'session/defaultChatChanged', defaultChat: held.defaultChat });
          }
          log(`closed ${chatUri}`);
          dispatch(found.uri, { type: 'session/chatRemoved', chat: chatUri });
          return {};
        },
        disposeSession: async (params) => {
          removeSession(heldAs(String(params.channel ?? '')));
          return {};
        },
        /**
         * A pill's close button.
         *
         * The reference client's own request, outside the protocol, behind
         * `_meta['vscode.removeSessionArtifact']` in `initialize`: a person
         * taking off what the agent recorded, without a turn to say so in.
         * `session` names the session, `artifactId` the entry; an id nobody
         * has is nothing to do, the way the reference host answers it.
         */
        /**
         * A handle on a session's worktree, for the window that manages it.
         *
         * The reference host makes the tree here, ahead of the session, from
         * the prompt; this host made it when the session was created, so the
         * answer is that tree and `prompt` has nothing left to name. A
         * session with no tree is not one the window can hold a handle on,
         * and says so in the reference host's words.
         */
        'vscode/createAgentHostDetachedWorktree': async (params) => {
          if (typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
          if (typeof params.prompt !== 'string') throw new RpcError(-32602, 'prompt must be a string');
          const uri = sessionFor(params.session);
          const tree = worktrees.get(uri);
          if (tree === undefined) {
            throw new RpcError(-32602, sessions.has(uri)
              ? `Session is not configured for worktree isolation: ${params.session}`
              : `Session not found: ${params.session}`);
          }
          const handle = crypto.randomUUID();
          const now = Date.now();
          detached.set(handle, {
            session: uri,
            repository: tree.repository,
            path: tree.path,
            ...(tree.branch !== undefined ? { branch: tree.branch } : {}),
            claimed: false,
            archived: false,
            createdAt: now,
            lastSeenAt: now,
          });
          log(`${connection.clientId || 'a client'} holds ${handle} on ${tree.path}`);
          return { handle, resource: `file://${tree.path}` };
        },
        /** The session started in the tree: the handle is in use, and stays until the window lets go. */
        'vscode/claimAgentHostDetachedWorktree': async (params) => {
          const handle = String(params.handle ?? '');
          const held = detached.get(handle);
          if (held === undefined) throw new RpcError(-32602, `Unknown detached worktree handle: ${handle}`);
          held.claimed = true;
          held.lastSeenAt = Date.now();
          return {};
        },
        /**
         * Archived is the tree taken down, and the branch kept so it can
         * come back; unarchived is the tree put back on that branch.
         *
         * Not while a session is running in it, and not with work nobody
         * committed in it - the same two judgements a disposal makes. A
         * handle nobody holds is nothing to do, the way the reference host
         * answers it.
         */
        'vscode/setAgentHostDetachedWorktreeArchived': async (params) => {
          const handle = String(params.handle ?? '');
          const archived = params.archived === true;
          const held = detached.get(handle);
          if (held === undefined) return {};
          held.archived = archived;
          const port = options.worktrees;
          if (port === undefined) return {};
          const present = await stat(held.path).then(() => true, () => false);
          if (archived) {
            if (!present) return {};
            if (sessions.has(held.session)) {
              log(`kept ${held.path}: ${held.session} is running in it`);
              return {};
            }
            if (await port.dirty(held.path).catch(() => true)) {
              log(`kept ${held.path}: it has changes nobody committed`);
              return {};
            }
            await port.remove(held.repository, held.path)
              .then(() => { log(`removed ${held.path} for the archived ${handle}`); })
              .catch((error: unknown) => { log(`kept ${held.path}: ${error instanceof Error ? error.message : String(error)}`); });
            return {};
          }
          if (held.branch === undefined || present) return {};
          await port.create({ repository: held.repository, base: held.branch, path: held.path })
            .then(() => { log(`put ${held.path} back on ${held.branch ?? ''} for ${handle}`); })
            .catch((error: unknown) => { log(`could not put ${held.path} back: ${error instanceof Error ? error.message : String(error)}`); });
          return {};
        },
        /** The window is done with the tree: gone, branch and all, unless a session is still in it. */
        'vscode/deleteAgentHostDetachedWorktree': async (params) => {
          const handle = String(params.handle ?? '');
          const held = detached.get(handle);
          if (held === undefined) return {};
          if (sessions.has(held.session)) throw new RpcError(-32004, `${held.session} is running in ${held.path}; dispose the session first`);
          detached.delete(handle);
          worktrees.delete(held.session);
          // Already gone with its session, which is the ordinary order of things.
          if (!await stat(held.path).then(() => true, () => false)) return {};
          await options.worktrees?.remove(held.repository, held.path, held.branch)
            .then(() => { log(`removed ${held.path} for ${handle}`); })
            .catch((error: unknown) => {
              throw new RpcError(INTERNAL_ERROR, `Could not remove ${held.path}: ${error instanceof Error ? error.message : String(error)}`);
            });
          return {};
        },
        /**
         * The set the window still knows about, under one scope.
         *
         * A handle it names is seen again; one it does not name, in that
         * scope, is let go once the grace has passed - the tree removed when
         * it is clean and nobody is in it, and kept when either is not so. A
         * scope is the repository the trees were made from, or the tree's
         * own path, since the reference client's spelling of it is its own.
         */
        'vscode/reconcileAgentHostDetachedWorktrees': async (params) => {
          const scope = String(params.scope ?? '').replace(/^file:\/\//, '').replace(/\/$/, '');
          const active = new Set(Array.isArray(params.activeHandles) ? params.activeHandles.map(String) : []);
          const now = Date.now();
          for (const [handle, held] of detached) {
            if (held.repository !== scope && held.path !== scope) continue;
            if (active.has(handle)) {
              held.lastSeenAt = now;
              continue;
            }
            if (now - (held.claimed ? held.lastSeenAt : held.createdAt) < DETACHED_GRACE) continue;
            detached.delete(handle);
            if (sessions.has(held.session)) continue;
            const port = options.worktrees;
            if (port === undefined || await port.dirty(held.path).catch(() => true)) continue;
            worktrees.delete(held.session);
            await port.remove(held.repository, held.path, held.branch)
              .then(() => { log(`removed ${held.path}: the window let ${handle} go`); })
              .catch((error: unknown) => { log(`kept ${held.path}: ${error instanceof Error ? error.message : String(error)}`); });
          }
          return {};
        },
        'vscode/removeSessionArtifact': async (params) => {
          const session = String(params.session ?? '');
          const artifactId = String(params.artifactId ?? '').trim();
          if (session === '' || artifactId === '') throw new RpcError(-32602, 'session and artifactId must be non-empty strings');
          const uri = sessions.has(session) ? session : sessionFor(session);
          const held = kept.artifacts(idOf(uri)) ?? [];
          const left = held.filter((one) => one.id !== artifactId);
          if (left.length !== held.length) setArtifacts(uri, left);
          return {};
        },
        /**
         * Where the backend's own record of a session is.
         *
         * The window's "open session state file", behind
         * `_meta['vscode.getAgentHostSessionStateFile.chat']` in `initialize`
         * since it names a chat as well as a session. A backend that writes
         * no such file answers no resource, which is the reference host's
         * answer too.
         */
        'vscode/getAgentHostSessionStateFile': async (params) => {
          if (typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
          if (params.chat !== undefined && typeof params.chat !== 'string') throw new RpcError(-32602, 'chat must be a URI string');
          const found = stateFileOf(params.session, params.chat);
          return found === undefined ? {} : { resource: `file://${found}` };
        },
        /**
         * The logs, packed up for a bug report.
         *
         * The host's own files under `agenthost/`, and the session's record
         * as `events.jsonl` when a session is named - the names the reference
         * host's collector gives them, so the window reads the result the
         * same. The archive is read back in chunks; the directory is opened
         * where it is.
         */
        'vscode/collectAgentHostDebugLogs': async (params) => {
          const kind = params.kind;
          if (kind !== 'archive' && kind !== 'directory') throw new RpcError(-32602, 'kind must be archive or directory');
          if (params.session !== undefined && typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
          if (params.chat !== undefined && typeof params.chat !== 'string') throw new RpcError(-32602, 'chat must be a URI string');
          if (params.chat !== undefined && params.session === undefined) throw new RpcError(-32602, 'chat must belong to the requested Agent Session');
          const files: LogFile[] = (options.diagnostics?.logs?.() ?? []).map((file) => ({ path: hostLogPath(file), from: file }));
          const record = params.session === undefined ? undefined : stateFileOf(params.session, params.chat);
          if (record !== undefined) files.push({ path: 'events.jsonl', from: record, provider: true });
          return await logs.collect(files, kind);
        },
        'vscode/readAgentHostDebugLogsChunk': async (params) => {
          if (typeof params.resource !== 'string') throw new RpcError(-32602, 'resource must be a URI string');
          if (typeof params.position !== 'number') throw new RpcError(-32602, 'position must be a number');
          try { return await logs.read(params.resource, params.position); }
          catch (error) { throw new RpcError(-32602, error instanceof Error ? error.message : String(error)); }
        },
        /**
         * The four the window asks of its own host about itself.
         *
         * `shutdown` answers first and stops after, so the window hears yes
         * rather than a dropped socket. The network diagnostics are what the
         * process can see - the proxy variables, and the endpoints its
         * backends name - and `diagnosticsFetch` tries one. Managed settings
         * are a policy layer this host has no counterpart to, and an empty
         * list is the honest shape of that.
         */
        shutdown: async () => {
          const stop = options.diagnostics?.shutdown;
          if (stop === undefined) throw new RpcError(METHOD_NOT_FOUND, 'This host does not serve shutdown');
          setTimeout(() => { void Promise.resolve(logs.close()).then(() => stop()); }, 0);
          return {};
        },
        getNetworkDiagnosticsInfo: async () => {
          const proxyEnv: Record<string, string> = {};
          for (const key of PROXY_ENV) {
            const value = process.env[key];
            if (value) proxyEnv[key] = value;
          }
          const endpoints = [...agents.values()].flatMap((agent) => agent.endpoints?.() ?? []);
          if (options.github !== undefined) endpoints.push({ name: 'GitHub API', url: 'https://api.github.com/' });
          return {
            version: options.diagnostics?.version ?? '0.0.1',
            os: process.platform,
            arch: process.arch,
            proxySettings: {},
            proxyEnv,
            endpoints,
          };
        },
        getManagedSettingsDiagnostics: async () => [],
        diagnosticsFetch: async (params) => {
          if (typeof params.url !== 'string') throw new RpcError(-32602, 'url must be a string');
          let target: URL;
          try { target = new URL(params.url); }
          catch { throw new RpcError(-32602, `${params.url} is not a URL`); }
          const [dnsIpv4, dnsIpv6] = await Promise.all([resolved(target.hostname, 4), resolved(target.hostname, 6)]);
          const began = Date.now();
          try {
            const answer = await fetch(target, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
            const body = await answer.text();
            return {
              url: params.url, dnsIpv4, dnsIpv6,
              statusCode: answer.status, statusMessage: answer.statusText,
              body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body,
              durationMs: Date.now() - began,
            };
          }
          catch (error) {
            return { url: params.url, dnsIpv4, dnsIpv6, error: reason(error), durationMs: Date.now() - began };
          }
        },
        /*
         * The dev container surface, name for name.
         *
         * The reference client asks these four, and it reads the capability key
         * on `initialize` before it offers the flow at all, so the names and
         * the shapes are another program's on purpose - decision
         * `the-relay-surface-is-the-reference-one`. What crosses here is a
         * nested host's own frames: this host carries them and does not read
         * them, which is what makes the container the container's and not
         * this host's pretending to be there.
         */
        'vscode/devContainers/isDockerAvailable': async () =>
          need(options.containers, 'vscode/devContainers/isDockerAvailable').docker(),
        'vscode/devContainers/connect': async (params) => {
          const launcher = need(options.containers, 'vscode/devContainers/connect');
          const one = containerAsk(params);
          if (containers.has(one.connectionId)) {
            throw new RpcError(-32602, `Dev Container connectionId ${one.connectionId} is already in use`);
          }
          // Held before the first await, so a second connect under the same
          // name cannot slip in while this one is building an image.
          containers.set(one.connectionId, { name: one.name, folder: one.workspaceFolder, tail: [] });
          /*
           * A starting line, because "asked for" and "never asked" otherwise
           * look the same in this log: the only other thing written about a
           * container is its ending, and by then the question has moved on.
           */
          log(`dev container ${one.connectionId} starting in ${one.workspaceFolder}`);
          /**
           * The relay ended, whoever ended it.
           *
           * The map is what says whether this connection still owns it: an
           * explicit `disconnect` forgets the name first, so the client that
           * asked is not told what it already knows.
           */
          const ended = (why?: string): void => {
            const held = containers.get(one.connectionId);
            if (!containers.delete(one.connectionId)) return;
            connection.peer.notify('vscode/devContainers/relayClose', { connectionId: one.connectionId });
            connection.peer.notify('vscode/devContainers/closeConnection', { connectionId: one.connectionId });
            if (why !== undefined && why !== '') {
              /*
               * The launcher's own last words, which are usually the reason.
               *
               * `ended: exit 1` was all this said, and the cause - a path that
               * does not exist inside the container, an install that failed -
               * was sent only to whichever client happened to be watching.
               */
              const tail = (held?.tail ?? []).filter((line) => line.trim() !== '').slice(-8);
              log(`dev container ${one.connectionId} ended: ${why}${
                tail.length === 0 ? '' : `\n  ${tail.join('\n  ')}`}`);
            }
          };
          const sink: ContainerSink = {
            message: (data) => {
              connection.peer.notify('vscode/devContainers/relayMessage', { connectionId: one.connectionId, data });
            },
            output: (data) => {
              connection.peer.notify('vscode/devContainers/output', { connectionId: one.connectionId, data });
              // Kept for an ending to explain itself, bounded so a long build
              // cannot grow the daemon's memory with output nobody will read.
              const held = containers.get(one.connectionId);
              if (held === undefined) return;
              for (const line of String(data).split('\n')) {
                if (line.trim() !== '') held.tail.push(line);
              }
              if (held.tail.length > CONTAINER_TAIL) {
                held.tail.splice(0, held.tail.length - CONTAINER_TAIL);
              }
            },
            close: (why) => { ended(why); },
          };
          let result: ContainerConnectResult;
          try {
            /*
             * Whose the container is, which the client cannot say.
             *
             * The connection is the whole of the answer: a person who has signed
             * in owns what their relay runs, and a connection the host made for
             * itself is the host - decision
             * `a-relay-container-is-owned-by-who-connected`.
             */
            const owner = ownerFor(connection);
            result = await launcher.connect(owner === undefined ? one : { ...one, owner }, sink);
            log(`dev container ${one.connectionId} up: ${result.address} (${result.remoteWorkspaceFolder})`);
          }
          catch (error) {
            // Nothing left running: the launcher is told to release whatever it
            // had begun, and the name is free again.
            containers.delete(one.connectionId);
            try { await launcher.disconnect(one.connectionId); } catch { /* already gone */ }
            log(`dev container ${one.connectionId} failed: ${reason(error)}`);
            throw error;
          }
          if (!alive) {
            // The client went while the image was building. Its containers are
            // not something to leave behind for nobody.
            containers.delete(one.connectionId);
            try { await launcher.disconnect(one.connectionId); } catch { /* already gone */ }
            log(`dev container ${one.connectionId} abandoned: the client went away while it was starting`);
            throw new Error(`The connection went away while ${one.connectionId} was starting`);
          }
          return { connectionId: one.connectionId, name: one.name, ...result };
        },
        'vscode/devContainers/disconnect': async (params) => {
          const launcher = need(options.containers, 'vscode/devContainers/disconnect');
          const id = namedContainer(params);
          if (!containers.delete(id)) {
            throw new RpcError(-32008, `${id} is not a dev container this client opened`);
          }
          // Nothing is notified: the client asked for this, and the reference
          // host's own client forgets the connection on its side as it does.
          await launcher.disconnect(id);
        },
        'vscode/devContainers/relaySend': async (params) => {
          const launcher = need(options.containers, 'vscode/devContainers/relaySend');
          const id = namedContainer(params);
          if (!containers.has(id)) {
            throw new RpcError(-32008, `${id} is not a dev container this client opened`);
          }
          if (typeof params.data !== 'string') throw new RpcError(-32602, 'data must be a string');
          // The frame is written and not read: the nested host is the one that
          // answers it, and what it answers with comes back as `relayMessage`.
          await launcher.send(id, params.data);
        },
        /**
         * The configuration a session would have, before one exists.
         *
         * Separate from a session's own config precisely because it has to be
         * answerable with no session: what a composer offers has to be
         * offerable before anything has been created.
         */
        /**
         * The schema, and what it defaults to.
         *
         * `schema`, not `properties` at the top level: a client reads
         * `result.schema.properties`, and putting them one level up draws no
         * controls at all - no permission mode, no model, no effort. Which is
         * exactly what it did.
         */
        resolveSessionConfig: async (params) => {
          const provider = String(params.provider ?? first.provider);
          const agent = agents.get(provider);
          if (!agent)
            throw new RpcError(-32002, `No provider called ${provider}`);
          const answered = (typeof params.config === 'object' && params.config !== null
            ? params.config
            : {}) as Record<string, unknown>;
          /*
           * The host's own properties, merged over the backend's.
           *
           * Over rather than under: `isolation` and its two companions are
           * this host's to answer, and a backend that happened to advertise
           * the same names would be advertising control of a directory it
           * does not choose.
           */
          /*
           * `workingDirectory`, singular, because that is the field this
           * command declares.
           *
           * `createSession` takes `workingDirectories` and this one does not,
           * and reading the plural here meant the answer was always computed
           * against the host's own first path instead of the folder the
           * question was about - so a client asking about a repository was
           * told what a non-repository offers, which is no isolation at all.
           * The plural is still read after it, for a client that sends what
           * the neighbouring command takes.
           */
          const one = typeof params.workingDirectory === 'string' ? params.workingDirectory : undefined;
          const asked = one ?? (Array.isArray(params.workingDirectories)
            ? params.workingDirectories.find((entry) => typeof entry === 'string')
            : undefined);
          const mine = await isolating(
            typeof asked === 'string' ? asked.replace(/^file:\/\//, '') : dir,
            typeof answered.isolation === 'string' ? answered.isolation : undefined,
          );
          /*
           * The same picker a session of this host's own is created with, asked
           * for the person asking: `resolveSessionConfig` is what a client
           * draws its new-session form from, so a scope missing from it is a
           * scope nobody can pick before the session exists.
           */
          const scoped = scoping(connection.principal);
          const theirs = sessionSchema(agent);
          /*
           * A contributed key's own values, asked for here rather than left
           * to the first client that opens its picker: this is the answer a
           * composer draws itself from, and a key marked `enumDynamic` with
           * nothing in its `enum` is a control with no label for the value it
           * is already holding.
           */
          const contributed = await seeded(
            (typeof theirs.properties === 'object' && theirs.properties !== null ? theirs.properties : {}) as Bag,
            { provider, ...(asked === undefined ? {} : { workingDirectory: asked }), config: answered },
          );
          const properties = {
            ...contributed,
            ...(typeof mine.schema.properties === 'object' && mine.schema.properties !== null ? mine.schema.properties : {}),
            ...scoped.properties,
          };
          // Iterative, as a real host's is: what has been answered comes back
          // answered, so re-asking does not quietly undo a choice.
          return {
            schema: { ...theirs, properties },
            values: { ...agent.defaults(), ...mine.defaults, ...scoped.defaults, ...answered },
          };
        },
        /**
         * The values behind a property whose list is too long to send.
         *
         * Only `branch`, because it is the only key here with more values than
         * a picker holds - the rest are enums of five things or fewer, and a
         * client is told so by their schema. A property this host has no
         * lookup for answers with nothing rather than an error: the client
         * asked what else there is, and "nothing else" is an answer.
         */
        sessionConfigCompletions: async (params) => {
          const property = String(params.property ?? '');
          const asked = typeof params.workingDirectory === 'string' ? params.workingDirectory : undefined;
          /*
           * A contributed key answers for itself, before the host's own.
           *
           * Without this a key a plugin named reached every client as a text
           * box: a property with no `enum` reads as a fact somebody types, so
           * only a client holding code for that key by name could draw a
           * picker for it. The answerer is registered beside the key, and the
           * fold is what marks the property `enumDynamic`, so a client asking
           * is a client that was told to ask.
           */
          const answerer = options.sessionConfigCompletions?.[property];
          if (answerer !== undefined) {
            try {
              /*
               * A picker that fails is an empty picker.
               *
               * The person is filling in a session's settings, and a machine
               * listing that cannot be read is not a reason to refuse them the
               * rest of the form. The `try` covers the call as well as the
               * promise, because an answerer that throws before it returns one
               * would otherwise escape a `.catch` on the result.
               */
              return {
                items: await answerer({
                  property,
                  query: typeof params.query === 'string' ? params.query : '',
                  ...(typeof params.provider === 'string' ? { provider: params.provider } : {}),
                  ...(asked === undefined ? {} : { workingDirectory: asked }),
                  ...(typeof params.config === 'object' && params.config !== null
                    ? { config: params.config as Record<string, unknown> }
                    : {}),
                }),
              };
            }
            catch {
              return { items: [] };
            }
          }
          const port = options.worktrees;
          if (property === 'scope') {
            /*
             * The choices are the asking person's, so asked for here rather
             * than offered in the enum alone: a person with a `team:*` holds
             * one choice per project, and a client that would rather not draw
             * them all asks. A host with nobody signed in has nothing to offer
             * and says so with an empty list, like any other property here.
             */
            const who = connection.principal;
            if (who === undefined) return { items: [] };
            const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
            const found = namesOf(who).filter((one) => one.toLowerCase().includes(query));
            return { items: found.map((name) => ({ value: name, label: name })) };
          }
          if (property !== 'branch' || !port) return { items: [] };
          const where = (asked ?? `file://${dir}`).replace(/^file:\/\//, '');
          const repository = await port.repository(where).catch(() => undefined);
          if (repository === undefined) return { items: [] };
          const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
          const branches = await port.branches(repository).catch(() => [] as string[]);
          /*
           * Substring rather than prefix, and capped.
           *
           * Somebody looking for `softov/agents/1a2b` types `1a2b`, and a
           * prefix match would answer nothing. The cap is the same one the
           * schema seeds with, because the list is ordered by most recent
           * commit and a picker showing four hundred rows is one nobody reads.
           */
          const found = branches.filter((name) => name.toLowerCase().includes(query));
          return { items: found.slice(0, SEEDS).map((name) => ({ value: name, label: name })) };
        },
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
      /**
       * One client action, applied.
       *
       * Only the actions a client is *allowed* to originate: the rest are
       * this host telling clients what it did, and one arriving from a client
       * is a client lying about what happened. The protocol package carries
       * the authority - `IS_CLIENT_DISPATCHABLE` - and its own docstring says
       * servers should check it.
       *
       * Separate from the notification entry below only so the origin can be
       * held around the whole of it. `origin` is taken as an argument as well,
       * for the few sites that answer in a later turn of the event loop: a
       * config key the backend has to be asked about cannot read `applying`,
       * because by the time it answers that is nobody's.
       */
      const applyDispatch = (params: Record<string, unknown>, origin: Origin): Promise<void> | undefined => {
        const asked = String(params.channel ?? '');
        // Resolved before anything looks it up, so a client that talks to a
        // chat - or a session - under its own spelling drives the same one it
        // is watching rather than one nothing here has heard of.
        const channel = meantBy(asked);
        const action = (typeof params.action === 'object' && params.action !== null
          ? params.action
          : {}) as Record<string, unknown>;
        const type = String(action.type ?? '');
        /** Refuse this dispatch, in the words of whatever would not have it. */
        const no = (reason: string): void => refuse(connection.peer, channel, action, origin, reason);
        /*
         * The gate, for the half that arrives as a notification.
         *
         * The one at the dispatch boundary cannot reach this: a notification
         * carries no id, so it returns before the boundary and there is nowhere
         * to put a `-32007`. What it gets instead is the same `rejectionReason`
         * every other refused action gets, which is the only "no" this
         * direction has.
         *
         * First in the function, before the relayed watch below and before
         * anything is read or written, because every branch under here drives
         * something: `terminal/input` runs a command, `chat/turnStarted` runs a
         * model, `root/configChanged` changes a setting for everybody.
         *
         * A host with no user directory refuses nothing, exactly as at the
         * other boundary.
         */
        /*
         * An action only on the kind of channel it belongs on, spelt and
         * resolved, before the gate and before any handler: the handlers
         * below act on the action, and read a session's id out of whatever
         * channel it came on.
         */
        const family = ACTION_HOMES[type.slice(0, type.indexOf('/'))];
        if (family !== undefined) {
          const wrong = [asked, channel].find((one) => homeOf(one) !== family.home);
          if (wrong !== undefined) {
            no(`${wrong} is not ${HOME_WORDS[family.home]} here`);
            return;
          }
        }
        if (options.users !== undefined && connection.root !== true) {
          /*
           * What the channel is spelt as and what it resolves to, both,
           * because the handler below acts on the resolved one, and what the
           * action needs: the strictest of them is asked.
           */
          const all = [...new Set([dispatchNeeds(asked, channelKind(asked), action), dispatchNeeds(channel, channelKind(channel), action), family?.needs, computerNeeds(action)])]
            .filter((one): one is Grant => one !== undefined);
          const needed = all.find((one) => connection.principal !== undefined && !connection.principal.can(one)) ?? all[0];
          const needs = needed === undefined ? '' : ` needs ${needed}`;
          const who = connection.principal;
          if (who === undefined) {
            no(`Sign in to use this host: ${channel}${needs}`);
            return;
          }
          // Removed since they signed in: a sign-in again, not a role that
          // does not cover this.
          if (who.standing !== undefined && !who.standing()) {
            no(`Sign in to use this host: ${channel}${needs}`);
            return;
          }
          if (needed !== undefined && !who.can(needed)) {
            no(`${who.id} may not ${needed} here`);
            return;
          }
        }
        /*
         * Whether a client is allowed to originate this at all, asked of the
         * protocol rather than answered here.
         *
         * `IS_CLIENT_DISPATCHABLE` is exhaustive over `StateAction` and its
         * own docstring says servers should check it, so it grows with the
         * protocol and the switch below does not have to. Refused with its own
         * reason: a host-only action arriving from a client is a client
         * claiming something happened, which is not the same complaint as an
         * action this host has not got round to serving - and told apart only
         * here, because both used to fall into the one default.
         */
        /*
         * A watch this client itself keeps, whose reports this host relays.
         *
         * `resourceWatch/changed` is a host's to say - except on a watch over
         * a client's own resources, where that client is the only thing that
         * can see the files move: it was asked for the watch through
         * `createResourceWatch` and answered with the channel. Passed
         * straight through to whoever subscribed, and refused from anybody
         * else by the check below - a change to somebody else's files is not
         * a thing a third client may claim happened.
         */
        if (relayed.get(channel)?.owner === connection && type === 'resourceWatch/changed') {
          dispatch(channel, action, origin);
          return;
        }
        if (dispatchable[type] === false) {
          no(`${type} is this host's to say, not a client's`);
          return;
        }
        /*
         * A mark on a file, kept for whoever else is in the session.
         *
         * Reduced with the protocol's own `annotationsReducer` rather than
         * with five cases written here: every client applies its own dispatch
         * with that function, and a host that reduced the same action even
         * slightly differently would hand out a state its clients disagree
         * with. It returns the state it was given when the action names
         * something that is not there, which is what makes a no-op tellable
         * from a change - and a no-op echoed as though it had applied is a
         * client left holding an optimistic mark this host never kept.
         */
        if (type.startsWith('annotations/')) {
          if (!channel.endsWith(MARKS)) {
            no(`${type} belongs on a session's ${MARKS} channel, not ${channel}`);
            return;
          }
          // A mark on a session this host cannot open is a mark kept for a
          // harness that is not here: refusing by name is what tells a client
          // the row is waiting rather than gone.
          const marked = waitingFor(idOf(channel.slice(0, -MARKS.length)));
          if (marked !== undefined) {
            no(`${marked} is not loaded on this host`);
            return;
          }
          const id = idOf(channel.slice(0, -MARKS.length));
          const before = marksOf(id);
          const after = annotationsReducer(before, action as unknown as AnnotationsAction);
          if (after === before) {
            no(`${type} names an annotation this session does not have`);
            return;
          }
          marks.set(id, after);
          dispatch(channel, action);
          return;
        }
        /*
         * The client flags, which are the host's to keep.
         *
         * Answered before anything looks for a running session, because
         * these are the two actions that are *about* a session nobody has
         * opened: marking a row read, or filing it away, is what somebody
         * does from the catalogue - and starting an agent to record a bit
         * would start one per row scrolled past.
         */
        /*
         * Ticking a file off a diff, which belongs to no session's agent.
         *
         * Answered here for the same reason the flags below are: it is a
         * reader's bookkeeping about a changeset, it writes nothing to disk,
         * and it arrives on the changeset's own channel rather than a
         * session's. Review is deliberately not an *operation* - the
         * protocol has clients dispatch this and the server keep the flag.
         */
        /*
         * What a client wants of this host, kept and said back.
         *
         * On the root channel, so it belongs to no session and there is
         * nothing to look up. VS Code pushes this at connect and used to be
         * answered with `dispatchAction root/configChanged on unknown
         * ahp-root://` - the shell it asked for went nowhere, and every
         * terminal opened whatever `$SHELL` happened to be.
         */
        if (isRootChannel(channel) && type === 'root/configChanged') {
          const config = (typeof action.config === 'object' && action.config !== null
            ? action.config
            : {}) as Record<string, unknown>;
          /**
           * What the daemon's half answers for the keys that were written, put
           * in place of what the client sent.
           *
           * Empty until the write has said so, which is all it can be before:
           * the client's copy of a daemon key is what the client holds, not what
           * the daemon holds.
           */
          const said: Record<string, unknown> = {};
          /**
           * The host's own half, applied and echoed.
           *
           * Kept in `rootConfig` whatever the daemon's half does, so the wire
           * does not move for it: one echo, one replay entry, and `values` reads
           * back what was pushed exactly as the conformance suite pins it.
           */
          const apply = (): void => {
            /*
             * Kept twice, because the keys are two kinds.
             *
             * What changed is who *acts* on a key. `PER_CONNECTION` names the
             * person's - `defaultShell` today - and those are also written to
             * this connection, which is the only place anything reads them from
             * now. `rootConfig`'s copy is display state and nothing opens a shell
             * with it. So two people on one daemon each get their own, and the
             * paths with no connection in hand take the daemon's own shell and
             * nobody's preference at all.
             */
            const mine = Object.fromEntries(Object.entries(config).filter(([key]) => PER_CONNECTION.has(key)));
            /*
             * The host's half and the person's are kept; the daemon's are not.
             * A daemon key is the port's, and `rootState` answers it by asking
             * the port, so a copy kept here would be a second opinion - and
             * `rootState` shows this map to every connection, which would hand a
             * member a credential it has no schema for.
             */
            const ours = Object.fromEntries(Object.entries(config).filter(([key]) => !PER_CONNECTION.has(key) && !daemonKey(key)));
            const into = (target: Record<string, unknown>, from: Record<string, unknown>): void => {
              for (const [key, value] of Object.entries(from)) {
                // `undefined` is how a key is taken back, and JSON has no such
                // value - so a client saying so sends the key with a null.
                if (value === null || value === undefined) delete target[key];
                else target[key] = value;
              }
            };
            if (action.replace === true) {
              for (const key of Object.keys(rootConfig)) delete rootConfig[key];
              delete connection.config;
            }
            into(rootConfig, ours);
            if (Object.keys(mine).length > 0) into(connection.config ??= {}, mine);
            // What the echo carries, which is what a log line about it says too:
            // a value the daemon holds back is not a value the log may print.
            const echoConfig = { ...config, ...said };
            log(`root config: ${Object.entries(echoConfig).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ') || '(nothing)'}`);
            /*
             * The artifact wording is read where the tools are built, so a
             * running session is told the new set now and handed it again when
             * its chats are retooled. The definitions move even though the
             * tools do not: what a client draws is the description.
             */
            if (Object.prototype.hasOwnProperty.call(config, 'artifactToolsCompactPrompts')) {
              for (const uri of sessions.keys()) {
                dispatch(uri, { type: 'session/serverToolsChanged', tools: toolDefinitions(uri) });
                retool(uri);
              }
            }
            /*
             * Said back whole, like every other action a client originates:
             * nothing in a client applies its own dispatch, and a second client
             * watching the root learns of it only from here.
             *
             * One envelope and one `serverSeq` for everybody, because the
             * sequence and the replay buffer are one per host. What each
             * connection reads in it is `seenBy`'s: the sender's
             * `PER_CONNECTION` keys reach only the sender, and the daemon's
             * keys go out as the port answered them rather than as this client
             * sent them, so a value the port holds back is not carried to the
             * second admin by the echo.
             */
            dispatch(ROOT, { ...action, config: echoConfig });
          };
          /*
           * The daemon's keys, which are not this host's to keep.
           *
           * They go to the port and nowhere else, and they are answered by
           * reading it rather than out of `rootConfig`, so a value a client
           * holds and a value the file holds are never two opinions. A key the
           * schema does not name stays where it was - kept, acted on by nothing,
           * which is what `values` reads back as a setting that did not revert.
           *
           * Asked first, because it is the only half that can be refused: a
           * write is a file being read and written and a schema being held to,
           * and a client whose change never happened is told so rather than
           * echoed. `behind` turns the refusal into this one client's
           * `rejectionReason`, and the echo goes out only once it has answered.
           */
          const theirs = Object.fromEntries(Object.entries(config).filter(([key]) => daemonKey(key)));
          if (Object.keys(theirs).length === 0 || options.rootConfig === undefined) {
            apply();
            return;
          }
          const port = options.rootConfig;
          return Promise.resolve(port.write(theirs)).then(async (answer) => {
            if (answer.restartNeeded === true) ctx.restartNeeded = true;
            /*
             * Read back so the echo is what the daemon holds. The client sent
             * the credential in clear, and the echo is one envelope for every
             * connection that may read the settings, so carrying the sent value
             * out would undo the mask the port applies to everyone else - the
             * sender included, which is a form posting back what it was shown.
             */
            const held = await port.values();
            for (const key of Object.keys(theirs)) {
              if (Object.hasOwn(held, key)) said[key] = held[key];
            }
            apply();
            /*
             * `advancedTools` is a key of the host's own option as much as of
             * the daemon's, so the daemon's answer that it took hold is this
             * host's answer too: the tools are rebuilt and every session is
             * told and retooled now, the way the compact wording is. The answer
             * that said a restart is needed is the daemon's to give, and this
             * key is one it applies while it runs.
             */
            const asked = theirs['advancedTools'];
            if (typeof asked === 'boolean' && asked !== ctx.advancedTools) {
              ctx.advancedTools = asked;
              ctx.contributing = permitted(ctx.contributed);
              for (const uri of sessions.keys()) {
                dispatch(uri, { type: 'session/serverToolsChanged', tools: toolDefinitions(uri) });
                retool(uri);
              }
            }
          });
        }
        if (type === 'changeset/filesReviewChanged') {
          const cut = channel.indexOf('/changeset/');
          const owner = cut > 0 ? channel.slice(0, cut) : '';
          const scope = cut > 0 ? channel.slice(cut + '/changeset/'.length) : '';
          const dir = owner === '' ? undefined : dirOf(owner);
          const files = Array.isArray(action.files)
            ? action.files.filter((one): one is string => typeof one === 'string')
            : [];
          const on = action.reviewed === true;
          if (dir === undefined || files.length === 0) {
            no(`${channel} is not a changeset, or no files were named`);
            return;
          }
          // Only when it moved. A client ticking a file already ticked would
          // otherwise have every other client redraw for nothing.
          if (options.changes?.review?.(dir, owner, scope, files, on) !== true) return;
          dispatch(channel, { type, files, reviewed: on });
          return;
        }

        /*
         * Somebody is here, and what they brought.
         *
         * Client-dispatchable and host-kept, which is the whole point: one
         * client says it once and every other client watching the session
         * learns of it, which is not something they could tell each other.
         * The id is this connection's own rather than whatever the action
         * carried - a client naming somebody else would be a client
         * announcing a presence that is not theirs.
         */
        /*
         * A client writing an automation, or patching one.
         *
         * Both are *requests* in the protocol's own spelling - the client
         * says what it wants and the host decides, then says what it
         * actually holds with `automation/set`. So neither of these echoes:
         * what goes out is the store's answer, which is not necessarily what
         * was asked for.
         *
         * A create is also where an automation learns whose work it is, from
         * this connection - and a patch never moves it, because a colleague
         * who edited the definition did not take it over.
         */
        if (type === 'automation/createRequested' || type === 'automation/updateRequested') {
          const store = options.automations;
          if (!store) { no(`${type} needs an automations store, and this host has none`); return; }
          const resource = String(action.resource ?? '');
          if (!resource.startsWith('ahp-automation:/')) {
            no(`${resource || 'That'} is not an automation URI`);
            return;
          }
          const made = type === 'automation/createRequested'
            ? store.create(resource, (typeof action.definition === 'object' && action.definition !== null
              ? action.definition
              : {}) as Bag, ownerFor(connection))
            : store.update(resource, (typeof action.changes === 'object' && action.changes !== null
              ? action.changes
              : {}) as Bag);
          // `onChanged` is what dispatches. A store that told the host
          // nothing would be one whose own timers were invisible, so
          // everything goes out the same way.
          if (!made) no(`No automation at ${resource}`);
          return;
        }

        /*
         * Forgetting one, which the client dispatches and the host checks.
         *
         * The protocol is precise about the order: a client may send this
         * "only while the target advertises `Remove`", and the host
         * "revalidates that operation before permanently deleting". So the
         * advertised list is checked here rather than trusted - a client
         * holding a stale catalogue would otherwise delete something this
         * host had since decided may not be deleted.
         */
        if (type === 'automation/removed') {
          const store = options.automations;
          const resource = String(action.resource ?? '');
          const found = store?.get(resource);
          // "Removing an unknown resource is a no-op."
          if (!store || !found) return;
          if (!found.operations.includes('remove')) {
            no(`${resource} does not offer remove`);
            return;
          }
          store.remove(resource);
          return;
        }

        if (type === 'automationRun/cancelRequested') {
          no('A run here is a session, and disposing it is how it stops');
          return;
        }

        if (type === 'session/activeClientSet') {
          // `titles` is keyed by the bare id, so the URI has to come off before
          // it is asked. Under the whole channel this never matched, and every
          // client announcing itself in a session read from a transcript - the
          // ordinary way one is opened - was dropped in silence. It became
          // audible only once dropping stopped being silent.
          /*
           * Known to this host, which is not the same as running here.
           *
           * `owners` is every session the catalogue has listed and every one
           * this host started; `titles` is only the ones whose transcript
           * somebody has opened. Asking `titles` turned away a client
           * announcing itself in a row `listSessions` had returned a moment
           * earlier - which is the ordinary case, because a client announces
           * itself when it opens a row rather than after reading it.
           */
          if (!sessions.has(channel) && !owners.has(channel)) {
            no(`${channel} is not a session here`);
            return;
          }
          const clientId = connection.clientId || 'anonymous';
          const carried = (typeof action.activeClient === 'object' && action.activeClient !== null
            ? action.activeClient
            : {}) as Bag;
          const activeClient: Bag = {
            ...carried,
            clientId,
            tools: Array.isArray(carried.tools) ? carried.tools : [],
          };
          const held = presence.get(idOf(channel)) ?? new Map<string, Bag>();
          presence.set(idOf(channel), held);
          /*
           * Saying again what this host already held is not a change.
           *
           * `serverSeq` advances with *state* and never with messages, and a
           * client reconciles what it contributes whenever the session state
           * moves. So an echo of an announcement that changed nothing was
           * itself the change that prompted the next announcement, and the two
           * of us ran that loop three hundred times in a few seconds, burning
           * a sequence number apiece. The guard `isReadChanged` has below is
           * the same guard, and this is the same reason for it.
           */
          if (JSON.stringify(held.get(clientId)) === JSON.stringify(activeClient))
            return;
          // Re-announcing is how a client refreshes what it contributes, so
          // this replaces rather than merges - a tool taken away has to be
          // able to go.
          held.set(clientId, activeClient);
          dispatch(channel, { type, activeClient });
          // What it says it can run is a change to what the model is offered,
          // which is the whole point of the field: announced and never read,
          // `tools` was a list this host published back at the client that
          // sent it.
          retool(channel);
          return;
        }

        if (type === 'session/isReadChanged' || type === 'session/isArchivedChanged') {
          const uri = sessionFor(channel);
          const bit = type === 'session/isReadChanged' ? Status.IsRead : Status.IsArchived;
          const on = type === 'session/isReadChanged'
            ? action.isRead === true
            : action.isArchived === true;
          const before = kept.flags(idOf(uri));
          const after = on ? before | bit : before & ~bit;
          if (after === before)
            return;
          kept.setFlags(idOf(uri), after);
          // Every client watching, and the catalogue: a flag one client sets
          // is a flag the others have to see, which is what having a host
          // for this buys over each client keeping its own.
          dispatch(uri, action);
          summaryMoved(uri);
          return;
        }
        const terminal = terminals.get(channel);
        if (terminal) {
          switch (type) {
            /*
             * Input is side-effect only.
             *
             * The reducer changes nothing on it - what comes back is
             * `terminal/data`, once the shell has actually said something.
             * Echoing it here would print every keystroke twice on the
             * client that typed it and once on the ones that did not.
             */
            case 'terminal/input':
              terminal.write(String(action.data ?? ''));
              break;
            case 'terminal/resized':
              terminal.resize(Number(action.cols ?? 80), Number(action.rows ?? 24));
              break;
            case 'terminal/cleared':
              terminal.clear();
              break;
            case 'terminal/titleChanged':
              terminal.setTitle(String(action.title ?? ''));
              break;
            case 'terminal/claimed': {
              // A notification, so a malformed one is dropped rather than
              // refused - and dropped is right: the alternative was setting
              // the claim to `{}`, which told every other client that
              // nobody owned it.
              const claimed = claimOf(action.claim);
              if (claimed) terminal.setClaim(claimed);
              break;
            }
            default:
              no(`${type} is not served on a terminal`);
          }
          return;
        }
        /*
         * A worker's chat is read-only, whichever side of a restart it is on.
         *
         * Nobody types into a subagent: its conversation is the harness's work
         * inside somebody else's call. What a client may still send on one is
         * an answer to what the worker asked there and a stop, and those are
         * the lead chat's backend's to act on, since that backend runs the
         * worker. Anything else is refused here rather than falling into the
         * resume below, which would start an agent for a chat the client
         * cannot write to anyway.
         */
        const worker = toolCallOfSubagentChat(channel) !== undefined;
        if (worker && !WORKER_ACTIONS.has(type)) {
          refuse(connection.peer, channel, action, origin, `${channel} is a read-only subagent chat`);
          return;
        }
        /*
         * Which chat a client action is about.
         *
         * A chat channel names one; a session channel names the default,
         * because that is what a client talking to a session without having
         * asked for a chat means. A worker's chat names its session's lead,
         * whose backend runs the worker.
         */
        const owning = worker ? sessionFor(channel) : channel;
        const holding = sessions.get(owning);
        const held = byChat.get(channel)?.chat ?? (holding ? leadOf(holding) : undefined);
        /*
         * A session being started again waits for the start to finish.
         *
         * Moving a fixed key restarts the backend, and the first send pushes
         * the whole config and then the first turn without waiting for the
         * host between them. The turn is applied when the session it was
         * meant for is the one that exists - a backend started again is a new
         * object under the same URI - and a restart that failed answers every
         * action that waited on it with its own failure, which is the same
         * thing a refused action reads.
         *
         * Asked of the session the channel names rather than of what is
         * running, and before anything that reads "nothing is running" as a
         * session to browse: while it restarts, the session is out of
         * `sessions` and its chats out of `byChat`. The wait is returned, so
         * this connection's later dispatches go behind it in `waiting`.
         */
        const running = restarting.get(sessionFor(channel));
        if (running !== undefined) {
          return bounded(running, `${channel} starting again`).then(
            () => (connections.has(connection) ? applyNow(params, origin) : undefined),
            (error: unknown) => {
              refuse(connection.peer, channel, action, origin, error instanceof Error ? error.message : String(error));
            },
          );
        }
        /*
         * Config for a session with no agent yet: remembered, not refused.
         *
         * It is applied when the session is resumed, which is what makes the
         * controls on a browsed row mean something. Starting an agent here
         * instead would start one per setting somebody tried.
         */
        if (!held && type === 'session/configChanged') {
          const config = (typeof action.config === 'object' && action.config !== null
            ? action.config
            : {}) as Record<string, unknown>;
          /*
           * Only for a session this host runs, has listed, or finds in the
           * catalogue with a transcript: the store is keyed by id, and a
           * channel that names none would be a row for nothing. This host's
           * own keys decide a directory when a session is created, which a
           * browsed row was long ago, so they are not the store's.
           */
          const keep = (): void => {
            const uri = sessionFor(channel);
            const taken = Object.fromEntries(Object.entries(config).filter(([key]) => !HOSTS_OWN.includes(key)));
            if (Object.keys(taken).length > 0) kept.setConfig(idOf(uri), { ...kept.config(idOf(uri)), ...taken });
            dispatch(uri, action, origin);
          };
          const known = (): boolean => sessions.has(sessionFor(channel)) || owners.has(sessionFor(channel));
          // Before `past`, which answers nothing for a session waiting for its
          // agent and would have this one say it is not a session at all.
          const waiting = waitingFor(idOf(sessionFor(channel)));
          if (waiting !== undefined) {
            no(`${waiting} is not loaded on this host`);
            return;
          }
          if (known()) {
            keep();
            return;
          }
          // `past` reads the catalogue first, which is what lists it.
          return bounded(past(idOf(sessionFor(channel))), 'reading the catalogue').then((found) => {
            if (!connections.has(connection)) return;
            if (found !== undefined || known()) keep();
            else no(`${channel} is not a session here`);
          });
        }
        /*
         * A turn on a session this host is not running yet.
         *
         * This is where browsing becomes continuing: the row was readable
         * from its transcript, and saying something is what makes it worth
         * a subprocess. Resumed rather than replayed - the agent gets the
         * context it built before, not a transcript it has been shown.
         */
        if (!held && type === 'chat/turnStarted') {
          // The session the chat belongs to, which is not the chat's own name:
          // a chat URI carries its session rather than being derived from it.
          const uri = sessionFor(channel);
          const id = idOf(uri);
          void (async () => {
            /*
             * The agent this session was recorded for, before a transcript is
             * read or a record rewritten: a host that is not serving it says
             * so by name, and the session keeps its own provider until it is
             * loaded again rather than becoming a conversation on this one.
             */
            const missing = waitingFor(id);
            if (missing !== undefined) {
              refuse(connection.peer, channel, action, origin, `${missing} is not loaded on this host`);
              return;
            }
            const seed = await past(id);
            if (!seed) {
              refuse(connection.peer, channel, action, origin, `${channel} is not a session this host knows`);
              return;
            }
            /*
             * Named again, because `past` is what learned whose session this
             * is - and what this host will call it.
             *
             * A client may say the first thing about a row before anything has
             * listed a catalogue, and until something has, there is no name to
             * look an owner up under. Asking with the name computed beforehand
             * found nothing and refused a session that was right there.
             */
            const named = nameOf(id);
            const owner = owners.get(named);
            if (!owner) {
              refuse(connection.peer, channel, action, origin, `No backend owns ${channel}`);
              return;
            }
            // Back where it ran. A session continued in another directory is
            // a conversation whose second half cannot see the files its
            // first half was about.
            const ran = wheres.get(named)?.[0]?.replace(/^file:\/\//, '');
            /*
             * What the work is charged to: the one this session was settled
             * with, or the one this turn's sender resolves to.
             *
             * A session's charge was decided by whoever created it, possibly
             * before this process started, and it is read back rather than
             * decided again - which would answer for whoever is asking now,
             * or refuse the first turn of a session that was perfectly well
             * charged, because this daemon was started by somebody who is not
             * the person who created it. A session the store holds no charge
             * for is the one case where nobody decided it: one begun before
             * this host charged anything is settled now, from the principal
             * the turn arrived on, exactly as a new session is.
             */
            const was = kept.scope(id);
            const restored = storedConfig(owner, id);
            if (was === null) charged.set(named, undefined);
            else if (was !== undefined) charged.set(named, { scope: was });
            else charge(named, connection.principal, typeof restored.scope === 'string' ? restored.scope : undefined);
            const session = spawn(owner, named, chatUriFor(named), restored, { resume: id, seed }, ran);
            keepProvider(named, owner, session);
            log(`resumed ${named}`);
            dispatch(named, { type: 'session/ready' });
            summaryMoved(named);
            const message = (typeof action.message === 'object' && action.message !== null
              ? action.message
              : {}) as Record<string, unknown>;
            void fire({
              type: 'message',
              session: named,
              chat: chatUriFor(named),
              turn: String(action.turnId ?? ''),
              text: String(message.text ?? ''),
            });
            const refused = await beginOrRun(session, owner.provider, String(action.turnId ?? ''), String(message.text ?? ''), modelIn(message.model), messageFrom(message), ownerFor(connection), undefined, messageAttachments(message));
            if (refused !== undefined) refuse(connection.peer, channel, action, origin, refused);
          })();
          return;
        }
        const session = held;
        /*
         * A draft in a session this host is not running.
         *
         * The one client action worth taking without starting anything: it
         * moves no conversation, costs a map entry, and starting a CLI
         * because somebody typed a character would be a session opened by
         * accident. Everything else still needs a session, and says so.
         *
         * Checked against the catalogue rather than taken on trust, the way
         * `chat/turnStarted` is - a chat URI is a client's to spell, and a
         * draft held for a session nobody has is a map that only grows.
         */
        if (!session && type === 'chat/draftChanged') {
          const id = idOf(sessionFor(channel));
          void (async () => {
            const missing = waitingFor(id);
            if (missing !== undefined) {
              refuse(connection.peer, channel, action, origin, `${missing} is not loaded on this host`);
              return;
            }
            if (!(await past(id))) {
              refuse(connection.peer, channel, action, origin, `${channel} is not a session this host knows`);
              return;
            }
            const next = typeof action.draft === 'object' && action.draft !== null
              ? action.draft as Bag
              : undefined;
            if (next === undefined) drafts.delete(channel);
            else drafts.set(channel, next);
            // Echoed, because the point of a draft being on the wire at all is
            // that the other clients watching this chat see it.
            dispatch(channel, action, origin);
          })();
          return;
        }
        if (!session) {
          // With its keys, because the useful half of this line is what was
          // in the action nobody read - a type alone says only that a client
          // wanted something.
          const carried = Object.keys(action).filter((key) => key !== 'type');
          no(`${type} names nothing here${carried.length > 0 ? ` (${carried.join(', ')})` : ''}`);
          return;
        }
        switch (type) {
          case 'chat/turnStarted': {
            const message = (typeof action.message === 'object' && action.message !== null
              ? action.message
              : {}) as Record<string, unknown>;
            const text = String(message.text ?? '');
            const turnId = String(action.turnId ?? '');
            // Before it is started or queued, so a handler sees it once
            // whether or not the backend is free to run it this moment.
            void fire({ type: 'message', session: session.uri, chat: session.chatUri, turn: turnId, text });
            const provider = sessions.get(session.uri)?.agent.provider ?? 'This provider';
            beginTurn(
              beginOrRun(session, provider, turnId, text, modelIn(message.model), messageFrom(message), ownerFor(connection), undefined, messageAttachments(message)),
              (why) => refuse(connection.peer, channel, action, origin, why),
            );
            break;
          }
          /**
           * One key, merged.
           *
           * The action carries only what changed, so writing the whole
           * object back would revert whatever another client set while this
           * one had the form open.
           */
          /*
           * A directory added to, taken from, or put in place of the session's set.
           *
           * The SDK takes its directories when the CLI starts and exposes no
           * way to add one after, so this starts the backend again *resumed* -
           * the same conversation, in a wider place - rather than refusing.
           * Not while a turn is running: a CLI replaced mid-answer is an
           * answer that stops halfway, and `-32004` is the code for asking a
           * client to wait.
           */
          /*
           * A rename from a client.
           *
           * On a chat channel it names that chat, the way the reference host
           * reads it (`sessionTitleContribution.ts`); on the session channel
           * it names the session, which is its default chat. Blank is a
           * refusal, not a blank title: a row nobody can find again is the
           * thing the derived title exists to prevent.
           */
          case 'session/titleChanged': {
            const uri = session.uri;
            const owner = sessions.get(uri);
            if (owner === undefined) {
              no(`${channel} is not a session this host is running`);
              break;
            }
            const title = String(action.title ?? '').trim();
            if (title === '') {
              no('a title cannot be blank');
              break;
            }
            renameChat(uri, byChat.has(channel) ? channel : owner.defaultChat, title);
            break;
          }
          case 'session/workingDirectorySet':
          case 'session/workingDirectoryRemoved':
          case 'session/workingDirectoryReplaced': {
            const owner = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
            if (owner === undefined) {
              no(`${channel} is not a session this host is running`);
              break;
            }
            if (owner.agent.multipleDirectories !== true) {
              no(`${owner.agent.provider} works in one directory per session`);
              break;
            }
            const uri = session.uri;
            if ((statusOf(uri) & Status.InProgress) !== 0) {
              no('a working directory cannot change while a turn is running');
              break;
            }
            const path = (value: unknown): string => String(value ?? '').replace(/^file:\/\//, '');
            const held = owner.additional ?? [];
            let after = held;
            if (type === 'session/workingDirectorySet') {
              const one = path(action.directory);
              if (one === '' || one === owner.workingDirectory || held.includes(one)) break;
              after = [...held, one];
            }
            else if (type === 'session/workingDirectoryRemoved') {
              const one = path(action.directory);
              // The first is the process root and the protocol says a client
              // MUST NOT remove it. Said rather than silently ignored.
              if (one === owner.workingDirectory) {
                no('the first working directory is the one the agent runs in, and cannot be removed');
                break;
              }
              if (!held.includes(one)) break;
              after = held.filter((other) => other !== one);
            }
            else {
              // The primary slot, replaced atomically - which is the only way
              // index 0 may move, and why this host advertises
              // `primaryReplacement` beside `immutablePrimary`.
              const one = path(action.directory);
              if (one === '' || one === owner.workingDirectory) break;
              owner.workingDirectory = one;
            }
            owner.additional = after;
            void restart(uri, tokensFor(owner.agent.provider), { additional: after })
              .then(() => { dispatch(uri, action, origin); })
              .catch((error: unknown) => { no(error instanceof Error ? error.message : String(error)); });
            break;
          }
          case 'session/configChanged': {
            const config = (typeof action.config === 'object' && action.config !== null
              ? action.config
              : {}) as Record<string, unknown>;
            // Config belongs to the session, so it is remembered there: a
            // chat opened after this one is answered starts on it too.
            const owning = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
            /*
             * A source the session already made a machine from is that machine.
             *
             * The first send pushes the whole config bag, including the
             * `disposable:<profile>` the person picked, while the session is
             * running in the `computer://<id>` it was made into. Reading the
             * two as the same choice is what stops the fixed-key rule from
             * starting the session again with a value no backend can enter -
             * and from making a second machine while the first is alive.
             */
            const made = sessionMachines.get(session.uri);
            if (made !== undefined) {
              for (const [key, value] of Object.entries(config)) {
                if (value === made.source) config[key] = made.machine;
              }
            }
            /*
             * What each key held before this action, read before anything
             * writes over it.
             *
             * A fixed key is judged by whether it actually moved - a client
             * sends its whole config bag back on the first send - and once
             * the loop below has written the new value the old one is gone.
             * The value in effect, defaults included: a session created with
             * `{}` still runs on each default, and a client re-sending one is
             * not asking for anything.
             */
            const before = new Map<string, unknown>();
            const stored = new Map<string, unknown>();
            if (owning) {
              const effective = { ...owning.agent.defaults(), ...contributedDefaults(), ...owning.config };
              for (const key of Object.keys(config)) {
                before.set(key, effective[key]);
                stored.set(key, owning.config[key]);
              }
              // Kept as it arrived. A config value is `unknown` on the wire,
              // and `permissions` is an object - stringifying it made a
              // session remember the word `[object Object]`.
              for (const [key, value] of Object.entries(config)) owning.config[key] = value;
            }
            /*
             * A refused key put back as it was.
             *
             * The session's config is what a later chat and a restart are
             * spawned with, so a value refused here and left in it would be
             * applied anyway by the next chat opened in the session.
             */
            const undo = (key: string): void => {
              // Not over a value something else has written since.
              if (owning === undefined || owning.config[key] !== config[key]) return;
              const was = stored.get(key);
              if (was === undefined) delete owning.config[key];
              else owning.config[key] = was;
            };
            /**
             * An accepted key written to the store, which a resume after a
             * restart spawns the lead chat with.
             *
             * A key the schema scopes to one chat only when that chat is the
             * lead, since a peer chat's is that chat's and not the session's.
             * And only while the session is the one the change was made to:
             * the backend answers after a turn of the event loop, and a
             * session disposed meanwhile has had its row forgotten, maybe for
             * a new session under the same name. A session being started
             * again is still the session.
             */
            const lead = owning !== undefined && session.chatUri === owning.defaultChat;
            const life = lifeOf(session.uri);
            const remember = (key: string, value: unknown): void => {
              if (propertyOf(owning?.agent, key)?.scope === 'chat' && !lead) return;
              if (lives.get(session.uri) !== life) return;
              const id = idOf(session.uri);
              kept.setConfig(id, { ...kept.config(id), [key]: value });
            };
            /*
             * This host's own keys, which no backend has heard of.
             *
             * `isolation` and its companions decide a directory, and a
             * directory is decided when a session is created - so the answer
             * can still move while nothing has been said, and not afterwards.
             * That window is exactly the one a client puts these controls in
             * front of somebody in: it creates the backend session first so
             * the controls have somewhere to write, then sends the first
             * message. Applied together and started once, because two keys in
             * one action are one decision.
             *
             * `scope` is the one of them that decides no restart: a backend is
             * handed a folder to work in and has never heard of a charge, so
             * starting it again would throw away a conversation for a word it
             * cannot read. It is settled and refused beside the others.
             */
            const settled = decided.get(session.uri) ?? {};
            const ours = Object.entries(config)
              .filter(([key]) => HOSTS_OWN.includes(key) && key !== 'scope')
              // Only what actually differs. A client that sends its whole
              // config bag back - the same `isolation` it was given - is
              // agreeing with this host, and restarting a session to arrive
              // where it already is would be a session that disposed and
              // reopened itself for nothing.
              .filter(([key, value]) => value !== settled[key]);
            /** The same, less the key that starts nothing. */
            const rescoped = Object.entries(config)
              .filter(([key, value]) => key === 'scope' && value !== settled[key]);
            /*
             * The fixed keys a backend or a plugin declared.
             *
             * `sessionMutable: false` is the schema saying this value is read
             * when the backend starts - the computer a session runs in, and
             * Claude's thinking - so a new value before the first turn is the
             * session being created differently, exactly as `isolation` is.
             * Only a key that moved, for the same reason `ours` is filtered.
             */
            const fixed = owning === undefined ? [] : Object.entries(config)
              .filter(([key]) => !HOSTS_OWN.includes(key))
              .filter(([key]) => propertyOf(owning.agent, key)?.sessionMutable === false)
              .filter(([key, value]) => value !== before.get(key));
            /*
             * One restart for both kinds of fixed key, because two keys in
             * one action are one decision - and a restart is a backend start.
             */
            const moved = [...ours, ...fixed];
            if ((moved.length > 0 || rescoped.length > 0) && owning !== undefined) {
              /*
               * A value of the wrong shape for its key, which is a different
               * thing from a value that is fixed. The two pattern keys take a
               * list; `isolation`, the branch and the three branch rows take a
               * string, and a list sent for one of those is a mistake worth
               * saying so about.
               */
              const listOf = (key: string): boolean => key === 'worktreeIncludeFiles' || key === 'worktreeSymlinkFolders';
              const bad = [...ours, ...rescoped].find(([key, value]) => typeof value !== 'string'
                && !(listOf(key) && Array.isArray(value) && value.every((one) => typeof one === 'string')));
              const started = [...owning.chats.values()].some((chat) => chat.allTurns().length > 0);
              if (bad !== undefined) {
                for (const [key] of moved) undo(key);
                for (const [key] of rescoped) undo(key);
                no(`${bad[0]} takes ${listOf(bad[0]) ? 'a list of patterns' : 'a string'}`);
              }
              else if (started) {
                for (const [key] of moved) undo(key);
                for (const [key] of rescoped) undo(key);
                no(`${moved[0]?.[0] ?? rescoped[0]?.[0]} is fixed once the session has started`);
              }
              else {
                const mine = { ...settled };
                for (const [key, value] of [...ours, ...rescoped]) mine[key] = value;
                decided.set(session.uri, mine);
                /*
                 * What the work is charged to is decided with the rest of the
                 * window, so a scope that moved is resolved again here or the
                 * turn would be charged to the session it was created as.
                 *
                 * Resolved against the session's owner and not against whoever
                 * sent the change: the work belongs to the person who started
                 * it, and a colleague who can see the session is not thereby
                 * able to move its charge onto their own team. A root-owned
                 * session names no person, so it goes to nobody - and a session
                 * this host began before it recorded an owner is answered for
                 * exactly as it always was. An owner this process has not seen
                 * sign in cannot be checked, so the turn is refused until they do.
                 *
                 * What it was charged to is held, because a refusal below puts
                 * it back: the action is one decision, and a decision that was
                 * not taken leaves nothing of itself behind.
                 */
                const wasCharged = charged.get(session.uri);
                const wasScope = kept.scope(idOf(session.uri));
                const owner = kept.owner(idOf(session.uri));
                const person = owner === undefined ? connection.principal : principalFor(owner);
                if (rescoped.length > 0) {
                  if (owner?.startsWith('user:') === true && person === undefined) {
                    charged.set(session.uri, { refusal: `${owner.slice('user:'.length)} has to sign in once before this session's scope can change` });
                  }
                  else charge(session.uri, person, typeof mine.scope === 'string' ? mine.scope : undefined);
                }
                const uri = session.uri;
                /** What the clients are told, once the decision is in force. */
                const tell = (): void => {
                  for (const [key, value] of [...moved, ...rescoped]) {
                    /*
                     * The value the session actually has, when the restart
                     * changed it. A source is made into a machine on the way
                     * in, so a client told the source back would hold a value
                     * the session is not running with. This host's own keys
                     * are not in the backend's config, so they stay as they
                     * were sent.
                     */
                    const answered = owning.config[key] ?? value;
                    if (!HOSTS_OWN.includes(key)) remember(key, answered);
                    dispatch(uri, { type: 'session/configChanged', config: { [key]: answered } }, origin);
                  }
                };
                if (moved.length === 0) tell();
                else {
                  /*
                   * The restart, held while it runs.
                   *
                   * A turn can arrive in the window between the whole config
                   * being pushed and the backend being ready - VS Code sends
                   * both back to back - so `applyDispatch` waits on this
                   * promise before it touches the session. It is cleared before
                   * the promise settles to its consumers, so an action that
                   * waited re-runs against the backend that is actually there.
                   *
                   * Whether this session may move to the machine it is being
                   * moved to is asked here, where the keys are still theirs and
                   * the backend is still the one it was - not inside `restart`,
                   * which is past the point of undoing anything. It is the same
                   * `admitted` a client's `createSession` asks, against the
                   * person who owns the work and the scope it is being charged
                   * to.
                   *
                   * A refusal undoes the whole action rather than half of it: the
                   * keys, the row this host decides from, and the charge the
                   * scope moved onto. Nothing is announced either - the change
                   * never happened, so a `configChanged` would tell every other
                   * subscriber about a setting the session does not have, and a
                   * key written to the store would be what a resume starts the
                   * lead chat with. The session stays exactly where it was.
                   */
                  const work = (async () => {
                    const wrong = await admitted(person, charged.get(uri)?.scope, owning.config, owning.agent.provider, session.uri, owner);
                    if (wrong !== undefined) {
                      for (const [key] of moved) undo(key);
                      for (const [key] of rescoped) undo(key);
                      decided.set(session.uri, settled);
                      if (rescoped.length > 0) {
                        if (wasCharged === undefined) charged.delete(uri);
                        else charged.set(uri, wasCharged);
                        kept.setScope(idOf(uri), wasScope);
                      }
                      no(wrong);
                      return false;
                    }
                    await restart(uri, tokensFor(owning.agent.provider));
                    return true;
                  })();
                  // The promise a close waits on, which is not the work's own: a refusal is
                  // answered to the client below, and a promise nobody reads must
                  // not carry the rejection a second time.
                  restarting.set(uri, work.then(() => undefined, () => undefined));
                  const held = restarting.get(uri);
                  const clear = (): void => {
                    if (restarting.get(uri) === held) restarting.delete(uri);
                  };
                  void work.then(
                    (restarted) => {
                      clear();
                      // Announced only where the restart happened. A refusal is
                      // the action refused and nothing more.
                      if (restarted) tell();
                    },
                    (error: unknown) => {
                      clear();
                      lives.delete(uri);
                      no(error instanceof Error ? error.message : String(error));
                    },
                  );
                }
              }
            }
            for (const [key, value] of Object.entries(config)) {
              // Answered above, and not the backend's to hear about.
              if (HOSTS_OWN.includes(key)) continue;
              /*
               * What the schema says about this key, rather than what this
               * file used to know about four of them.
               *
               * `host.ts` imports no backend and is meant not to know one
               * exists, and it held the names `permissionMode`, `model`,
               * `effortLevel` and `outputStyle` and refused `thinking` by
               * name. Every one of those is a property of whatever schema the
               * backend published, and the two things this layer actually
               * needs to know are declared there: whether the key can move on
               * a running session, and whether it belongs to the session or
               * to one chat in it.
               */
              const property = propertyOf(owning?.agent, key);
              /*
               * Absent is not a refusal.
               *
               * `autoApprove` and `mode` are conventional names a client
               * sends whatever a host advertises, and this backend takes both
               * without declaring either - so the schema decides how a key
               * behaves and the backend decides whether it is taken at all.
               */
              /*
               * Immutable, and said so rather than accepted and dropped: a
               * control that reports success and changes nothing is worse
               * than one that refuses.
               *
               * Taken above when it moved before the first turn - the session
               * was started again with it - and a value that did not move is
               * not a change at all: a client re-sending the value it was
               * given is agreeing with this host rather than asking for
               * anything.
               */
              if (property?.sessionMutable === false) {
                if (fixed.some(([held]) => held === key)) continue;
                if (value === before.get(key)) continue;
                undo(key);
                no(`${key} is fixed once the session has started`);
                continue;
              }
              if (session.setConfig === undefined) {
                undo(key);
                no(`${key} is not a config key this backend takes`);
                continue;
              }
              /*
               * Every chat, or only this one, as the property says.
               *
               * A permission mode and an output style are the session's: the
               * chats are peers on one config, and a voice set on one of them
               * is a session where two conversations answer differently. A
               * model is the chat's. Neither is a fact about this host.
               */
              const everywhere = property?.scope === 'chat'
                ? []
                : (owning ? [...owning.chats.values()] : []).filter((chat) => chat !== session);
              for (const chat of everywhere) void Promise.resolve(chat.setConfig?.(key, value));
              void Promise.resolve(session.setConfig(key, value)).then((answer) => {
                // The backend's own words when it refused, because only it
                // knows whether the key or the value was the problem.
                if (answer === true) {
                  remember(key, value);
                  dispatch(session.uri, { type: 'session/configChanged', config: { [key]: value } }, origin);
                }
                else {
                  undo(key);
                  no(answer);
                }
              });
            }
            break;
          }
          /*
           * The latest turn, run again rather than typed again.
           *
           * The protocol's own conditions - latest, errored, message and parts
           * intact - are the backend's to check, because only it knows what
           * its last turn was. A backend that cannot re-run one says so here
           * rather than being asked to.
           */
          /*
           * A directory added to or taken from this chat's own set.
           *
           * The same mechanism the session's set uses - the CLI is started
           * again, resumed - applied to one chat rather than all of them. A
           * chat may only ever narrow its session's set, so anything outside
           * it is refused rather than quietly widening the session.
           */
          case 'chat/workingDirectorySet':
          case 'chat/workingDirectoryRemoved': {
            const owner = byChat.get(channel);
            if (owner === undefined) {
              no(`${channel} is not a chat this host is running`);
              break;
            }
            const held = sessions.get(owner.uri);
            if (held === undefined || held.agent.multipleDirectories !== true) {
              no('this backend works in one directory per session');
              break;
            }
            if ((statusOf(owner.uri) & Status.InProgress) !== 0) {
              no('a working directory cannot change while a turn is running');
              break;
            }
            const one = String(action.directory ?? '').replace(/^file:\/\//, '');
            const own = [held.workingDirectory, ...(held.additional ?? [])].filter((entry) => entry !== undefined);
            const had = beside.get(channel) ?? held.additional ?? [];
            let next = had;
            if (type === 'chat/workingDirectorySet') {
              if (!own.includes(one)) {
                no(`${one} is not a working directory of ${owner.uri}`);
                break;
              }
              if (one === held.workingDirectory || had.includes(one)) break;
              next = [...had, one];
            }
            else {
              if (one === held.workingDirectory) {
                no('the first working directory is the one the agent runs in, and cannot be removed');
                break;
              }
              if (!had.includes(one)) break;
              next = had.filter((other) => other !== one);
            }
            beside.set(channel, next);
            restartChat(owner.uri, channel, tokensFor(held.agent.provider));
            dispatch(channel, action, origin);
            break;
          }
          case 'chat/turnResume': {
            if (session.resume === undefined) {
              no('this backend cannot run a turn again');
              break;
            }
            if (!session.resume(String(action.turnId ?? ''))) {
              no(`${String(action.turnId ?? '')} is not a turn that can be resumed`);
            }
            break;
          }
          /*
           * On a worker's chat, that worker, when the backend can stop one;
           * otherwise the lead turn that runs the worker. The action names the
           * worker's own turn, which the backend has no turn under, so the
           * worker is named by the call its chat was opened for.
           */
          case 'chat/turnCancelled': {
            if (!worker) {
              session.cancel(String(action.turnId ?? ''));
              break;
            }
            const call = toolCallOfSubagentChat(channel);
            if (session.stopWorker !== undefined && call !== undefined) {
              session.stopWorker(call);
              break;
            }
            const current = (session.chatState() as { activeTurn?: { id?: unknown } }).activeTurn;
            if (current === undefined) {
              no(`Nothing is running on ${session.chatUri} to stop`);
              break;
            }
            session.cancel(String(current.id ?? ''));
            break;
          }
          /**
           * Say it after the turn that is running.
           *
           * The queue is the host's, which is the whole difference between a
           * queue and a list: it starts the next turn from the head the
           * moment it goes idle, and every client watching the chat sees the
           * same one. Held in a client it would never be sent - nothing
           * there is watching for a turn to end.
           */
          case 'chat/pendingMessageSet': {
            const kind = String(action.kind ?? 'queued');
            const message = (typeof action.message === 'object' && action.message !== null
              ? action.message
              : {}) as Record<string, unknown>;
            /*
             * Into the running turn, rather than behind it.
             *
             * Somebody correcting an agent halfway is the most ordinary thing
             * there is, and queueing it delivered the correction after the
             * thing it was trying to stop. The two refusals left are real: a
             * backend that cannot take a message mid-turn, and a chat with
             * nothing running to steer.
             */
            if (kind === 'steering') {
              if (!session.steer) {
                no('This backend cannot take a message mid-turn');
                break;
              }
              if (!session.steer(String(action.id ?? ''), String(message.text ?? ''))) {
                no('Nothing is running in this chat to steer');
              }
              break;
            }
            if (kind !== 'queued') {
              no(`${kind} is neither a steering message nor a queued one`);
              break;
            }
            const model = (typeof message.model === 'object' && message.model !== null
              ? message.model
              : {}) as Record<string, unknown>;
            const provider = sessions.get(session.uri)?.agent.provider ?? 'This provider';
            beginTurn(
              beginOrRun(
                session,
                provider,
                crypto.randomUUID(),
                String(message.text ?? ''),
                modelIn(model),
                messageFrom(message),
                ownerFor(connection),
                String(action.id ?? ''),
              ),
              (why) => refuse(connection.peer, channel, action, origin, why),
            );
            break;
          }
          /**
           * Turn a skill or an MCP server on or off.
           *
           * `enablement` carries a decision per scope - global, workspace,
           * session - and this host has one scope, so the session's is the
           * one that matters and anything else is a decision about machines
           * it does not own.
           */
          case 'session/customizationToggled': {
            const id = String(action.id ?? '');
            const enablement = Array.isArray(action.enablement) ? action.enablement.map((entry) => (
              typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {}
            )) : [];
            const wanted = enablement.find((entry) => entry.kind === 'session') ?? enablement[0];
            const enabled = wanted?.enabled !== false;
            void session.setCustomizationEnabled(id, enabled).then((took) => {
              if (took)
                return;
              // Said, not swallowed. The customization list is what a client
              // draws the switch from, so re-reporting it puts the switch
              // back where it was rather than leaving it showing a change
              // that did not happen - and the refusal beside it is what tells
              // the one client that asked why it moved back.
              no(`${id} has no runtime switch`);
              dispatch(session.uri, { type: 'session/customizationsChanged', customizations: session.customizations() });
            });
            break;
          }
          case 'session/mcpServerStartRequested':
            void session.startMcpServer(String(action.id ?? '')).then((took) => {
              if (!took) no(`${String(action.id ?? '')} would not start`);
            });
            break;
          case 'session/mcpServerStopRequested':
            void session.stopMcpServer(String(action.id ?? '')).then((took) => {
              if (!took) no(`${String(action.id ?? '')} would not stop`);
            });
            break;
          case 'chat/draftChanged':
            // A `Message`, not a string: `ChatState.draft` is the message
            // somebody is part-way through writing, model and all. Absent
            // clears it, which is what the action says `undefined` means.
            session.setDraft(typeof action.draft === 'object' && action.draft !== null
              ? action.draft as Bag
              : undefined);
            break;
          case 'chat/pendingMessageRemoved':
            session.unqueue(String(action.id ?? ''));
            break;
          case 'chat/queuedMessagesReordered':
            session.reorder(Array.isArray(action.order)
              ? action.order.filter((id): id is string => typeof id === 'string')
              : []);
            break;
          case 'chat/toolCallConfirmed':
            session.confirm(
              String(action.toolCallId ?? ''),
              action.approved === true,
              typeof action.selectedOptionId === 'string' ? action.selectedOptionId : undefined,
            );
            break;
          case 'chat/inputCompleted': {
            /*
             * `response`, which is the field the action has.
             *
             * `ChatInputResponseKind` is `accept`, `decline` or `cancel`, and
             * this read `accepted` - a key no client sends - so every answer
             * arrived as an accept and a person declining a question was
             * indistinguishable from one answering it. `accepted` is still
             * honoured for anything that sent it before this, but `response`
             * decides when both are there.
             */
            const response = typeof action.response === 'string' ? action.response : undefined;
            const accepted = response !== undefined ? response === 'accept' : action.accepted !== false;
            session.answer(String(action.requestId ?? action.id ?? ''), accepted, (typeof action.answers === 'object' && action.answers !== null
              ? action.answers
              : {}) as Record<string, unknown>);
            break;
          }
          /*
           * Drop the turns after a named one, and mean it.
           *
           * This is edit-and-resend: a client truncates to the turn before
           * the message somebody wants to change, then starts a new turn with
           * the edited text. So the agent has to forget the dropped turns as
           * well - a host that only cleared its own screen would leave the
           * conversation carrying on from a history nobody can see any more,
           * and the next answer would be about the message that was edited
           * away.
           *
           * Forgetting them means the CLI is started again, resumed at the
           * last thing the kept turn did. The turns up to there are handed
           * over as the seed, so the chat keeps its history across the
           * restart, and the session id is kept - see `rewindAt` - so a later
           * resume reaches the truncated conversation rather than the one
           * this dropped.
           */
          case 'chat/truncated': {
            const turnId = typeof action.turnId === 'string' ? action.turnId : undefined;
            /*
             * Every turn, which this host cannot ask for.
             *
             * The action's `turnId` is optional and its absence means "clear
             * the whole conversation" - which as a rewind is a cut at a point
             * before the first prompt, and there is no such entry to name.
             * Refused rather than served as an emptied screen in front of an
             * agent that remembers all of it.
             */
            if (turnId === undefined) {
              no('This host can drop the turns after one, but not a conversation entire');
              break;
            }
            const all = session.allTurns();
            const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
            if (at < 0) {
              no(`${turnId} is not a completed turn in ${session.chatUri}`);
              break;
            }
            // The backend's own name for the end of that turn. Absent for a
            // turn this process did not watch run - one read back off a
            // transcript - and a rewind to a point the backend cannot be told
            // is the half of this that would silently not happen.
            const point = session.endPoint?.(turnId);
            const started = session.agentId();
            const owner = sessions.get(session.uri);
            if (point === undefined || started === undefined || owner === undefined) {
              no(`${turnId} is not a turn this host can rewind to`);
              break;
            }
            /*
             * Said before the restart, not after.
             *
             * A client applies this by dropping the turns after `turnId`; the
             * session that comes up behind it opens with exactly those turns.
             * In the other order a client would take a full snapshot and then
             * be told to cut it, which is the same end state reached by
             * showing somebody the turns they asked to be rid of.
             */
            dispatch(session.chatUri, action);
            session.close();
            // So the next thing the new session says about itself is reported
            // rather than compared against what the old one last said.
            ctx.described.delete(session.chatUri);
            spawn(
              owner.agent,
              session.uri,
              session.chatUri,
              owner.config,
              { resume: started, rewindAt: point, seed: all.slice(0, at + 1) as Bag[] },
              owner.workingDirectory,
              undefined,
              beside.get(session.chatUri) ?? owner.additional,
            );
            log(`truncated ${session.chatUri} to ${turnId}`);
            break;
          }
          /*
           * Somebody's half-typed answer, kept for whoever else is looking.
           *
           * The same argument as `chat/draftChanged`: two people on one chat
           * are answering one question, and an answer each client kept to
           * itself would need no host at all. What it is kept *on* is the
           * request this host is already holding open - the protocol calls
           * the result the request's synced answer state, and says a
           * `chat/inputCompleted` may carry no answers because this is where
           * they are.
           */
          case 'chat/inputAnswerChanged': {
            if (!session.setAnswer) {
              no('This backend keeps no draft answers');
              break;
            }
            const requestId = String(action.requestId ?? '');
            const questionId = String(action.questionId ?? '');
            // Absent clears that question's draft, which is what the action
            // says `undefined` means and the only way JSON can say it.
            const answer = typeof action.answer === 'object' && action.answer !== null
              ? action.answer as Bag
              : undefined;
            if (!session.setAnswer(requestId, questionId, answer))
              no(`${requestId} is not a question this chat is waiting on`);
            break;
          }
          /*
           * Approving a tool call's *result*, which nothing here ever asks for.
           *
           * It belongs to a call completed with `requiresResultConfirmation`,
           * and no call this host builds sets it - the confirmation asked for
           * here is before the tool runs, not after. A client sending one is
           * answering a question nobody put.
           */
          case 'chat/toolCallResultConfirmed':
            no('No tool call here asks for its result to be confirmed');
            break;
          /*
           * What a client's own tool did, said by the client that ran it.
           *
           * The protocol makes the client named in the call's contributor
           * responsible for executing it and dispatching the result, so this
           * is the other half of offering a client's tools to the model at
           * all: the agent is blocked on this call, and this is what unblocks
           * it.
           *
           * Nothing is echoed from here. The result goes back to the harness,
           * the harness writes the tool result, and the session reports the
           * completion to every client from that - the same path every other
           * tool call takes. Relaying it here as well would draw the row
           * finished twice, once from a client's word and once from what
           * actually happened.
           */
          case 'chat/toolCallComplete': {
            const toolCallId = String(action.toolCallId ?? '');
            const clientId = connection.clientId || 'anonymous';
            const result = (typeof action.result === 'object' && action.result !== null
              ? action.result
              : {}) as Bag;
            if (!session.completeToolCall) {
              no('This backend runs no tools on a client\'s behalf');
              break;
            }
            // `ToolCallResult.content` is MCP's content blocks; what reaches a
            // model through this host is text, so text is what is read out of
            // them. An error carries its message instead, which is the only
            // thing a failed call actually says.
            const ok = result.success !== false;
            const text = (Array.isArray(result.content) ? result.content : [])
              .map((block) => (typeof block === 'object' && block !== null ? block as Bag : {}))
              .filter((block) => typeof block.text === 'string')
              .map((block) => String(block.text))
              .join('\n');
            const wrong = typeof result.error === 'object' && result.error !== null
              ? String((result.error as Bag).message ?? '')
              : '';
            if (!session.completeToolCall(toolCallId, clientId, {
              text: ok ? text : (wrong || text || 'The tool failed'),
              ok,
            })) no(`${toolCallId} is not a call ${clientId} is running here`);
            break;
          }
          /*
           * Streaming into a call while it runs, which is a *contributor's* to
           * do.
           *
           * The protocol has the owning client dispatch this for a tool the
           * client itself provides - the call carries a `ToolCallContributor`
           * with that client's id, and a server should refuse anyone else.
           * Relayed rather than reduced: what a tool is printing as it runs is
           * the running client's to say, and this host holds none of it.
           */
          case 'chat/toolCallContentChanged': {
            const toolCallId = String(action.toolCallId ?? '');
            const clientId = connection.clientId || 'anonymous';
            const owner = session.toolCallOwner?.(toolCallId);
            if (owner === undefined) {
              no(`${toolCallId} is not a call a client is running here`);
              break;
            }
            if (owner !== clientId) {
              no(`${toolCallId} is ${owner}'s call, and its content is ${owner}'s to change`);
              break;
            }
            dispatch(session.chatUri, action);
            break;
          }
          default:
            no(`${type} is not served yet`);
        }
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
        async handle(request) {
          const notify = notifications[request.method];
          if (notify) {
            // Dropped rather than refused: a notification carries no id, so
            // there is nowhere to say no, and a client that has not
            // introduced itself has no subscriptions to unsubscribe and no
            // `clientSeq` an echo could be matched against.
            if (!handshook) return undefined;
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
          if (!handshook && !GREETINGS.has(request.method)) {
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
          if (handshook && request.method === 'initialize') {
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
            throw new RpcError(-32602, `${request.method} is answered on ${fixed}, not on ${named}`);
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
          alive = false;
          if (options.containers !== undefined) {
            for (const id of [...containers.keys()]) {
              containers.delete(id);
              void Promise.resolve(options.containers.disconnect(id)).catch(() => { /* already gone */ });
            }
          }
          connections.delete(connection);
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
          for (const resource of [...expiring.keys()]) forgetExpiry(resource);
          // And the watches it was keeping for other clients: the channel was
          // its to report on, and with it gone nothing ever will again.
          for (const [channel, away] of [...relayed]) {
            if (away.owner === connection) relayed.delete(channel);
          }
          // Before anything else looks: a watch this client owned and never
          // subscribed to has nobody left to subscribe to it.
          for (const channel of [...watches.keys()]) releaseWatch(channel);
          // Gone without reconnecting, which is the second of the three ways.
          // Said after the connection is out of the set, so `leaves` does not
          // find this one still holding the session.
          for (const channel of was) leaves(channel, connection.clientId || 'anonymous');
          log(`${connection.clientId || 'a client'} went away`);
        },
      };
    },
  };
}
export { ROOT, isRootChannel, type Summary };

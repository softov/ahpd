import type { Agent } from '../types/agent.js';
import type { Connection, HostOptions, HostTool, ResourceProvider } from '../types/host.js';
import type { Peer } from '../types/rpc.js';
import type { Session } from '../types/session.js';
import type { Bag } from '../types/common.js';
import type { AnnotationsState } from '@microsoft/agent-host-protocol';
import type { Terminal } from '../types/terminals.js';
import type { DebugLogs } from '../debuglogs.js';
import type { CallLinks } from '../calllinks.js';
import type { Claiming, Claimed, Held, Learned, LiveSubagent, Origin } from './state.js';
import type { Admission } from './admission.js';
import type { Relay } from './relay.js';
import type { ChatRecord } from './chatrecord.js';
import type { Routing } from './routing.js';
import type { Changesets } from './changesets.js';
import type { Facts } from './facts.js';
import type { Telemetry } from './telemetry.js';
import type { Auth } from './auth.js';
import type { Owners } from './owners.js';
import type { Machines } from './machines.js';
import type { SessionConfig } from './sessionconfig.js';
import type { Root } from './root.js';
import type { Catalogue } from './catalogue.js';
import type { History } from './history.js';
import type { Snapshots } from './snapshots.js';
import type { Spawn } from './spawn.js';
import type { Lifecycle } from './lifecycle.js';
import type { Tooling } from './tooling.js';
import type { Terminals } from './terminals.js';
import type { Automations } from './automations.js';
import type { SessionEvents } from './sessionevents.js';

/**
 * Everything an area of the host reaches for, in one object.
 *
 * Built once in `createHost` and handed to every area's factory, the way a
 * host tool is handed a `ToolCall`. A `let` in the closure that crosses into
 * another file is a field here, and it is read as `ctx.<name>` where it is
 * used rather than copied onto the factory's own scope at construction - so
 * the order the areas are built in never matters and nothing is frozen.
 */
export interface HostContext extends ChatRecord, Routing, Relay, Changesets, Facts, Telemetry, Auth, Owners, Machines, SessionConfig, Root, Catalogue, History, Snapshots, Spawn, Lifecycle, Tooling, Terminals, Automations {
  /** The options `createHost` was given. */
  options: HostOptions;
  /** The directory this host serves. */
  dir: string;
  /** Every name this host holds or has handed out, and what it is. */
  claims: Map<string, Claimed>;
  /** The backends this host serves, by the id clients name. */
  agents: Map<string, Agent>;
  /** The backend a client gets when it names none, which is the ordinary case. */
  first: Agent;
  /** Every connection the host is serving right now. */
  connections: Set<Connection>;
  /** The person who first signed in under each client id, by client id. */
  holders: Map<string, string>;
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
  known: Set<string>;
  /** The last `REPLAY` action envelopes, oldest first. */
  replayable: { channel: string; action: Record<string, unknown>; serverSeq: number; origin: Origin | undefined }[];
  /** Live sessions, by their own uri. */
  sessions: Map<string, Held>;
  /** Every chat of a live session, by its own URI. */
  byChat: Claiming<{ uri: string; chat: Session }>;
  /** The worker chats this host opened, by URI. */
  subagents: Claiming<LiveSubagent>;
  /** The sessions being charged to an owner, by their own uri. */
  owners: Claiming<Agent>;
  /** The name this host publishes a session under, by the id inside it. */
  names: Map<string, string>;
  /** The terminals this host has handed out, by the name each answers to. */
  terminals: Claiming<Terminal>;
  /** Set by `close`: no session, terminal or automation run starts after it. */
  closed: boolean;
  /**
   * Why this host is taking no new turn, or nothing: what `refuseTurns` was
   * last given, in the embedder's words.
   */
  refusing: string | undefined;
  /**
   * The sessions that run with nothing to call.
   *
   * A session opened for its words alone - a commit message, a pull request
   * title - is a model answering one question, and a tool call in the middle
   * of it would be a model reading and writing the tree that is being
   * committed. `spawn` leaves every tool field out for a URI in here and
   * `boundTools` answers none, so a later `retool` cannot put one back.
   * Empty for every host that never opens one.
   */
  bareSessions: Set<string>;
  /** What each chat's summary last said, so an unchanged one is not re-sent. */
  described: Map<string, string>;
  /** The side index a worker's link is written from, fed from `dispatch`. */
  links: CallLinks;
  /**
   * What each session does, fed from the same funnel and read by the wake
   * rules. Held beside the host rather than merged into it, so that what a rule
   * reads is named once rather than spread over the host's own fields.
   */
  sessionEvents: SessionEvents;
  /** The chats made out of another, by URI, naming the source chat as this host holds it. */
  madeFrom: Map<string, Bag>;
  /** What started each session, for the ones nothing did. */
  origins: Map<string, { kind: 'automation'; automation: string; run: string }>;
  /** The automation runs starting a session now, which a close waits for. */
  starting: Set<Promise<string>>;
  /** When each session was created, by its own uri. */
  births: Map<string, string>;
  /** When each session last moved, by its own uri. */
  moves: Map<string, string>;
  /** The directories a listing may say a row is gone in. */
  browsable: () => string[];
  /** Say one thing on one channel, to every connection watching it. */
  broadcast: (channel: string, method: string, params: unknown, per?: (connection: Connection) => unknown) => void;
  /**
   * An action envelope as one connection may read it.
   *
   * The one place an envelope is rewritten for a connection, which is why the
   * live broadcast and both replay paths call it: a rewrite anywhere else
   * would be a second opinion about the same delivery.
   */
  seenBy: <E extends { channel: string; action: Record<string, unknown>; origin?: Origin | undefined }>(
    connection: Connection,
    envelope: E,
  ) => E;
  /** A person left a channel no connection of theirs is watching. */
  leaves: (asked: string, clientId: string) => void;
  /** The sequence number every snapshot and action is taken at. */
  serverSeq: number;
  /** The watches clients have asked for, by the channel each was given. */
  watches: Claiming<{
    state: Bag;
    watcher: { close(): void };
    /** The connection that asked for it, which keeps it alive until it subscribes. */
    owner: Connection;
    /** Whether anybody has ever subscribed. Until they have, there is nothing to have stopped. */
    opened: boolean;
  }>;
  /** The marks a session carries, as a snapshot of its annotations channel reports them. */
  marksOf: (id: string) => AnnotationsState;
  /** The live sessions started by resuming a recorded one, whose workers are read back. */
  resumedSessions: Set<string>;
  /** Who is in a session, as its state reports them. */
  activeClientsOf: (uri: string) => Bag[];
  /** What a person typed into a row and has not sent. */
  drafts: Map<string, Bag>;
  /** Whether the advanced tools are offered, a daemon key that takes hold while the daemon runs. */
  advancedTools: boolean;
  /**
   * What closing one chat of a session does to its conversation in the backend.
   *
   * `hidden` keeps it and this host's claim on its id, `delete` asks the
   * backend to remove it. A daemon key that takes hold while the daemon runs,
   * and read where a chat is dropped rather than held per chat.
   */
  closedChats: 'hidden' | 'delete';
  /** Every tool the host was given, before the permission was applied. */
  contributed: readonly HostTool[];
  /** The tools this host contributes, with the permission applied. */
  contributing: HostTool[];
  /** Who is in a session right now, by the id inside the session's uri. */
  presence: Map<string, Map<string, Bag>>;
  /** The directories a chat was handed on top of its session's own, by chat URI. */
  beside: Map<string, string[]>;
  /** The marks a session carries, kept so they outlive the annotations channel. */
  marks: Map<string, AnnotationsState>;
  /** What a live session's own bookkeeping lives on, so it is left when the session goes. */
  lives: Map<string, object>;
  /** A session's token in `lives`, made when it has none. */
  lifeOf: (uri: string) => object;
  /** The sessions being restarted now, by their own uri. */
  restarting: Map<string, Promise<void>>;
  /** What this host has learned about each backend, by the id clients name it by. */
  learned: Map<string, Learned>;
  /** The lead chat of a held session, when it has one. */
  leadOf: (held: Held) => Session | undefined;
  /** The directories a session may be pointed at, by its own uri. */
  wheres: Map<string, string[]>;
  /** The worktree each isolated session runs in, by session URI. */
  worktrees: Map<string, { repository: string; path: string; branch?: string; base?: string }>;
  /** What GitHub last said about each served directory's branch. */
  githubFacts: Map<string, Bag>;
  /** What the host remembers about sessions that are not running here. */
  kept: NonNullable<HostOptions['sessions']>;
  /** The isolation schema each session was offered when it was created. */
  offered: Map<string, Bag>;
  /** The config each session settled on, by its own uri. */
  decided: Map<string, Record<string, unknown>>;
  /**
   * Whether a change to the daemon's keys needs the daemon to start again.
   *
   * Held rather than asked of, because there is nothing to clear it: the flag
   * says a setting is not in force yet, and the thing that puts it in force is
   * a restart, which is this process ending - decision
   * `a-configuration-change-applies-live-or-on-ahpd-restart`.
   */
  restartNeeded: boolean;
  /** What this host has learned about a backend, made on first asking. */
  about: (provider: string) => Learned;
  /** The isolation schema and defaults for a session created in a directory. */
  isolating: (
    where: string | undefined,
    chosen?: string,
  ) => Promise<{ schema: Bag; defaults: Record<string, unknown>; repository?: string }>;
  /** The host-owned config keys a client sent, as this host reads them. */
  mineOf: (config: Record<string, unknown>) => Record<string, unknown>;
  /** A token any connected client lent for a resource, and has not run out. */
  lent: (resource: string) => string | undefined;
  /**
   * Say one thing on one channel, as though this host did it.
   *
   * `origin` defaults to whatever this host is applying right now, so a
   * dispatch made from inside an applied action carries that action's origin
   * without saying so again; the few sites that answer in a later turn of the
   * event loop pass it themselves.
   */
  dispatch: (channel: string, given: Record<string, unknown>, origin?: Origin | undefined) => void;
  /**
   * Send every streamed delta still held in the window, oldest first.
   *
   * A held delta has no sequence number yet, so anything answering a client
   * with state looks at a chat the deltas have not reached: a snapshot read
   * first carries the text and is then handed the delta that wrote it, and a
   * client that comes back is replayed a delta it has already applied.
   */
  flushDeltas: () => void;
  /**
   * Answer one client's dispatch with the reason it was not applied.
   *
   * Sent to that client alone: nobody else applied it optimistically, so
   * nobody else has anything to put back, and a client that reduced a
   * rejected envelope would apply the very change this host refused.
   */
  refuse: (
    peer: Peer,
    channel: string,
    action: Record<string, unknown>,
    origin: Origin | undefined,
    reason: string,
  ) => void;
  /** The host's own log. */
  log: (message: string) => void;
  /** What the window's "collect logs" gets, and reads back. */
  logs: DebugLogs;
  /** The worktree handles the window holds, by the handle it asked under. */
  detached: Map<string, {
    session: string;
    repository: string;
    path: string;
    branch?: string;
    claimed: boolean;
    archived: boolean;
    createdAt: number;
    lastSeenAt: number;
  }>;
}

/** What one connection's gate is built from. */
export interface ConnectionContext {
  /** The connection being admitted. */
  connection: Connection;
  /** Which store serves a URI. */
  storeFor: (uri: string) => HostOptions['resources'] | ResourceProvider;
  /** The users gate for one command, which throws what the client is told. */
  admit: Admission['admit'];
  /**
   * Whether this connection has been introduced.
   *
   * The protocol opens with `initialize`, or with `reconnect` for a client
   * coming back to a host it has met. Until one of them has been answered
   * there is no negotiated version, no `clientId` and nothing to key a
   * subscription by - so serving anything else means serving a client
   * this host has agreed on nothing with.
   */
  handshook: boolean;
  /** What this client pushed, narrowed to what that backend asked for. */
  tokensFor: (provider: string) => Record<string, string>;
  /**
   * When each token runs out, so the client that pushed it is told.
   *
   * The protocol has a word for this - `auth/required` with
   * `reason: 'expired'` - and until `expiresIn` arrived on `authenticate`
   * this host had no way to earn it: nothing here verifies a token, so it
   * never learned that one had gone stale. Now the client says how long it
   * has, and the moment it runs out is a fact this host holds alone. Said to
   * that connection and no other, because the token was theirs.
   *
   * `setTimeout` takes at most 2^31-1 milliseconds, a little under
   * twenty-five days; a token good for longer is checked again at that
   * boundary rather than fired early.
   */
  expiring: Map<string, ReturnType<typeof setTimeout>>;
  /** Stop watching a token's clock: it was replaced, revoked, or the client left. */
  forgetExpiry: (resource: string) => void;
  /**
   * Whether this connection is still here.
   *
   * A container takes time to build, and a client that went while its image
   * was building must not leave a relay running behind it.
   */
  alive: boolean;
  /** `wait`, or a failure saying what was waited on once `WAIT_LIMIT` has passed. */
  bounded: <T>(wait: Promise<T>, what: string) => Promise<T>;
  /** A dispatch applied now, as the one this host is applying. */
  applyNow: (params: Record<string, unknown>, origin: Origin) => Promise<void> | undefined;
  /**
   * The dev containers this connection opened, by the client's own name.
   *
   * Per connection, because a relay is one client's: the name is theirs,
   * nothing another client can spell reaches it, and a socket that drops
   * takes its containers with it. That is where the reference host keeps
   * them too - decision `the-relay-surface-is-the-reference-one`.
   *
   * `tail` is the launcher's own last words, kept only so a container that
   * dies can say why in this log.
   */
  containers: Map<string, { name: string; folder: string; tail: string[] }>;
}
import type { Agent } from '../types/agent.js';
import type { Catalogs } from '../i18n.js';
import type { ClientChange, Connection, HostOptions, HostTool, ResourceProvider } from '../types/host.js';
import type { PublishOptions } from '../types/plugin.js';
import type { Peer } from '../types/rpc.js';
import type { Session } from '../types/session.js';
import type { Bag } from '../types/common.js';
import type { AnnotationsState } from '@microsoft/agent-host-protocol';
import type { Terminal } from '../types/terminals.js';
import type { Principal } from '../types/users.js';
import type { StoredWorktree } from '../types/sessions.js';
import type { DebugLogs } from '../sessions/debuglogs.js';
import type { CallLinks } from '../automations/calllinks.js';
import type { Claiming, Claimed, Held, HeldState, Learned, LiveSubagent, Origin } from './state.js';
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
import type { Outputs } from './outputs.js';
import type { LocalTurns } from './localturns.js';
import type { Background } from './background.js';
import type { Automations } from './automations.js';
import type { SessionEvents } from './sessionevents.js';
import type { Sleep } from './sleep.js';
import type { Wakes } from './wakes.js';
import type { QueueDrain } from './queuedrain.js';
import type { Merged } from './merged.js';
import type { Canvases } from './canvases.js';
import type { Asking } from './asking.js';

/**
 * Everything an area of the host reaches for, in one object.
 *
 * Built once in `createHost` and handed to every area's factory, the way a
 * host tool is handed a `ToolCall`. A `let` in the closure that crosses into
 * another file is a field here, and it is read as `ctx.<name>` where it is
 * used rather than copied onto the factory's own scope at construction - so
 * the order the areas are built in never matters and nothing is frozen.
 */
export interface HostContext extends ChatRecord, Routing, Relay, Changesets, Facts, Telemetry, Auth, Owners, Machines, SessionConfig, Root, Catalogue, History, Snapshots, Spawn, Lifecycle, Tooling, Terminals, Outputs, LocalTurns, Automations, Sleep, Wakes, QueueDrain, Merged {
  /** The background tasks a backend reported, by chat. */
  background: Background;
  /** The canvases each chat shows, and the plugin that opened each one. */
  canvases: Canvases;
  /** The options `createHost` was given. */
  options: HostOptions;
  /** The directory this host serves. */
  dir: string;
  /** Every name this host holds or has handed out, and what it is. */
  claims: Map<string, Claimed>;
  /** The backends this host serves, by the id clients name. */
  agents: Map<string, Agent>;
  /** The backend a client gets when it names none, which is the ordinary case; none on a host with no agent. */
  first: Agent | undefined;
  /** Every connection the host is serving right now. */
  connections: Set<Connection>;
  /**
   * Tell the client registry's watchers that a connection joined or left.
   *
   * An arrival is known where the handshake finishes, which is in
   * `handshake.ts`, and the registry is held here; a departure is the
   * connection's own close. Both go through this one call.
   */
  clientsChanged(change: ClientChange): void;
  /**
   * The dev container relays each live connection holds, by the connection.
   *
   * `ConnectionContext.containers` is one connection's own map, which is where
   * the reference host keeps them too, so a name one client chose never reaches
   * another. The two methods VS Code sends to stop or remove a folder's dev
   * container have to answer whether *another* connection still holds a relay on
   * that folder, which is a question across connections - so the same maps are
   * held here, as each connection is admitted and dropped when it goes. What is
   * read is the map itself and never a copy of it, so nothing has to be spilled
   * back when a relay ends.
   */
  relays: Map<Connection, Map<string, { name: string; folder: string; tail: string[] }>>;
  /** The person who first signed in under each client id, by client id. */
  holders: Map<string, string>;
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
  known: Set<string>;
  /** When each client with no connection open went, by client id: what its record's retention counts from. */
  lastSeen: Map<string, number>;
  /** Every wait one client's closed connections began is over, because it is back. */
  waitsOver(clientId: string): void;
  /**
   * The last locale each client sent, by client id.
   *
   * Kept beside `known` and for the same span, because a records channel reads
   * a reader by client id rather than by connection.
   */
  locales: Map<string, string>;
  /**
   * The name each client gave in `clientInfo` at `initialize`, by client id.
   *
   * Kept beside `known` and for the same span, because a `reconnect` names
   * no `clientInfo` and an older VS Code window is told by that name, as the
   * reference host reads it off the client's record.
   * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1350-L1351
   */
  clientNames: Map<string, string>;
  /**
   * The protocol version each client agreed at `initialize`, by client id.
   *
   * Kept beside `known` and for the same span, because a `reconnect` offers
   * no versions and a connection it resumes is held to the one agreed, as the
   * reference host takes it from the client's record.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1351-L1362
   */
  clientVersions: Map<string, string>;
  /** The last locale a client sent, or `undefined` when it sent none. */
  localeOf: (clientId: string) => string | undefined;
  /**
   * The catalogs a session setting's text is looked up in, in order.
   *
   * The plugin that registered the key, or else the plugin that registered
   * the agent `provider`, and then the host's own.
   */
  catalogsOf: (key: string, provider: string) => readonly (Catalogs | undefined)[];
  /** The last `REPLAY` action envelopes, oldest first. */
  replayable: { channel: string; action: Record<string, unknown>; serverSeq: number; origin: Origin | undefined; audience?: PublishOptions }[];
  /** Live sessions, by their own uri. */
  sessions: Map<string, Held>;
  /**
   * Every chat of a live session, by its own URI, with `say`: the road its
   * backend's actions take, which keeps each turn of the chat, for a turn
   * this host runs itself.
   */
  byChat: Claiming<{ uri: string; chat: Session; say(action: Bag): void }>;
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
   * The host's close, once: every backend stopped and every store closed, the
   * process left running, as the reference host's shutdown shuts its providers
   * down.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L16018-L16051
   */
  shutdown(): Promise<void>;
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
  /**
   * The turns that run a `!` command, by chat and turn id while they run
   * (`commandTurnKey`).
   *
   * A command turn ran what the person typed, so its end says nothing of the
   * chat's read bit or its session's, as the reference host's markUnread leaves
   * a local command's.
   */
  commandTurns: Set<string>;
  /** The title each chat's backend said last, so a move of it is noticed. */
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
  /**
   * What a backend said about a browsed session, by its own uri.
   *
   * Kept because the row that said it is not the row a client is answered
   * with: `describes` composes a session's `_meta` on every read, and a session
   * nothing runs has no agent to ask. Replaced whole on each listing, and
   * removed when the backend stops saying anything.
   */
  listedMeta: Map<string, Bag>;
  /** The directories a listing may say a row is gone in. */
  browsable: () => string[];
  /** Say one thing on one channel, to every connection watching it. */
  broadcast: (channel: string, method: string, params: unknown, per?: (connection: Connection) => unknown) => void;
  /**
   * An action envelope as one connection may read it, or nothing when its
   * audience leaves this connection out.
   *
   * The one place an envelope is rewritten for a connection, which is why the
   * live broadcast and both replay paths call it: a rewrite anywhere else
   * would be a second opinion about the same delivery.
   */
  seenBy: <E extends { channel: string; action: Record<string, unknown>; origin?: Origin | undefined; audience?: PublishOptions }>(
    connection: Connection,
    envelope: E,
  ) => E | undefined;
  /** A person left a channel no connection of theirs is watching. */
  leaves: (asked: string, clientId: string) => void;
  /** The sequence number every snapshot and action is taken at. */
  serverSeq: number;
  /**
   * The resource watches running, by channel: each attached at its channel's
   * first subscribe, with one watcher per reader among its subscribers, by the
   * reader's id, `''` for a connection that is nobody.
   */
  watches: Claiming<{
    state: Bag;
    watchers: Map<string, {
      watcher: { close(): void };
      /** The release armed when that reader's last subscriber left, which a subscribe calls off. */
      grace?: ReturnType<typeof setTimeout> | undefined;
    }>;
  }>;
  /** A resource watch's watcher, attached on its channel's first subscribe, or nothing for a name that is no watch. */
  attachWatch(channel: string, principal?: Principal): Promise<Bag | undefined>;
  /** The marks a session carries, as a snapshot of its annotations channel reports them. */
  marksOf: (id: string) => AnnotationsState;
  /** The live sessions started by resuming a recorded one, whose workers are read back. */
  resumedSessions: Set<string>;
  /** Who is in a session, as its state reports them. */
  activeClientsOf: (uri: string) => Bag[];
  /** Whether the advanced tools are offered, a daemon key that takes hold while the daemon runs. */
  advancedTools: boolean;
  /**
   * Whether the session tools are offered at all. A daemon key that takes hold
   * while the daemon runs.
   */
  sessionTools: boolean;
  /**
   * The providers whose sessions are offered the session tools, empty for
   * every provider. A daemon key that takes hold while the daemon runs.
   */
  sessionToolsProviders: string[];
  /**
   * What closing one chat of a session does to its conversation in the backend.
   *
   * `hidden` keeps it and this host's claim on its id, `delete` asks the
   * backend to remove it. A daemon key that takes hold while the daemon runs,
   * and read where a chat is dropped rather than held per chat.
   */
  closedChats: 'hidden' | 'delete';
  /**
   * What archiving a session does with a tree that has changes nobody
   * committed: `keep` it, or `commit` them and remove it. A daemon key that
   * takes hold while the daemon runs, read when a tree is given back.
   */
  archiveDirtyWorktree: 'keep' | 'commit';
  /**
   * How the merged sessions pass learns the state of a pull request: `url`
   * asks for each related pull request by its page, `branch` asks for the
   * session's branch. A daemon key that takes hold while the daemon runs.
   */
  pullRequestLookup: 'url' | 'branch';
  /** Every tool the host was given, before the permission was applied. */
  contributed: readonly HostTool[];
  /**
   * The tools built from the adapters' `action` capabilities.
   *
   * Not part of `contributed`, because `setTools` replaces that whole and
   * these are the adapters' own: built once when the host starts, and kept
   * beside whatever a client sets.
   */
  actionTools: HostTool[];
  /** The tools this host contributes, with the permission applied. */
  contributing: HostTool[];
  /** Who is in a session right now, by the id inside the session's uri and then by the `clientId` each entry carries. */
  presence: Map<string, Map<unknown, Bag>>;
  /** The directories a chat was handed on top of its session's own, by chat URI. */
  beside: Map<string, string[]>;
  /** The marks a session carries, kept so they outlive the annotations channel. */
  marks: Map<string, AnnotationsState>;
  /** What a live session's own bookkeeping lives on, so it is left when the session goes. */
  lives: Map<string, object>;
  /** A session's token in `lives`, made when it has none. */
  lifeOf: (uri: string) => object;
  /**
   * The sessions being restarted now, by their own uri, each settling once its
   * start has: with the failure's words when the start failed.
   */
  restarting: Map<string, Promise<string | undefined>>;
  /**
   * The relaunch each running session owes, by its own uri: a change of
   * config or of folders its backend reads only when it starts, already said,
   * and taken when the backend starts again at the session's next turn
   * boundary, with the credentials and the connection of the change that
   * asked for it. `folders` is set where the folders changed, and that start
   * resumes the session's conversation in them.
   */
  relaunches: Map<string, {
    config: Bag;
    folders?: true;
    credentials: Record<string, string>;
    sender: Connection | undefined;
    tokensFor: (provider: string) => Record<string, string>;
  }>;
  /**
   * The relaunch each moved chat owes, by the chat's uri: its runtime goes on
   * under the session it was launched for until the chat's next turn
   * boundary starts it again under the session that holds it now, in the
   * folder it worked in, with the credentials and the connection of the move.
   */
  chatRelaunches: Map<string, { credentials: Record<string, string>; sender: Connection | undefined; directory: string | undefined }>;
  /**
   * The turns a client resumed that run now, by their chat and their id: the
   * time each ran before and when it ran again, which its stop is said with.
   */
  resumedTurns: Map<string, { duration: number; since: number }>;
  /**
   * The turns stopped on each chat whose state this host holds, by the chat's
   * URI: a turn's send asks it before each step of its preparation and before
   * its prompt goes out, as the reference host keeps each chat's cancelled turns.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L472-L486
   */
  cancelledTurns: Map<string, Set<string>>;
  /** What this host has learned about each backend, by the id clients name it by. */
  learned: Map<string, Learned>;
  /** The lead chat of a held session, when it has one. */
  leadOf: (held: Held) => Session | undefined;
  /** The directories a session may be pointed at, by its own uri. */
  wheres: Map<string, string[]>;
  /** The worktree each isolated session runs in, by session URI. */
  worktrees: Map<string, StoredWorktree>;
  /** A session's worktree: the map's entry, else the record the store kept. */
  worktreeOf: (uri: string) => StoredWorktree | undefined;
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
   * a restart, which is this process ending.
   */
  restartNeeded: boolean;
  /**
   * Say that a change is not in force until this process starts again.
   *
   * Sets the flag, says it in the root's config under `RESTART_KEY` with the
   * host's own `root/configChanged`, and sends `x-ahpd/restartNeeded` to every
   * connection watching the root. The second call changes nothing and sends
   * nothing: the mark is the same fact said once.
   */
  markRestart: () => void;
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
   * Say one thing on one channel.
   *
   * With `origin`, the action is that client's own, said as it sent it: its
   * echo. With none, it is this host's own action, whatever produced it.
   */
  dispatch: (channel: string, given: Record<string, unknown>, origin?: Origin | undefined) => void;
  /** Whether a client's dispatch was answered already, by its echo or its refusal. */
  answered: (origin: Origin) => boolean;
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
   * The state this host holds for a root, session or chat channel, as the
   * protocol's reducers made it from its seed and every action sent on it, or
   * nothing for a channel it holds no state for.
   */
  stateOf: (channel: string) => Bag | undefined;
  /**
   * Hold a channel's state from `seed`, once: the state the channel opens
   * with, from what its backend restores and what this host keeps beside it.
   * A channel already held keeps its state, and that state is the answer.
   */
  openState: (channel: string, kind: HeldState['kind'], seed: Bag) => Bag;
  /** Let a channel's state go, for a session or chat this host has closed. */
  closeState: (channel: string) => void;
  /**
   * A session's customizations as its state opens with them: the backend's
   * with this host's entries, then its clients' plugins, or nothing when there
   * are none.
   */
  laidCustomizations: (channel: string, reported: unknown) => Bag[] | undefined;
  /** Every state held, by channel. */
  heldStates: ReadonlyMap<string, HeldState>;
  /**
   * The questions host tools are waiting on, by the id this host asked them
   * under, and what settles or cancels them.
   */
  asks: Asking;
  /**
   * Let the state this host holds of a session go, its own and its chats',
   * for a session the residency lets go.
   */
  letStateGo: (session: string) => void;
  /**
   * Answer one client's dispatch with the reason it was not applied, at the
   * next `serverSeq`.
   *
   * Sent to every client the accepted action would reach, and held for
   * replay. No client's state takes it.
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
  /**
   * Stop watching a token's clock: it was replaced, revoked, or the client left.
   *
   * By the key the token is kept under in `Connection.tokens`, which is the
   * key `expiring` holds its clock by.
   */
  forgetExpiry: (key: string) => void;
  /**
   * Whether this connection is still here.
   *
   * A container takes time to build, and a client that went while its image
   * was building must not leave a relay running behind it.
   */
  alive: boolean;
  /** A dispatch applied now, under the origin its client sent it with, and what it waits on when it waits. */
  applyNow: (params: Record<string, unknown>, origin: Origin) => Promise<void> | undefined;
  /**
   * The subscription each channel holds on this connection, by channel: the
   * one a subscribe still being answered took, or the one that stands.
   *
   * One per channel, as the reference host's client record keeps one: a
   * subscribe of a channel not yet watched takes the place, one of a watched
   * channel shares the place that stands, and an unsubscribe empties it. A
   * subscribe whose place was taken before it was answered is refused.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2163-L2199
   */
  subscriptions: Map<string, object>;
  /**
   * The dev containers this connection opened, by the client's own name.
   *
   * Per connection, because a relay is one client's: the name is theirs,
   * nothing another client can spell reaches it, and a socket that drops
   * takes its containers with it. That is where the reference host keeps
   * them too.
   *
   * `tail` is the launcher's own last words, kept only so a container that
   * dies can say why in this log.
   */
  containers: Map<string, { name: string; folder: string; tail: string[] }>;
}
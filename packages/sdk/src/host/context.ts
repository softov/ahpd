import type { Agent } from '../types/agent.js';
import type { Connection, HostOptions, HostTool, ResourceProvider } from '../types/host.js';
import type { Session } from '../types/session.js';
import type { Bag } from '../types/common.js';
import type { AnnotationsState } from '@microsoft/agent-host-protocol';
import type { Terminal } from '../types/terminals.js';
import type { CallLinks } from '../calllinks.js';
import type { Claiming, Claimed, Held, Learned, LiveSubagent } from './state.js';
import type { Relay } from './relay.js';
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

/**
 * Everything an area of the host reaches for, in one object.
 *
 * Built once in `createHost` and handed to every area's factory, the way a
 * host tool is handed a `ToolCall`. A `let` in the closure that crosses into
 * another file is a field here, and it is read as `ctx.<name>` where it is
 * used rather than copied onto the factory's own scope at construction - so
 * the order the areas are built in never matters and nothing is frozen.
 */
export interface HostContext extends Routing, Relay, Changesets, Facts, Telemetry, Auth, Owners, Machines, SessionConfig, Root, Catalogue, History, Snapshots, Spawn, Lifecycle, Tooling, Terminals, Automations {
  /** The options `createHost` was given. */
  options: HostOptions;
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
  /** What each chat's summary last said, so an unchanged one is not re-sent. */
  described: Map<string, string>;
  /** The side index a worker's link is written from, fed from `dispatch`. */
  links: CallLinks;
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
  /** Say one thing on one channel. */
  dispatch: (channel: string, given: Record<string, unknown>) => void;
  /** The host's own log. */
  log: (message: string) => void;
}

/** What one connection's gate is built from. */
export interface ConnectionContext {
  /** The connection being admitted. */
  connection: Connection;
  /** Which store serves a URI. */
  storeFor: (uri: string) => HostOptions['resources'] | ResourceProvider;
}
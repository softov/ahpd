import type { Agent } from '../types/agent.js';
import type { Connection, HostOptions, ResourceProvider } from '../types/host.js';
import type { Session } from '../types/session.js';
import type { Bag } from '../types/common.js';
import type { Claiming, Claimed, Held, LiveSubagent } from './state.js';
import type { Relay } from './relay.js';
import type { Routing } from './routing.js';
import type { Changesets } from './changesets.js';
import type { Facts } from './facts.js';
import type { Telemetry } from './telemetry.js';
import type { Auth } from './auth.js';
import type { Owners } from './owners.js';
import type { Machines } from './machines.js';

/**
 * Everything an area of the host reaches for, in one object.
 *
 * Built once in `createHost` and handed to every area's factory, the way a
 * host tool is handed a `ToolCall`. A `let` in the closure that crosses into
 * another file is a field here, and it is read as `ctx.<name>` where it is
 * used rather than copied onto the factory's own scope at construction - so
 * the order the areas are built in never matters and nothing is frozen.
 */
export interface HostContext extends Routing, Relay, Changesets, Facts, Telemetry, Auth, Owners, Machines {
  /** The options `createHost` was given. */
  options: HostOptions;
  /** Every name this host holds or has handed out, and what it is. */
  claims: Map<string, Claimed>;
  /** The backends this host serves, by the id clients name. */
  agents: Map<string, Agent>;
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
  /** The lead chat of a held session, when it has one. */
  leadOf: (held: Held) => Session | undefined;
  /** The directories a session may be pointed at, by its own uri. */
  wheres: Map<string, string[]>;
  /** What the protocol's own `Status` says about a session. */
  statusOf: (uri: string) => number;
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
  /** The isolation schema and defaults for a session created in a directory. */
  isolating: (
    where: string | undefined,
    chosen?: string,
  ) => Promise<{ schema: Bag; defaults: Record<string, unknown>; repository?: string }>;
  /** The host-owned config keys a client sent, as this host reads them. */
  mineOf: (config: Record<string, unknown>) => Record<string, unknown>;
  /** A session's catalogue row moved. */
  summaryMoved: (uri: string) => void;
  /** A token any connected client lent for a resource, and has not run out. */
  lent: (resource: string) => string | undefined;
  /** Say one thing on one channel. */
  dispatch: (channel: string, given: Record<string, unknown>) => void;
  /** The host's own log. */
  log: (message: string) => void;
  /** The row a catalogue has for an id that is not running here. */
  waitingFor: (id: string) => string | undefined;
}

/** What one connection's gate is built from. */
export interface ConnectionContext {
  /** The connection being admitted. */
  connection: Connection;
  /** Which store serves a URI. */
  storeFor: (uri: string) => HostOptions['resources'] | ResourceProvider;
}
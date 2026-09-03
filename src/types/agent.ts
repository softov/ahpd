/** An agent backend, and everything the host asks one for. */

import type { Turn } from '@microsoft/agent-host-protocol';
import type { Bag } from './common.js';
import type { WireTurn } from './wire.js';
import type { Emit, Session } from './session.js';
import type { Offered } from './probe.js';

/**
 * One session a backend already has, before the host has named it.
 *
 * Deliberately not a `Summary`: the resource URI, the provider and the status
 * bits are the host's to decide - `IsRead` and `IsArchived` in particular are
 * kept per client and a backend has never heard of them.
 */
export interface Listed {
  /** The backend's own id for it. The host serves it as `<provider>:/<id>`. */
  id: string;
  /** Display title. */
  title: string;
  /** ISO 8601 timestamp of creation. */
  createdAt: string;
  /** ISO 8601 timestamp of the last change. */
  modifiedAt: string;
  /** Directories the agent has tool access to, as `file://` URIs. */
  workingDirectories: string[];
}

/** How the host asks a backend to start a session. */
export interface Start {
  /** The session channel URI the client chose. */
  uri: string;
  /** The chat channel URI beneath it. */
  chatUri: string;
  /** Config values in force, by key: this agent's defaults with the client's on top. */
  settings: Record<string, string>;
  /**
   * The directory the client asked the agent to work in, if it named one.
   *
   * A path, not a `file://` URI. Absent means the client named none and the
   * backend picks. A backend that will not work there should throw saying so:
   * a directory accepted and then ignored is a session running somewhere
   * nobody asked for, and nothing on screen says which.
   */
  workingDirectory?: string;
  /** The config schema to report on the session channel. This agent's own. */
  schema(): Bag;
  /** What to report as customizations until the backend reports its own. */
  seedCustomizations?: Bag[];
  /** Where state actions go. The host routes them to the right channel. */
  emit: Emit;
  /** A session of this backend's to continue, rather than starting a new one. */
  resume?: string;
  /** Turns already known, so a resumed session does not open empty. */
  seed?: Bag[];
  /**
   * A file a tool is about to change, and the same file once it has.
   *
   * Optional both ways: a backend that cannot see its own tools does not call
   * it, and a host with no changeset source does not pass one.
   */
  onFileEdit?(turnId: string, path: string, phase: 'before' | 'after'): void;
  /** Called once the backend has reported what it can do. */
  onHandshake?(): void;
  /**
   * Tokens for this backend's protected resources, by resource identifier.
   *
   * Only resources this agent advertised, and only what the connection
   * asking for the session pushed - authentication is per connection, so a
   * token one client offered is never spent on another's session. Absent for
   * a session nobody asked for: an automation firing at nine in the morning
   * has no connection behind it and runs on the daemon's own credentials.
   *
   * What to *do* with one is the backend's business. The host knows a token
   * belongs to a resource and nothing else about it.
   */
  credentials?: Record<string, string>;
}

/**
 * A backend the host can run sessions on.
 *
 * One host serves several. `provider` is what a client names in
 * `createSession` and what every session of this kind reports, so it has to
 * be unique across the agents a host was given.
 *
 * Everything but `provider`, `displayName`, `schema`, `defaults` and `create`
 * is optional, and what is left out is a real answer rather than a gap: a
 * backend with no `list` has no sessions to browse, one with no `probe`
 * offers no models and no commands until a session of its own reports them.
 */
export interface Agent {
  /** The id clients name. Unique among a host's agents. */
  provider: string;
  /** What a person reads instead of the id. */
  displayName: string;
  /** One line about what this backend is. */
  description?: string;

  /**
   * OAuth protected resources this backend can be given a token for.
   *
   * RFC 9728 metadata, served on `AgentInfo.protectedResources`, and the only
   * thing that makes `authenticate` callable: the protocol says a client's
   * `resource` MUST match one the server has itself advertised, so a host that
   * advertises none can be sent no token at all.
   *
   * `required: false` on an entry is a backend saying it works without one -
   * this daemon runs as whoever started it and inherits their credentials, so
   * a token is an override rather than a precondition.
   */
  protectedResources?: Bag[];

  /**
   * What a session of this kind can be told to do differently.
   *
   * A JSON-Schema-shaped `{ properties }`. Each property may carry `title`,
   * `description`, `enum`, `enumLabels`, `enumDescriptions`, `default` and
   * `sessionMutable` - the last deciding whether a client offers it on a
   * session that is already running.
   *
   * One schema, used before a session exists and by every session that does.
   * Two copies drift, and a composer then offers one set of controls on the
   * new-session screen and a different set the moment a session opens.
   */
  schema(): Bag;
  /** What each schema key sits at when nothing has been chosen. */
  defaults(): Record<string, string>;

  /**
   * What the backend offers, asked once at startup.
   *
   * Before any session exists, because that is when a client asks: the models
   * to pick from and the commands behind a slash are what a composer needs to
   * draw itself, and waiting for the first session means offering them only
   * once the conversation has started.
   */
  probe?(): Promise<Offered>;

  /**
   * The directories this backend will work in.
   *
   * The host's answer to "may this client read that file": a resource outside
   * every backend's directories is refused, because a host that served the
   * whole filesystem is one that anybody who can reach the port can read
   * `~/.ssh` through.
   *
   * Left out means this backend claims no directories, and contributes
   * nothing to what may be browsed.
   */
  directories?(): string[];

  /** Sessions this backend already has. Ordering is the host's business. */
  list?(): Promise<Listed[]>;

  /**
   * One past session's turns, read without starting anything.
   *
   * What makes a catalogue row openable: the host serves it from here, and
   * starts nothing until somebody sends a turn to it. Undefined means this
   * backend has no such session.
   *
   * A `WireTurn` rather than a `Bag[]`: everything around the parts is checked
   * here, and each part is checked where it is built - a part is assembled by
   * mutation as an agent talks, so the literal is what can be held to a shape
   * and the variable after it cannot. This was a `Bag[]`, and inside it a
   * rebuilt transcript wrote a tool-call `status` that is not one of the
   * seven, left off three fields the completed state requires, and gave its
   * content blocks no `type`.
   */
  transcript?(id: string): Promise<WireTurn<Turn>[] | undefined>;

  /** Start one. */
  create(start: Start): Session;
}

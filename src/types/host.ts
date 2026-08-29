/** The protocol server: channels, subscriptions and requests. */

import type { Agent } from './agent.js';
import type { Peer, Request } from './rpc.js';

/**
 * What a host can say about a directory beyond its path.
 *
 * Injected rather than built in. The interesting answers come from outside the
 * protocol - a branch is a `git` subprocess, and `git` is a binary that may
 * not be installed - and a host embedded in something that already knows them
 * should not have them read a second time. A host given none says only what a
 * path alone can tell it, which is the project's name.
 */
export interface DirectoryFacts {
  /**
   * What is known about a directory now, as the session's `_meta`.
   *
   * Synchronous and cheap, because it is asked for every description of every
   * session - a catalogue of a hundred rows asks a hundred times. Anything
   * that has to be fetched is fetched by `refresh` and cached here.
   *
   * The keys are the protocol's: `git` is the well-known one, and anything of
   * an implementation's own belongs under a namespace.
   */
  meta(dir: string): Record<string, unknown> | undefined;
  /**
   * Look again, answering whether anything actually moved.
   *
   * Asked once per served directory at startup and again whenever a turn
   * ends. Only a true answer reaches a client, so a directory that has not
   * changed costs nothing but the look.
   */
  refresh?(dir: string): Promise<boolean>;
}

/** How to construct a host. */
export interface HostOptions {
  /**
   * The directory whose sessions this host serves, on the machine it runs on.
   *
   * Also the catalogue's scope: sessions outside it are neither listed nor
   * openable.
   */
  path: string;
  /**
   * The backends this host serves.
   *
   * At least one, and each with a `provider` no other has. The first is what
   * a client gets when it names none - which is the ordinary case, since a
   * client that has read the root channel names one and one that has not
   * cannot.
   *
   * Nothing in the host knows what any of them are. `claude()` is one that
   * ships with it; anything satisfying `Agent` is another.
   */
  agents: Agent[];
  /**
   * What this host can say about the directories it serves.
   *
   * Left out, sessions carry their project and nothing more. `gitBranches()`
   * is the one that ships with this package, and the daemon uses it.
   */
  directories?: DirectoryFacts;
  /** Called with one line per notable event, for a log. */
  onEvent?(message: string): void;
}

/** One connected client and what it is watching. */
export interface Connection {
  /** Where to write messages for this client. */
  peer: Peer;
  /** The identifier the client gave at `initialize`. */
  clientId: string;
  /**
   * Channel URIs this client subscribed to.
   *
   * Per connection: two clients can watch one channel, and dropping one must
   * not stop the other's stream.
   */
  watching: Set<string>;
}

/** A protocol server. One host serves many connections. */
export interface Host {
  /**
   * Take a new client and return what answers it.
   *
   * The result's `handle` answers requests; its `close` must be called when
   * the connection drops, or the client's subscriptions leak.
   */
  accept(peer: Peer): {
    /** Answer one request from this client. */
    handle(request: Request): Promise<unknown>;
    /** Drop this client's subscriptions and state. */
    close(): void;
  };
  /** How many clients are currently connected. */
  connections(): number;
}

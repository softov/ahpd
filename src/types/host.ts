/** The protocol server: channels, subscriptions and requests. */

import type { Agent } from './agent.js';
import type { Peer, Request } from './rpc.js';

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

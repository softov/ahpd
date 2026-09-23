/** Accepting connections, on whichever JavaScript runtime is running. */

import type { Peer, Request } from './rpc.js';
import type { Principal } from './users.js';

/** One accepted client, for as long as its connection lasts. */
export interface Connected {
  /** Answer one request from this client. */
  handle(request: Request): Promise<unknown>;
  /** Release what the connection held. Called once, when it drops. */
  close(): void;
}

/**
 * Called per connection, to hand it to whatever will answer it.
 *
 * The person is the one the presented token resolved to, when it resolved to
 * somebody: the deployment's own token names nobody, and a host with no
 * directory resolves nobody. It is passed here rather than looked up later
 * because the door is the only place the token is still in hand.
 */
export type OnConnect = (peer: Peer, principal?: Principal) => Connected;

/**
 * Called with every frame, in either direction, as it crosses the socket.
 *
 * `from` is who wrote it; `text` is the frame as sent, before this side has
 * parsed it or after it was serialised, which is the one form both ends of a
 * connection agree on; `peer` numbers the connection, from one, so a capture
 * of a host with three clients can be read apart. Called on the socket's own
 * path, so it must not throw and should not block.
 */
export type Tap = (from: 'client' | 'host', text: string, peer: number) => void;

/** The runtimes a listener can be running on. */
export type Runtime = 'node' | 'bun' | 'deno';

/** A running server. */
export interface Listener {
  /** Which runtime was detected. */
  readonly runtime: Runtime;
  /** The address it bound. */
  readonly host: string;
  /** The port it accepted. */
  readonly port: number;
  /** Whether a connection token is required. */
  readonly guarded: boolean;
  /** Stop accepting and drop open connections. */
  close(): void | Promise<void>;
}

/** Where to accept connections, and who may open one. */
export interface ListenOptions {
  /** TCP port to bind. */
  port: number;
  /**
   * Address to bind.
   *
   * Loopback by default, which is the only address that needs no secret:
   * anything reaching it is already on this machine. `0.0.0.0` is every
   * interface, and is what a connection token is for.
   */
  host?: string;
  /**
   * A secret every connection must present, or nothing to accept any.
   *
   * Given as `?tkn=<token>` on the WebSocket URL or as an
   * `Authorization: Bearer <token>` header. Browsers cannot set headers on a
   * WebSocket, which is why the query string is the one that always works.
   */
  token?: string;
  /**
   * Who a token belongs to, when it is not the deployment's own.
   *
   * Asked only about a token that is not `token`, and only when one was
   * presented. A daemon wires this to its user directory, so a person's own
   * secret opens the socket and arrives as their principal before the first
   * frame. A host with no directory passes none, and the door refuses exactly
   * what it refused before. The answer may be a promise, since the directory
   * is a port.
   */
  identify?: (token: string) => Promise<Principal | undefined> | Principal | undefined;
  /** Sees every frame, both ways. Nothing is recorded without one. */
  tap?: Tap;
}

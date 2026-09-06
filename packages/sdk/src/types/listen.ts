/** Accepting connections, on whichever JavaScript runtime is running. */

import type { Peer, Request } from './rpc.js';

/** One accepted client, for as long as its connection lasts. */
export interface Connected {
  /** Answer one request from this client. */
  handle(request: Request): Promise<unknown>;
  /** Release what the connection held. Called once, when it drops. */
  close(): void;
}

/** Called per connection, to hand it to whatever will answer it. */
export type OnConnect = (peer: Peer) => Connected;

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
}

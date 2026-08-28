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
  /** The port it accepted. */
  readonly port: number;
  /** Stop accepting and drop open connections. */
  close(): void | Promise<void>;
}

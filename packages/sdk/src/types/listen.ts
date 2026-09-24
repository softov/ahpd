/** Accepting connections, on whichever JavaScript runtime is running. */

import type { Readable, Writable } from 'node:stream';
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
export type OnConnect = (peer: Peer, principal?: Principal, root?: boolean) => Connected;

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
   * What a token presented at the door turned out to be.
   *
   * `undefined` is a token this host does not know, and the socket is refused.
   * An object is a token that opens the door: with a `principal` it is also who
   * they are, and without one it says nobody. A person's own token answers the
   * second unless their record trusts it - decision `the-door-is-a-door`.
   */
  identify?: (token: string) => Promise<Arrival | undefined> | Arrival | undefined;
  /**
   * Whether the deployment's own token is the host itself.
   *
   * True and a socket admitted on `token` is the host: every capability, and
   * no sign-in. Absent and that token only opens the door, which is what a
   * host that has no directory behind it wants. The host's own key is exempt
   * from having to authorize itself, which is the one thing this does not
   * change.
   */
  root?: boolean;
  /** Sees every frame, both ways. Nothing is recorded without one. */
  tap?: Tap;
}

/**
 * What a presented token turned out to be, as `identify` answers it.
 *
 * An empty object is a door token that says nobody: the socket is admitted and
 * every gated command answers `-32007` until somebody signs in. A `principal`
 * is a door token that authorizes its holder as well, which is what a person's
 * own token does only when their record says `trustToken`.
 */
export interface Arrival {
  principal?: Principal;
}

/**
 * Where to accept one connection, when the connection is a pipe.
 *
 * There is no port and no token because there is nothing to bind and nobody to
 * refuse: a process holding this one's stdin and stdout is the only thing that
 * can reach it, and whoever started it decided that. A host is run this way to
 * be carried by another host - decision `a-nested-host-speaks-stdio` - so the
 * connection is the host itself unless the caller says otherwise.
 */
export interface StdioOptions {
  /**
   * Whether this connection is the host itself.
   *
   * True by default, which is what a nested host wants. False is for a caller
   * that spawned this process on somebody else's behalf and wants the
   * connection to arrive as nobody, with `authenticate` left to authorize it.
   */
  root?: boolean;
  /** Sees every frame, both ways. Nothing is recorded without one. */
  tap?: Tap;
  /**
   * Where frames are read from and written to.
   *
   * This process's own stdin and stdout unless a caller names others, which is
   * what makes the transport testable without taking over the test runner's
   * own pipes.
   */
  input?: Readable;
  output?: Writable;
}

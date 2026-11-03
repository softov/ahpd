/** Accepting connections, on whichever JavaScript runtime is running. */

import type { IncomingMessage, ServerResponse } from 'node:http';
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
 * A connection that is its own wire.
 *
 * A node's session socket carries another host's frames as they are, so this
 * side parses none of them: `raw` is one message, as it arrived, and what
 * answers it is the host the socket was given to.
 */
export interface Raw {
  /** One message, exactly as the socket delivered it. */
  raw(text: string): void;
  /** Release what the connection held. Called once, when it drops. */
  close(): void;
}

/**
 * Where a connection came in, what it is, and which node it is.
 *
 * The door decides who may open a connection, and the two runtimes hand the
 * request over separately, so the rest of what it carried arrives here: the
 * URL, which names a session's socket, the node whose own token admitted it -
 * always both or neither, because only the join path admits a node - and what
 * the runtime could say about the socket itself.
 */
export interface Opened {
  /** The URL it was opened on, as the request carried it. */
  url?: string;
  /** The node whose own token admitted it, on the join path. */
  node?: string;
  /** The number this socket was given, the one `Tap` reports each frame under. */
  socket?: number;
  /** The remote address the runtime reported for the socket. */
  address?: string;
  /**
   * The `X-Forwarded-For` text the request carried, kept as it was sent.
   *
   * The client's claim and not a measurement: a proxy in front of this
   * listener is what makes it worth reading, and nothing here trusts it.
   */
  forwardedFor?: string;
}

/**
 * Called per connection, to hand it to whatever will answer it.
 *
 * The person is the one the presented token resolved to, when it resolved to
 * somebody: the deployment's own token names nobody, and a host with no
 * directory resolves nobody. It is passed here rather than looked up later
 * because the door is the only place the token is still in hand.
 *
 * An answer is either a `Connected`, which is answered frame by frame, or a
 * `Raw`, which is handed every message whole.
 */
export type OnConnect = (peer: Peer, principal?: Principal, root?: boolean, opened?: Opened) => Connected | Raw;

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
  /**
   * Stop accepting, let a response in flight finish for up to two seconds,
   * and drop the rest of the connections. Settles once the port is free, on
   * Node, Bun and Deno alike; a Deno shutdown still waiting after those two
   * seconds is no longer waited on.
   */
  close(): void | Promise<void>;
}

/**
 * What a listener holds a client by: how much of a queue it will keep, and
 * where a client that went past it is said.
 *
 * A listener knows nothing of root config, so this is a reader rather than a
 * number - what the caller bound the listener by, read at each send, the way
 * the host reads its own key. Left out, a socket's queue is the socket's own
 * business, which is what every WebSocket server does by default.
 */
export interface Bounds {
  /** The most this listener will hold for one client, in bytes, as it is set now. */
  clientQueueBytes?: () => number;
  /**
   * Where a client closed for being behind is said, with what it was holding.
   *
   * Read when `clientQueueBytes` is given and nothing else: a client is closed
   * for being behind by this limit or by no reason at all, and nothing is
   * written without a log to write to.
   */
  log?: (line: string) => void;
}

/** Where to accept connections, and who may open one. */
export interface ListenOptions extends Bounds {
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
   * first unless their record requires the issuer - decision
   * `a-persons-token-names-them-unless-the-issuer-is-required`.
   */
  identify?: (token: string) => Promise<Arrival | undefined> | Arrival | undefined;
  /**
   * The path another host joins on, and the nodes whose tokens it takes.
   *
   * Given, a request on that path is decided by that token alone: the
   * deployment's own token and `identify` are not asked, since a node's token
   * opens the join path and nothing else. Left out, the path is a client's
   * like any other, and no node can join this listener.
   */
  join?: NodeDoor;
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
  /**
   * Plain HTTP requests, answered on the same port as the WebSocket.
   *
   * The upgrade is still the WebSocket's; a request that is not one is handed
   * here and the handler answers it in full. Left out, this listener answers a
   * plain request by its token, as `plainAnswer` does: 401 with the
   * handshake's sentence when the handshake would refuse the token, and 426
   * when it would admit it, both readable from any origin. Bun and Deno serve
   * this handler as it is; Node serves `nodeRequest`, and refuses to start
   * without it.
   */
  request?: RequestHandler;
  /** The same plain requests as a `node:http` listener, which is what Node serves. */
  nodeRequest?: NodeRequestListener;
}

/** The part of `ListenOptions` that decides who may open a connection. */
export type DoorOptions = Pick<ListenOptions, 'token' | 'identify' | 'root' | 'join'>;

/**
 * The path another host joins on, and who may.
 *
 * A request on this path presents a node's own token, which is the only
 * credential it answers: the deployment's token and the people directory are
 * not consulted, because a node's token opens this door and no other door.
 */
export interface NodeDoor {
  /** The path, such as `/join`. A session's socket is the same path with `data`. */
  path: string;
  /** The node whose own token this is, or nothing to refuse the request. */
  verify(token: string): Promise<string | undefined>;
}

/**
 * What the door decided about one request's token.
 *
 * Admitted, with the person it named when it named one, `root` when it is the
 * host itself, and `node` when a node's own token opened the join path; or
 * refused.
 */
export type Admission =
  | { admitted: true; principal?: Principal; root?: boolean; node?: string }
  | { admitted: false };

/** The door: the decision on a request's URL and its `Authorization` header. */
export type Door = (url: string | undefined, authorization: string | null) => Promise<Admission>;

/**
 * A plain HTTP request handler: one `Request` in, one `Response` out.
 *
 * The shape `Bun.serve` and `Deno.serve` take. Its promise resolves with every
 * answer, a refusal included.
 */
export type RequestHandler = (request: globalThis.Request) => Promise<Response>;

/**
 * A plain HTTP request handler as `node:http` takes one.
 *
 * The host builds it from its `RequestHandler`, so the two answer alike; this
 * package mounts it on Node and has no adapter of its own.
 */
export type NodeRequestListener = (request: IncomingMessage, response: ServerResponse) => void;

/** Where to serve plain HTTP requests, and nothing else. */
export interface RequestsOptions {
  /** TCP port to bind; 0 is the OS choosing. */
  port: number;
  /** Address to bind, loopback by default. */
  host?: string;
  /** The handler as a `node:http` listener, which is what Node serves and requires. */
  nodeRequest?: NodeRequestListener;
}

/** A running plain HTTP server. */
export interface RequestsListener {
  /** Which runtime was detected. */
  readonly runtime: Runtime;
  /** The address it bound. */
  readonly host: string;
  /** The port it bound. */
  readonly port: number;
  /**
   * Stop accepting, let a response in flight finish for up to two seconds,
   * and drop the rest of the connections. Settles once the port is free, on
   * Node, Bun and Deno alike; a Deno shutdown still waiting after those two
   * seconds is no longer waited on.
   */
  close(): void | Promise<void>;
}

/**
 * What a presented token turned out to be, as `identify` answers it.
 *
 * An empty object is a door token that says nobody: the socket is admitted and
 * every gated command answers `-32007` until somebody signs in. A `principal`
 * is a door token that authorizes its holder as well, which is what a person's
 * own token does unless their record requires the issuer.
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
export interface StdioOptions extends Bounds {
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

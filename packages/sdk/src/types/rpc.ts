import type { LogLevel } from '../log.js';
/** JSON-RPC 2.0 over a single connection. */

/** One decoded JSON-RPC call: a method name and its parameters. */
export interface Request {
  /** The JSON-RPC `method` field, e.g. `subscribe`. */
  readonly method: string;
  /** The `params` object, or an empty object when the call carried none. */
  readonly params: Record<string, unknown>;
}

/**
 * The bytes end of one connection.
 *
 * Implemented per runtime, since Node, Bun and Deno expose different socket
 * objects.
 */
export interface Wire {
  /** Write one frame. */
  send(text: string): void;
  /** Close the connection. */
  close(): void;
  /** Whether a `send` would still reach the client. */
  isOpen(): boolean;
  /**
   * How many bytes this wire is still holding for its client.
   *
   * What the socket took and the client has not read, in bytes: a client that
   * reads slowly makes this grow, and one that has stopped reading makes it
   * grow without end. Absent on a wire with no queue behind it - the
   * in-process pair - which is also a wire that cannot fall behind.
   */
  buffered?(): number;
}

/**
 * What bounds one client: the most this host will hold for it, and where a
 * client that went past it is said.
 *
 * `limit` is a reader rather than a number, because the value is a root config
 * key: read at each send, a limit pushed while the host runs applies to the
 * frame after it rather than at the next restart.
 */
export interface Bounding {
  /** The most this host's wire may hold for this client, in bytes, as it is set now. */
  limit(): number;
  /**
   * Where a client closed for being behind is said, and what it was holding.
   *
   * Nothing is said without one, the way nothing is recorded without a `tap`:
   * a listener or a host nobody asked to hear from closes the socket and
   * writes no line.
   */
  log?(line: string, level?: LogLevel): void;
}

/**
 * The JSON-RPC end of one connection: messages rather than frames.
 *
 * Both directions. AHP is symmetrical - `ServerCommandMap` names ten methods
 * a host may call on a client, and a client publishes resources a host is
 * expected to be able to read - so a peer that could only answer was half a
 * connection.
 */
export interface Peer {
  /** Send a complete JSON-RPC message. Dropped if the connection has closed. */
  send(message: Record<string, unknown>): void;
  /** Send a server-to-client notification, which carries no id and gets no reply. */
  notify(method: string, params: unknown): void;
  /**
   * Send one frame already written, as the socket would carry it.
   *
   * What a connection that is its own wire needs: a relayed line is another
   * host's frame and not this one's message, so reading it to write it back
   * would put this host inside a conversation it is not part of. Absent on a
   * peer built for a caller that has no such connection.
   */
  raw?(text: string): void;
  /**
   * Ask the client something, and wait for what it says.
   *
   * Rejects with an `RpcError` the client sent, an `RpcTimeout` when nothing
   * came back inside `timeoutMs`, or an `RpcClosed` when the connection went
   * away with the question still in flight. Three outcomes, three types: a
   * caller that has to tell "the client refused" from "the client is gone"
   * cannot do it by reading a message.
   */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  /**
   * Take one JSON-RPC response off the wire and settle whatever asked for it.
   *
   * Called by `receive` for a message carrying `result` or `error` and no
   * `method`. An id nothing here asked about is dropped: a response is not a
   * request, and answering one is the violation this exists to stop.
   */
  answered(message: Record<string, unknown>): void;
  /** Close the connection, rejecting every question still unanswered. */
  close(): void;
  /**
   * The bytes this connection's wire is still holding for its client, or
   * nothing where the wire cannot say.
   *
   * The same number `Wire.buffered` reports, read here because a host holds
   * peers and not wires: how far behind a client is, is the one thing about a
   * connection that cannot be seen from a frame.
   */
  buffered?(): number | undefined;
  /**
   * Bound this connection: past what the wire holds, the host writes nothing
   * more to this client and closes it.
   *
   * A peer is built by whichever listener accepted the socket, and the limit
   * is the host's own - a root config key the listener knows nothing of - so
   * the host binds the peer it was handed rather than the listener being told
   * a number it cannot read.
   */
  bounded?(bounding: Bounding): void;
}

/**
 * Answers one request.
 *
 * The resolved value becomes the JSON-RPC `result`. Throwing an `RpcError`
 * produces that error's code; any other throw becomes an internal error.
 * Returning nothing for a notification is correct - notifications get no reply.
 */
export type Handler = (request: Request, peer: Peer) => Promise<unknown> | unknown;

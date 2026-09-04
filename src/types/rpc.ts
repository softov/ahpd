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
}

/**
 * Answers one request.
 *
 * The resolved value becomes the JSON-RPC `result`. Throwing an `RpcError`
 * produces that error's code; any other throw becomes an internal error.
 * Returning nothing for a notification is correct - notifications get no reply.
 */
export type Handler = (request: Request, peer: Peer) => Promise<unknown> | unknown;

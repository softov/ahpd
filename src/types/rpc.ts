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

/** The JSON-RPC end of one connection: messages rather than frames. */
export interface Peer {
  /** Send a complete JSON-RPC message. Dropped if the connection has closed. */
  send(message: Record<string, unknown>): void;
  /** Send a server-to-client notification, which carries no id and gets no reply. */
  notify(method: string, params: unknown): void;
  /** Close the connection. */
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

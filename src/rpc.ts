import type { WebSocket } from 'ws';

/**
 * JSON-RPC 2.0, over one WebSocket.
 *
 * The transport and nothing else: what a method *means* is the host's
 * business, and framing is the part every method shares. Kept apart because
 * the host is the interesting file and this one is not - and because a
 * transport that is a separate object is a transport a test can drive without
 * a socket.
 *
 * AHP is JSON-RPC with one deviation worth knowing: a *notification* is a
 * message with no `id`, and the client sends two of them - `unsubscribe` and
 * `dispatchAction`. Answering a notification is a protocol error, so the
 * absence of an id is what decides whether a reply is written, never the
 * handler's return value.
 */

export interface Request {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

export class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

/** Standard JSON-RPC, which AHP extends rather than replaces. */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;

export interface Peer {
  /** Answer a request, or refuse it. */
  send(message: Record<string, unknown>): void;
  /** A server-to-client notification: no id, and no answer expected. */
  notify(method: string, params: unknown): void;
  close(): void;
}

export type Handler = (request: Request, peer: Peer) => Promise<unknown> | unknown;

/**
 * Read one socket, and answer it.
 *
 * `onClose` matters more than it looks: a subscription is per connection, and
 * a host that does not drop them when the socket goes keeps reducing state
 * into a set of observers nobody is reading - which is a leak that only shows
 * up after a client has reconnected a few dozen times.
 */
export function serve(socket: WebSocket, handle: Handler, onClose?: () => void): Peer {
  const peer: Peer = {
    send: (message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
    notify: (method, params) => {
      peer.send({ jsonrpc: '2.0', method, params });
    },
    close: () => socket.close(),
  };

  socket.on('message', (data: Buffer | string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
    } catch {
      peer.send({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Not JSON' } });
      return;
    }

    const message = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
    const method = typeof message.method === 'string' ? message.method : undefined;
    // No id is a notification. Not "an id we did not read" - the difference
    // decides whether anything is written back at all.
    const id = typeof message.id === 'number' ? message.id : undefined;

    if (!method) {
      if (id !== undefined) {
        peer.send({ jsonrpc: '2.0', id, error: { code: INVALID_REQUEST, message: 'No method' } });
      }
      return;
    }

    const params = (typeof message.params === 'object' && message.params !== null
      ? message.params
      : {}) as Record<string, unknown>;

    void (async () => {
      try {
        const result = await handle({ method, params }, peer);
        if (id !== undefined) peer.send({ jsonrpc: '2.0', id, result: result ?? {} });
      } catch (error) {
        if (id === undefined) return;
        const code = error instanceof RpcError ? error.code : INTERNAL_ERROR;
        const message_ = error instanceof Error ? error.message : String(error);
        peer.send({
          jsonrpc: '2.0',
          id,
          error: {
            code,
            message: message_,
            ...(error instanceof RpcError && error.data !== undefined ? { data: error.data } : {}),
          },
        });
      }
    })();
  });

  socket.on('close', () => onClose?.());
  return peer;
}



export class RpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

/**
 * JSON-RPC 2.0 framing.
 *
 * Decodes incoming frames, dispatches them to a handler and encodes the
 * replies. It holds no socket: `Wire` is the only thing it writes through, and
 * `listen.ts` connects that to whichever runtime's WebSocket is in use.
 *
 * A message with no `id` is a notification and receives no reply, whatever the
 * handler returns.
 */

import type { Handler, Peer, Request, Wire } from './types/rpc.js';
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;

/** Answer over one wire. */
export function createPeer(wire: Wire): Peer {
  const peer: Peer = {
    send: (message) => {
      if (wire.isOpen()) wire.send(JSON.stringify(message));
    },
    notify: (method, params) => {
      peer.send({ jsonrpc: '2.0', method, params });
    },
    close: () => wire.close(),
  };
  return peer;
}

/**
 * One frame in, and whatever it deserves back.
 *
 * AHP is JSON-RPC with one deviation worth knowing: a *notification* is a
 * message with no `id`, and the client sends two of them - `unsubscribe` and
 * `dispatchAction`. Answering a notification is a protocol error, so the
 * absence of an id is what decides whether a reply is written, never the
 * handler's return value.
 */
export function receive(raw: string, peer: Peer, handle: Handler): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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
      const text = error instanceof Error ? error.message : String(error);
      peer.send({
        jsonrpc: '2.0',
        id,
        error: {
          code,
          message: text,
          ...(error instanceof RpcError && error.data !== undefined ? { data: error.data } : {}),
        },
      });
    }
  })();
}

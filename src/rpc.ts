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

/**
 * An error carrying a JSON-RPC code, and whatever the client needs to act.
 *
 * The fields are declared and assigned rather than written as constructor
 * parameter properties, which are the one piece of TypeScript in this
 * codebase that *emits* code: a runtime that only strips types cannot run
 * them, and running this source unbuilt is worth more than the two lines.
 */
export class RpcError extends Error {
  /** The JSON-RPC error code. */
  readonly code: number;
  /** Structured detail for the client, where there is any. */
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/** How long a question to a client waits before it is given up on. */
export const ANSWER_TIMEOUT = 30_000;

/**
 * A question this host asked that never came back.
 *
 * Its own type rather than an `RpcError`: nothing arrived, so there is no code
 * a client chose and no data it sent. A timeout read as an error the client
 * returned is an answer attributed to somebody who never gave one.
 */
export class RpcTimeout extends Error {
  /** The method that went unanswered. */
  readonly method: string;

  constructor(method: string, ms: number) {
    super(`${method} went unanswered for ${ms}ms`);
    this.name = 'RpcTimeout';
    this.method = method;
  }
}

/** A question still in flight when the connection went away. */
export class RpcClosed extends Error {
  /** The method that was in flight. */
  readonly method: string;

  constructor(method: string) {
    super(`The connection closed with ${method} still unanswered`);
    this.name = 'RpcClosed';
    this.method = method;
  }
}

/** Ask and answer over one wire. */
export function createPeer(wire: Wire): Peer {
  /*
   * The ids this host spends asking, which are its own to allocate.
   *
   * JSON-RPC numbers each direction separately - the id on a request this
   * host sends is the one the client answers with - so nothing here has to
   * avoid the ids a client is spending on its own requests.
   */
  let asked = 0;
  const waiting = new Map<number, {
    method: string;
    settle(error: Error | undefined, result?: unknown): void;
  }>();

  const peer: Peer = {
    send: (message) => {
      if (wire.isOpen()) wire.send(JSON.stringify(message));
    },
    notify: (method, params) => {
      peer.send({ jsonrpc: '2.0', method, params });
    },
    request: (method, params, timeoutMs = ANSWER_TIMEOUT) => new Promise((resolve, reject) => {
      // Refused rather than sent into a closed socket, where it would sit
      // until the timeout to say what is already known.
      if (!wire.isOpen()) {
        reject(new RpcClosed(method));
        return;
      }
      const id = ++asked;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new RpcTimeout(method, timeoutMs));
      }, timeoutMs);
      // Unreferenced, so a question nobody is going to answer does not hold
      // the process open by itself.
      (timer as unknown as { unref?(): void }).unref?.();
      waiting.set(id, {
        method,
        settle: (error, result) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(result);
        },
      });
      peer.send({ jsonrpc: '2.0', id, method, params });
    }),
    answered: (message) => {
      const id = typeof message.id === 'number' ? message.id : undefined;
      if (id === undefined) return;
      const held = waiting.get(id);
      // An answer to a question this host never asked. Dropped, because there
      // is nobody to hand it to and a response deserves no reply.
      if (!held) return;
      waiting.delete(id);
      const failure = (typeof message.error === 'object' && message.error !== null
        ? message.error
        : undefined) as { code?: unknown; message?: unknown; data?: unknown } | undefined;
      if (!failure) {
        held.settle(undefined, message.result);
        return;
      }
      held.settle(new RpcError(
        typeof failure.code === 'number' ? failure.code : INTERNAL_ERROR,
        typeof failure.message === 'string' ? failure.message : 'The client refused',
        failure.data,
      ));
    },
    close: () => {
      // Everything in flight, before the socket goes: a promise left pending
      // on a dead connection never settles at all.
      for (const [id, held] of [...waiting]) {
        waiting.delete(id);
        held.settle(new RpcClosed(held.method));
      }
      wire.close();
    },
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

  /*
   * A response, which is a message carrying an answer and naming no method.
   *
   * Read before anything decides the frame is malformed. This used to answer
   * `-32600 No method` to every answer a client gave, which is a JSON-RPC
   * violation - a response is not a request and gets no reply - and it made
   * the whole reverse direction unusable: asking a client anything produced
   * an answer this host then argued with.
   */
  if (method === undefined && ('result' in message || 'error' in message)) {
    peer.answered(message);
    return;
  }

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

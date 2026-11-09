import { WAIT_MS } from '../../../tools/wait.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPeer, receive, RpcClosed, RpcError, RpcTimeout, INVALID_PARAMS, numberParam, optionalStringParam, stringParam } from '../src/rpc.js';
import type { Wire } from '../src/types/rpc.js';

/*
 * JSON-RPC framing, in both directions.
 *
 * The reverse direction is the half that was missing: AHP is symmetrical, and
 * a host that answers a client's response with an error can never be answered
 * itself. What is checked here is that a response is recognised as one, and
 * that a question this host asks ends in exactly one of four ways.
 */

/**
 * A socket, kept as decoded messages so a test reads what was sent.
 *
 * `buffered` is what the socket still holds for its client, which a wire that
 * cannot queue - the in-process pair - leaves out entirely.
 */
function wire(buffered?: () => number): Wire & { written: Record<string, unknown>[]; shut(): void } {
  const written: Record<string, unknown>[] = [];
  let open = true;
  return {
    written,
    send: (text) => { written.push(JSON.parse(text) as Record<string, unknown>); },
    close: () => { open = false; },
    isOpen: () => open,
    shut: () => { open = false; },
    ...(buffered === undefined ? {} : { buffered }),
  };
}

/** Nothing here is served: these tests are about the framing, not the host. */
const nothing = () => ({});

afterEach(() => { vi.useRealTimers(); });

describe('a response arriving from a client', () => {
  it('is not answered, because a response is not a request', () => {
    const socket = wire();
    const peer = createPeer(socket);
    const handled: string[] = [];
    receive(JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} }), peer, (request) => {
      handled.push(request.method);
      return {};
    });
    // Neither answered nor dispatched. This used to reply `-32600 No method`,
    // which is a JSON-RPC violation and made asking a client anything
    // produce an argument rather than an answer.
    expect(socket.written).toEqual([]);
    expect(handled).toEqual([]);
  });

  it('is dropped when it answers a question this host never asked', () => {
    const socket = wire();
    const peer = createPeer(socket);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 999, error: { code: -1, message: 'no' } }), peer, nothing);
    expect(socket.written).toEqual([]);
  });

  it('does not excuse a frame that carries neither a method nor an answer', () => {
    const socket = wire();
    const peer = createPeer(socket);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 7 }), peer, nothing);
    expect(socket.written).toEqual([
      { jsonrpc: '2.0', id: 7, error: { code: -32600, message: 'No method' } },
    ]);
  });
});

describe('a question this host asks', () => {
  it('is answered by the client that was asked', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    const asked = peer.request('resourceRead', { uri: 'virtual://note' });
    expect(socket.written).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'resourceRead', params: { uri: 'virtual://note' } },
    ]);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: 'hello' } }), peer, nothing);
    await expect(asked).resolves.toEqual({ content: 'hello' });
  });

  it('carries the client\'s own refusal back, code and all', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    const asked = peer.request('resourceRead', { uri: 'virtual://secret' });
    receive(
      JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32009, message: 'Not yours', data: { uri: 'x' } } }),
      peer,
      nothing,
    );
    await expect(asked).rejects.toMatchObject({
      name: 'RpcError', code: -32009, message: 'Not yours', data: { uri: 'x' },
    });
    await asked.catch(() => {});
  });

  it('gives up when nothing comes back', async () => {
    vi.useFakeTimers();
    const socket = wire();
    const peer = createPeer(socket);
    const asked = peer.request('resourceRead', { uri: 'virtual://slow' }, 500);
    const caught = asked.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    // Its own type, not an `RpcError`: nothing arrived, so there is no code a
    // client chose and nothing it said.
    expect(await caught).toBeInstanceOf(RpcTimeout);
  });

  it('ignores an answer that arrives after it gave up', async () => {
    vi.useFakeTimers();
    const socket = wire();
    const peer = createPeer(socket);
    const caught = peer.request('resourceRead', {}, 500).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    expect(await caught).toBeInstanceOf(RpcTimeout);
    // Late, and settling nothing. A pending entry that outlived its promise
    // is the leak this asserts against.
    receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), peer, nothing);
    expect(socket.written).toHaveLength(1);
  });

  it('is given up on when the connection goes with it still in flight', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    const caught = peer.request('resourceRead', {}).catch((error: unknown) => error);
    peer.close();
    expect(await caught).toBeInstanceOf(RpcClosed);
  });

  it('is refused outright on a connection that has already closed', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    socket.shut();
    await expect(peer.request('resourceRead', {})).rejects.toBeInstanceOf(RpcClosed);
    // Never written, so a caller is told now rather than at the timeout.
    expect(socket.written).toEqual([]);
  });

  it('settles each question once, whatever else arrives on its id', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    const asked = peer.request('ping', {});
    receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { first: true } }), peer, nothing);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { second: true } }), peer, nothing);
    await expect(asked).resolves.toEqual({ first: true });
    // And the second answer wrote nothing back either.
    expect(socket.written).toHaveLength(1);
  });

  it('numbers its own questions without minding the ids a client spends', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    void peer.request('ping', {}).catch(() => {});
    void peer.request('ping', {}).catch(() => {});
    expect(socket.written.map((message) => message.id)).toEqual([1, 2]);
    peer.close();
  });
});

/*
 * What a host does with a client that is not reading.
 *
 * The check is at the send and nowhere else, because the number it turns on is
 * the socket's own: what this host has written and the client has not taken.
 * One queue per connection, so a client that stalls is closed rather than
 * queued for, and the client beside it is untouched.
 */
describe('a client that is not reading', () => {
  const LIMIT = 1024 * 1024;

  it('is written to while its queue is under the limit, whatever the frame weighs', () => {
    const socket = wire(() => LIMIT);
    const peer = createPeer(socket, { limit: () => LIMIT });
    // At the limit and not past it, and the frame's own size is no reason to
    // hold back: one large snapshot still has to reach a client that reads.
    peer.notify('action', { frame: 'x'.repeat(4 * LIMIT) });
    expect(socket.written).toHaveLength(1);
    expect(socket.isOpen()).toBe(true);
  });

  it('is closed, with the frame dropped and the queue said, past the limit', () => {
    const said: string[] = [];
    const socket = wire(() => LIMIT + 1);
    const peer = createPeer(socket, { limit: () => LIMIT, log: (line) => { said.push(line); } });
    peer.notify('action', {});
    expect(socket.written).toEqual([]);
    expect(socket.isOpen()).toBe(false);
    expect(said).toEqual([
      `held ${LIMIT + 1} bytes for a client that is not reading, past the ${LIMIT} it is allowed, and was closed`,
    ]);
  });

  it('is read at each send, so a limit pushed while the host runs applies to the next frame', () => {
    let limit = 2 * LIMIT;
    const socket = wire(() => LIMIT + 1);
    const peer = createPeer(socket, { limit: () => limit });
    peer.notify('action', {});
    expect(socket.written).toHaveLength(1);
    // A lower value under the same key, which is what a client's push leaves
    // behind: the number is asked for rather than held at the binding.
    limit = LIMIT;
    peer.notify('action', {});
    expect(socket.written).toHaveLength(1);
    expect(socket.isOpen()).toBe(false);
  });

  it('is left alone where the wire cannot say what it holds', () => {
    const socket = wire();
    const peer = createPeer(socket, { limit: () => 1 });
    peer.notify('action', {});
    // A wire with no queue behind it cannot fall behind, whatever it was
    // bound by - the in-process pair, and every fake in this suite.
    expect(socket.written).toHaveLength(1);
    expect(socket.isOpen()).toBe(true);
  });

  it('takes a question in flight down with it, rather than leaving it to time out', async () => {
    const socket = wire(() => LIMIT + 1);
    const peer = createPeer(socket, { limit: () => LIMIT });
    const asked = peer.request('resourceRead', {}).catch((error: unknown) => error);
    // The question was never written, and the connection it was asked on is
    // closed: what a caller gets is the close, not thirty seconds of silence.
    expect(socket.written).toEqual([]);
    expect(await asked).toBeInstanceOf(RpcClosed);
  });
});

describe('an error the handler throws', () => {
  it('keeps the code when it is an RpcError', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'subscribe' }), peer, () => {
      throw new RpcError(-32001, 'Nothing there');
    });
    await vi.waitFor(() => expect(socket.written).toHaveLength(1), { timeout: WAIT_MS });
    expect(socket.written[0]).toEqual({
      jsonrpc: '2.0', id: 3, error: { code: -32001, message: 'Nothing there' },
    });
  });

  it('keeps the code and data of an error shaped like RpcError from another copy of the sdk', async () => {
    /** `RpcError` as a second installed copy of the sdk declares it: the same shape, another class. */
    class CopiedRpcError extends Error {
      readonly code: number;
      readonly data?: unknown;
      constructor(code: number, message: string, data?: unknown) {
        super(message);
        this.name = 'RpcError';
        this.code = code;
        this.data = data;
      }
    }
    const socket = wire();
    const peer = createPeer(socket);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'subscribe' }), peer, () => {
      throw new CopiedRpcError(-32009, 'Not yours', { uri: 'x' });
    });
    await vi.waitFor(() => expect(socket.written).toHaveLength(1), { timeout: WAIT_MS });
    expect(socket.written[0]).toEqual({
      jsonrpc: '2.0', id: 4, error: { code: -32009, message: 'Not yours', data: { uri: 'x' } },
    });
  });

  it('answers an error whose code is a number but is no RpcError, as an execFile failure is, as an internal error', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'subscribe' }), peer, () => {
      throw Object.assign(new Error('Command failed: git status'), { code: 128 });
    });
    await vi.waitFor(() => expect(socket.written).toHaveLength(1), { timeout: WAIT_MS });
    expect(socket.written[0]).toEqual({
      jsonrpc: '2.0', id: 6, error: { code: -32603, message: 'Command failed: git status' },
    });
  });

  it('answers a Node error whose code is a string as an internal error', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'subscribe' }), peer, () => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT', data: 'not for the wire' });
    });
    await vi.waitFor(() => expect(socket.written).toHaveLength(1), { timeout: WAIT_MS });
    expect(socket.written[0]).toEqual({
      jsonrpc: '2.0', id: 5, error: { code: -32603, message: 'ENOENT: no such file' },
    });
  });
});

describe('the result a handler returned', () => {
  /*
   * `null` is a value the protocol declares for a result and `undefined` is no
   * value at all, so the two leave here differently. A method whose
   * declaration is `null` - the acknowledgements, `ping` among them - is
   * answered `null`, and a handler that returned nothing keeps the empty
   * object a client reads as an answer that arrived.
   */
  const answered = async (returned: unknown): Promise<unknown> => {
    const socket = wire();
    const peer = createPeer(socket);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), peer, async () => returned);
    await vi.waitFor(() => expect(socket.written).toHaveLength(1), { timeout: WAIT_MS });
    return socket.written[0];
  };

  it('goes on the wire as `null`', async () => {
    expect(await answered(null)).toEqual({ jsonrpc: '2.0', id: 1, result: null });
  });

  it('goes on the wire as `{}` where the handler returned nothing', async () => {
    expect(await answered(undefined)).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });
});

describe('the readers a request\'s params go through', () => {
  /*
   * One reader per kind of field, and one sentence per refusal: `<key> must be
   * <what>`. A client reads that sentence to fix its call, so what is checked
   * here is the value each reader answers and the code and words it refuses
   * with - `INVALID_PARAMS`, which is the protocol's `-32602`.
   */

  /** The refusal a reader threw, for a value that deserved one. */
  const refused = (run: () => unknown): unknown => {
    try { run(); return undefined; }
    catch (error) { return error; }
  };

  it('names the protocol\'s own number for a bad param', () => {
    expect(INVALID_PARAMS).toBe(-32602);
  });

  it('answers the string a param carried', () => {
    expect(stringParam({ session: 'ahp-session:/one' }, 'session')).toBe('ahp-session:/one');
    expect(stringParam({ session: '' }, 'session')).toBe('');
  });

  it('refuses a string param sent anything else, naming the key', () => {
    expect(refused(() => stringParam({ session: 7 }, 'session')))
      .toMatchObject({ code: -32602, message: 'session must be a string' });
    expect(refused(() => stringParam({}, 'session')))
      .toMatchObject({ code: -32602, message: 'session must be a string' });
  });

  it('says what the key had to be where the caller says so', () => {
    expect(refused(() => stringParam({ session: 7 }, 'session', 'a URI string')))
      .toMatchObject({ code: -32602, message: 'session must be a URI string' });
  });

  it('answers nothing for a string param that was left out', () => {
    expect(optionalStringParam({}, 'chat')).toBeUndefined();
    expect(optionalStringParam({ chat: 'ahp-chat://one/two' }, 'chat')).toBe('ahp-chat://one/two');
  });

  it('still refuses an optional string param sent something else', () => {
    expect(refused(() => optionalStringParam({ chat: 7 }, 'chat', 'a URI string')))
      .toMatchObject({ code: -32602, message: 'chat must be a URI string' });
  });

  it('answers the number a param carried', () => {
    expect(numberParam({ position: 0 }, 'position')).toBe(0);
  });

  it('refuses a number param sent anything else', () => {
    expect(refused(() => numberParam({ position: '0' }, 'position')))
      .toMatchObject({ code: -32602, message: 'position must be a number' });
    expect(refused(() => numberParam({}, 'position')))
      .toMatchObject({ code: -32602, message: 'position must be a number' });
    expect(refused(() => numberParam({ at: 'x' }, 'at', 'a whole number')))
      .toMatchObject({ code: -32602, message: 'at must be a whole number' });
  });
});

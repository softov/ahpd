import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPeer, receive, RpcClosed, RpcError, RpcTimeout } from '../packages/sdk/src/rpc.js';
import type { Wire } from '../packages/sdk/src/types/rpc.js';

/*
 * JSON-RPC framing, in both directions.
 *
 * The reverse direction is the half that was missing: AHP is symmetrical, and
 * a host that answers a client's response with an error can never be answered
 * itself. What is checked here is that a response is recognised as one, and
 * that a question this host asks ends in exactly one of four ways.
 */

/** A socket, kept as decoded messages so a test reads what was sent. */
function wire(): Wire & { written: Record<string, unknown>[]; shut(): void } {
  const written: Record<string, unknown>[] = [];
  let open = true;
  return {
    written,
    send: (text) => { written.push(JSON.parse(text) as Record<string, unknown>); },
    close: () => { open = false; },
    isOpen: () => open,
    shut: () => { open = false; },
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

describe('an error the handler throws', () => {
  it('keeps the code when it is an RpcError', async () => {
    const socket = wire();
    const peer = createPeer(socket);
    receive(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'subscribe' }), peer, () => {
      throw new RpcError(-32001, 'Nothing there');
    });
    await vi.waitFor(() => expect(socket.written).toHaveLength(1));
    expect(socket.written[0]).toEqual({
      jsonrpc: '2.0', id: 3, error: { code: -32001, message: 'Nothing there' },
    });
  });
});

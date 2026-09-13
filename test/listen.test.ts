import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { listen } from '../packages/sdk/src/listen.js';
import type { Listener } from '../packages/sdk/src/types/listen.js';

/*
 * The connection token, over a real socket.
 *
 * Worth a server rather than a unit test of the comparison: what is being
 * checked is that an unauthorised client never reaches the host at all, and
 * the only place that is decided is the handshake.
 */

let running: Listener | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** Nothing is served: what matters here is whether the socket opens. */
const nothing = () => ({ handle: async () => ({}), close: () => {} });

const knock = (url: string): Promise<'open' | string> => new Promise((resolve) => {
  const socket = new WebSocket(url);
  socket.on('open', () => { socket.close(); resolve('open'); });
  socket.on('error', (error: Error) => resolve(error.message));
});

it('accepts anything when no token is configured', async () => {
  running = await listen({ port: 0 }, nothing);
  expect(await knock(`ws://127.0.0.1:${running.port}`)).toBe('open');
  expect(running.guarded).toBe(false);
});

it('turns away a client with no token, in HTTP', async () => {
  running = await listen({ port: 0, token: 'sesame' }, nothing);
  // 401 rather than a socket that opens and then closes for no stated reason.
  expect(await knock(`ws://127.0.0.1:${running.port}`)).toContain('401');
  expect(running.guarded).toBe(true);
});

it('turns away the wrong one too', async () => {
  running = await listen({ port: 0, token: 'sesame' }, nothing);
  expect(await knock(`ws://127.0.0.1:${running.port}/?tkn=open`)).toContain('401');
});

it('lets the right one through', async () => {
  running = await listen({ port: 0, token: 'sesame' }, nothing);
  expect(await knock(`ws://127.0.0.1:${running.port}/?tkn=sesame`)).toBe('open');
});

it('reports the port the OS chose', async () => {
  running = await listen({ port: 0 }, nothing);
  expect(running.port).toBeGreaterThan(0);
  expect(running.host).toBe('127.0.0.1');
});

it('refuses malformed tokens and keeps serving the next connection', async () => {
  running = await listen({ port: 0, token: 'sesame' }, nothing);
  const url = `ws://127.0.0.1:${running.port}`;
  for (const token of ['%ZZ', '%', '%E0%A4']) {
    expect(await knock(`${url}/?tkn=${token}`)).toContain('401');
  }
  expect(await knock(`${url}/?tkn=sesame`)).toBe('open');
});

/*
 * The tap sees the wire as it is, not as either side meant it.
 *
 * Both directions, the frame as text, and which connection it belongs to -
 * the three things a log on one end cannot say.
 */
it('hands a tap every frame in both directions, numbered by connection', async () => {
  const seen: { from: string; text: string; peer: number }[] = [];
  running = await listen(
    { port: 0, tap: (from, text, peer) => { seen.push({ from, text, peer }); } },
    () => ({ handle: async () => ({ pong: true }), close: () => {} }),
  );
  const url = `ws://127.0.0.1:${running.port}`;
  const ask = (socket: WebSocket, id: number): Promise<string> => new Promise((resolve) => {
    socket.once('message', (raw) => resolve(String(raw)));
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping', params: {} }));
  });
  const open = (): Promise<WebSocket> => new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.on('open', () => resolve(socket));
  });

  const first = await open();
  const second = await open();
  await ask(first, 1);
  await ask(second, 7);
  first.close();
  second.close();

  // The request as the client wrote it, and the answer as this host wrote it,
  // each on the connection it crossed.
  expect(seen.map((one) => `${one.peer}:${one.from}`)).toEqual(['1:client', '1:host', '2:client', '2:host']);
  expect(JSON.parse(seen[0]?.text ?? '{}')).toMatchObject({ id: 1, method: 'ping' });
  expect(JSON.parse(seen[1]?.text ?? '{}')).toMatchObject({ id: 1, result: { pong: true } });
  expect(JSON.parse(seen[3]?.text ?? '{}')).toMatchObject({ id: 7, result: { pong: true } });
});

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

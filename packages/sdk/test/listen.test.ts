import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { listen, serveRequests } from '../src/listen.js';
import type { Listener } from '../src/types/listen.js';

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

it('refuses plain requests on Node without the Node listener they are served through', async () => {
  const handler = async (): Promise<Response> => new Response('ok');
  await expect(listen({ port: 0, request: handler }, nothing)).rejects.toThrow(/nodeRequest/u);
  await expect(serveRequests({ port: 0 }, handler)).rejects.toThrow(/nodeRequest/u);
});

it('serves plain requests on Node through the Node listener it was handed', async () => {
  running = await listen({
    port: 0,
    request: async () => new Response('fetch'),
    nodeRequest: (_request, response) => { response.end('node'); },
  }, nothing);
  expect(await (await fetch(`http://127.0.0.1:${running.port}/`)).text()).toBe('node');
  expect(await knock(`ws://127.0.0.1:${running.port}`)).toBe('open');
});

it('lets go of the port on close, with a connection and a plain-request server open', async () => {
  const handler = async (): Promise<Response> => new Response('ok');
  const nodeRequest = (_request: unknown, response: { end(text: string): void }): void => { response.end('node'); };
  const first = await listen({ port: 0, request: handler, nodeRequest }, nothing);
  const socket = new WebSocket(`ws://127.0.0.1:${first.port}`);
  await new Promise((opened) => { socket.on('open', opened); });
  await first.close();
  running = await listen({ port: first.port, request: handler, nodeRequest }, nothing);
  expect(running.port).toBe(first.port);
});

/** The grace a busy connection gets on close, as `listen.ts` sets it. */
const CLOSE_GRACE_MS = 2_000;

/**
 * How long a close took on a clock the test moves, 25 ms at a time with a real
 * turn of the event loop between, so a close that waits for nothing settles
 * well inside the grace however loaded the machine is.
 */
const clocked = async (close: () => void | Promise<void>): Promise<number> => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  try {
    let settled = false;
    void Promise.resolve(close()).then(() => { settled = true; });
    let moved = 0;
    while (!settled && moved <= CLOSE_GRACE_MS) {
      await new Promise((turn) => { setImmediate(turn); });
      if (settled) break;
      await vi.advanceTimersByTimeAsync(25);
      moved += 25;
    }
    return moved;
  }
  finally {
    vi.useRealTimers();
  }
};

/** A Node handler that holds each response until the test lets it go, and says when a request has arrived. */
const held = () => {
  let arrived = (): void => {};
  const came = new Promise<void>((done) => { arrived = done; });
  let answer = (): void => {};
  const nodeRequest = (_request: unknown, response: { end(text: string): void }): void => {
    answer = () => { response.end('late'); };
    arrived();
  };
  return { came, nodeRequest, answer: () => { answer(); } };
};

it('lets go of a plain-request port on close, with a kept-alive connection open', async () => {
  const handler = async (): Promise<Response> => new Response('ok');
  const nodeRequest = (_request: unknown, response: { end(text: string): void }): void => { response.end('node'); };
  const first = await serveRequests({ port: 0, nodeRequest }, handler);
  expect(await (await fetch(`http://127.0.0.1:${first.port}/`)).text()).toBe('node');
  // An idle kept-alive connection is closed at once, not after the grace a busy one gets.
  expect(await clocked(() => first.close())).toBeLessThan(CLOSE_GRACE_MS);
  const again = await serveRequests({ port: first.port, nodeRequest }, handler);
  expect(again.port).toBe(first.port);
  await again.close();
});

it('lets go of a WebSocket-only port at once on close, with a kept-alive plain connection open', async () => {
  const first = await listen({ port: 0 }, nothing);
  const refused = await fetch(`http://127.0.0.1:${first.port}/`);
  expect(refused.status).toBe(426);
  expect(await refused.text()).toBe('ahpd speaks the Agent Host Protocol over WebSocket');
  expect(await clocked(() => first.close())).toBeLessThan(CLOSE_GRACE_MS);
  running = await listen({ port: first.port }, nothing);
  expect(running.port).toBe(first.port);
});

it('lets a response in flight finish before it drops the connection', async () => {
  const handler = async (): Promise<Response> => new Response('ok');
  const request = held();
  const first = await serveRequests({ port: 0, nodeRequest: request.nodeRequest }, handler);
  const answered = fetch(`http://127.0.0.1:${first.port}/`).then((response) => response.text());
  await request.came;
  let settled = false;
  const closed = Promise.resolve(first.close()).then(() => { settled = true; });
  await new Promise((turn) => { setImmediate(turn); });
  expect(settled).toBe(false);
  request.answer();
  expect(await answered).toBe('late');
  await closed;
  const again = await serveRequests({ port: first.port, nodeRequest: request.nodeRequest }, handler);
  expect(again.port).toBe(first.port);
  await again.close();
});

it('lets a plain request in flight on the WebSocket port finish before the close settles', async () => {
  const handler = async (): Promise<Response> => new Response('ok');
  const request = held();
  const first = await listen({ port: 0, request: handler, nodeRequest: request.nodeRequest }, nothing);
  const answered = fetch(`http://127.0.0.1:${first.port}/`).then((response) => response.text());
  await request.came;
  let settled = false;
  const closed = Promise.resolve(first.close()).then(() => { settled = true; });
  await new Promise((turn) => { setImmediate(turn); });
  expect(settled).toBe(false);
  request.answer();
  expect(await answered).toBe('late');
  await closed;
  expect(settled).toBe(true);
});

it('drops a request still running two seconds into the close, and then settles', async () => {
  const handler = async (): Promise<Response> => new Response('ok');
  const request = held();
  const first = await listen({ port: 0, request: handler, nodeRequest: request.nodeRequest }, nothing);
  const asked = fetch(`http://127.0.0.1:${first.port}/`).then(() => 'answered', () => 'dropped');
  await request.came;
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  try {
    let settled = false;
    const closed = Promise.resolve(first.close()).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS - 100);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    await closed;
    expect(settled).toBe(true);
    expect(await asked).toBe('dropped');
  }
  finally {
    vi.useRealTimers();
  }
});

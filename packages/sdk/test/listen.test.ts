import { afterEach, expect, it, vi } from 'vitest';
import { connect, type Socket } from 'node:net';
import { WebSocket } from 'ws';
import { echo } from '../../../examples/echo/agent.js';
import { createHost } from '../src/host.js';
import { listen, serveRequests } from '../src/listen.js';
import type { Listener } from '../src/types/listen.js';
import type { Peer } from '../src/types/rpc.js';

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

it('sends a refused handshake a bearer challenge: the realm alone with no token, invalid_token with one', async () => {
  running = await listen({ port: 0, token: 'sesame' }, nothing);
  /** The challenge a refused handshake was answered with. */
  const challenged = (url: string): Promise<string | undefined> => new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.on('unexpected-response', (_request, response) => {
      resolve(response.headers['www-authenticate']);
      socket.terminate();
    });
    socket.on('open', () => { socket.close(); resolve('open'); });
    socket.on('error', () => {});
  });
  expect(await challenged(`ws://127.0.0.1:${running.port}`)).toBe('Bearer realm="ahpd"');
  expect(await challenged(`ws://127.0.0.1:${running.port}/?tkn=open`)).toBe('Bearer realm="ahpd", error="invalid_token"');
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

it('closes a client open at close with 1001 and the reason', async () => {
  const first = await listen({ port: 0 }, nothing);
  const socket = new WebSocket(`ws://127.0.0.1:${first.port}`);
  await new Promise((opened) => { socket.on('open', opened); });
  const heard = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on('close', (code: number, reason: Buffer) => { resolve({ code, reason: reason.toString('utf8') }); });
  });
  await first.close();
  expect(await heard).toEqual({ code: 1001, reason: 'the host is stopping' });
});

/** A client that completes the handshake by hand and never answers a close frame. */
const deaf = (port: number): Promise<{ socket: Socket; told: Promise<Buffer>; gone: Promise<void> }> => new Promise((resolve, reject) => {
  const socket = connect(port, '127.0.0.1');
  const chunks: Buffer[] = [];
  let frame = (_close: Buffer): void => {};
  const told = new Promise<Buffer>((done) => { frame = done; });
  const gone = new Promise<void>((done) => { socket.on('close', () => { done(); }); });
  socket.on('error', () => undefined);
  socket.once('error', reject);
  socket.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    const all = Buffer.concat(chunks);
    if (chunks.length === 1) {
      if (!all.toString('latin1').startsWith('HTTP/1.1 101')) reject(new Error(all.toString('latin1')));
      resolve({ socket, told, gone });
    }
    // An unmasked close frame from the server, after the handshake's blank line.
    const body = all.subarray(all.indexOf('\r\n\r\n') + 4);
    if (body[0] === 0x88 && body.length >= 2 + (body[1] ?? 0)) frame(body.subarray(2, 2 + (body[1] ?? 0)));
  });
  socket.write([
    'GET / HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    '',
    '',
  ].join('\r\n'));
});

/** One text frame as a client sends it: masked, which is what a server requires. */
const masked = (text: string): Buffer => {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const head = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 0xff]);
  const body = Buffer.alloc(payload.length);
  for (let at = 0; at < payload.length; at++) {
    body.writeUInt8(payload.readUInt8(at) ^ mask.readUInt8(at % 4), at);
  }
  return Buffer.concat([head, mask, body]);
};

/**
 * A client that completes the handshake by hand and then stops reading.
 *
 * `speaks` is a frame it sends with the handshake, before it stops: a client
 * that introduced itself has to, or the host has no id to resume it under.
 */
const mute = (port: number, speaks?: string): Promise<Socket> => new Promise((resolve, reject) => {
  const socket = connect(port, '127.0.0.1');
  const chunks: Buffer[] = [];
  socket.on('error', () => undefined);
  socket.once('error', reject);
  socket.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    const all = Buffer.concat(chunks).toString('latin1');
    if (!all.startsWith('HTTP/1.1 101')) {
      reject(new Error(all));
      return;
    }
    // Reading stops here, which is the whole of this client: every frame the
    // host writes after the handshake is left where it landed.
    socket.pause();
    resolve(socket);
  });
  socket.write([
    'GET / HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    '',
    '',
  ].join('\r\n'));
  if (speaks !== undefined) socket.write(masked(speaks));
});

it('reports the queue a Node socket keeps for a client that does not read', async () => {
  let handOver = (_peer: Peer): void => undefined;
  const handed = new Promise<Peer>((resolve) => { handOver = resolve; });
  running = await listen({ port: 0 }, (peer) => { handOver(peer); return nothing(); });
  // The client first: the peer is handed over when a connection opens, and
  // nothing opens one before this.
  const client = await mute(running.port);
  const peer = await handed;
  try {
    /*
     * The kernel takes a few megabytes before `ws` has a byte of its own to
     * queue, so the host is asked after each frame until it says it is
     * holding something.
     */
    const frame = 'x'.repeat(256 * 1024);
    let queued = 0;
    for (let i = 0; i < 200 && queued === 0; i++) {
      peer.notify('action', { frame });
      queued = peer.buffered?.() ?? 0;
    }
    expect(queued).toBeGreaterThan(0);
    // And it grows: this client never reads, so nothing of what is queued drains.
    for (let i = 0; i < 10; i++) peer.notify('action', { frame });
    expect(peer.buffered?.() ?? 0).toBeGreaterThan(queued);
  }
  finally {
    client.destroy();
  }
});

/** The limit these tests hold a client to, which is `MINIMUM_LIMIT_BYTES`. */
const LIMIT = 1024 * 1024;

/**
 * Whether a close frame reaches a client once it is told to read again.
 *
 * The frames this host writes all carry a payload of ASCII `x`, so the only
 * `0x88` in the stream is a close frame's own opcode - which is the one thing
 * a client that never reads cannot otherwise be shown: the frame was written,
 * and it is sitting in the queue it will not take.
 */
const closed = (socket: Socket): Promise<boolean> => new Promise((resolve) => {
  const chunks: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    if (Buffer.concat(chunks).includes(0x88)) resolve(true);
  });
  socket.on('end', () => { resolve(false); });
});

it('closes a client that stops reading once its queue is past the limit, and says what it held', async () => {
  const said: string[] = [];
  let handOver = (_peer: Peer): void => undefined;
  const handed = new Promise<Peer>((resolve) => { handOver = resolve; });
  running = await listen(
    { port: 0, clientQueueBytes: () => LIMIT, log: (line) => { said.push(line); } },
    (peer) => { handOver(peer); return nothing(); },
  );
  const client = await mute(running.port);
  const peer = await handed;
  try {
    // The kernel takes a few megabytes before `ws` queues anything of its
    // own, so the host is written to until the limit is reached.
    const frame = 'x'.repeat(256 * 1024);
    for (let i = 0; i < 200 && said.length === 0; i++) peer.notify('action', { frame });
    expect(said).toHaveLength(1);
    // The queue it was closed at, which is over the limit and named with it.
    const [, held] = /^held (\d+) bytes for a client that is not reading/u.exec(said[0] ?? '') ?? [];
    expect(Number(held)).toBeGreaterThan(LIMIT);
    expect(said[0]).toContain(`past the ${LIMIT} it is allowed, and was closed`);
    // And the wire really was closed, not merely given up on: the close frame
    // is in the queue, where the client finds it the moment it reads.
    // The client starts reading. The handler that stopped it goes first: it
    // pauses the socket after every chunk it is handed, which is what made
    // this client the one that never reads.
    client.removeAllListeners('data');
    const told = closed(client);
    client.resume();
    expect(await told).toBe(true);
  }
  finally {
    client.destroy();
  }
});

it('goes on serving the client that reads, past the one it closed', async () => {
  const said: string[] = [];
  const peers: Peer[] = [];
  running = await listen(
    { port: 0, clientQueueBytes: () => LIMIT, log: (line) => { said.push(line); } },
    (peer) => { peers.push(peer); return nothing(); },
  );
  const reader = new WebSocket(`ws://127.0.0.1:${running.port}`);
  /** The next frame the reader takes, which arrives a turn after it was written. */
  const next = (): Promise<Record<string, unknown>> => new Promise((resolve) => {
    reader.once('message', (raw) => { resolve(JSON.parse(String(raw)) as Record<string, unknown>); });
  });
  await new Promise((opened) => { reader.on('open', opened); });
  const client = await mute(running.port);
  try {
    // The reader connected first, so it is the first peer handed over and the
    // one that stays.
    while (peers.length < 2) await new Promise((turn) => { setImmediate(turn); });
    const before = next();
    peers[0]?.notify('action', { frame: 'small' });
    expect(await before).toMatchObject({ method: 'action' });
    // Written to until the limit is reached, and closed there.
    const frame = 'x'.repeat(256 * 1024);
    for (let i = 0; i < 200 && said.length === 0; i++) peers[1]?.notify('action', { frame });
    expect(said).toHaveLength(1);
    // And the client beside it is still served: the frame after the close
    // reaches it, on the listener that just closed the other one.
    const after = next();
    peers[0]?.notify('ping', {});
    expect(await after).toMatchObject({ method: 'ping' });
    expect(reader.readyState).toBe(WebSocket.OPEN);
  }
  finally {
    client.destroy();
    reader.close();
  }
});

/** One request over a WebSocket, and the answer that carries its id. */
const asked = (socket: WebSocket, id: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>;
      if (message.id === id) resolve(message);
    });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });

/*
 * The client that was closed is not left behind.
 *
 * The close is this listener's, but what a client does next is the host's: its
 * socket is gone, so it comes back under the id it introduced itself with and
 * says where it had read to. The host answers that out of its buffer, as it
 * answers any reconnect - and this is the one path the close could have broken,
 * because the client that reconnects is the one this host stopped writing to.
 */
it('answers the client it closed when it comes back, with a replay or snapshots', async () => {
  // A real host with the backend written from nothing, so nothing here depends
  // on a session: what is under test is the close and the reconnect.
  const dir = '/tmp/ahpd-listen-reconnect';
  const said: string[] = [];
  const host = createHost({ path: dir, agents: [echo({ path: dir })], onEvent: (line) => { said.push(line); } });
  let handOver = (_peer: Peer): void => undefined;
  const handed = new Promise<Peer>((resolve) => { handOver = resolve; });
  running = await listen(
    { port: 0 },
    (peer) => { handOver(peer); return host.accept(peer); },
  );
  // The client that will be closed is the one that introduces itself: the id
  // it comes back under is an id this host has seen.
  const client = await mute(running.port, JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: ['0.9.0'] },
  }));
  const peer = await handed;
  let back: WebSocket | undefined;
  try {
    // Turns for the frame it sent with its handshake to be read and answered,
    // which is what makes `probe` a client this host knows.
    for (let i = 0; i < 10; i++) await new Promise((turn) => { setImmediate(turn); });
    /*
     * Written to until this host closes it, which is at the default limit this
     * host holds a client to - the listener was given no limit of its own, so
     * the number in force is the one `accept` bound the peer with.
     */
    const frame = 'x'.repeat(256 * 1024);
    const behind = (): string[] => said.filter((line) => line.includes('not reading'));
    for (let i = 0; i < 400 && behind().length === 0; i++) peer.notify('action', { frame });
    expect(behind()).toHaveLength(1);
    // Said against the client by the name it introduced itself under, which a
    // peer cannot say for itself: the line is the host's.
    expect(behind()[0]).toContain('probe: held');
    // And now it comes back, on a new socket, under the id it introduced
    // itself with and from before what it missed.
    const again = new WebSocket(`ws://127.0.0.1:${running.port}`);
    back = again;
    await new Promise((opened) => { again.on('open', opened); });
    const answer = await asked(again, 2, 'reconnect', {
      channel: 'ahp-root://',
      clientId: 'probe',
      lastSeenServerSeq: 0,
      subscriptions: ['ahp-root://'],
    });
    expect(answer.error).toBeUndefined();
    // A replay of what it missed, or state where the gap is longer than the
    // buffer: either way it is served, on the listener that closed it.
    const result = answer.result as { type: string; missing?: string[]; snapshots?: { resource: string }[] };
    expect(['replay', 'snapshot']).toContain(result.type);
    // And nothing it asked back for has gone, which is the other half of a
    // client that dropped being answerable at all: a replay names nothing
    // missing, and state holds every channel it asked for.
    expect(result.type === 'replay' ? result.missing : result.snapshots?.map((one) => one.resource))
      .toEqual(result.type === 'replay' ? [] : ['ahp-root://']);
  }
  finally {
    client.destroy();
    back?.close();
  }
});

it('drops a client that ignores the close frame after the grace, and then settles', async () => {
  const first = await listen({ port: 0 }, nothing);
  const client = await deaf(first.port);
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  try {
    let settled = false;
    const closed = Promise.resolve(first.close()).then(() => { settled = true; });
    const told = await client.told;
    expect(told.readUInt16BE(0)).toBe(1001);
    expect(told.subarray(2).toString('utf8')).toBe('the host is stopping');
    await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS - 100);
    await new Promise((turn) => { setImmediate(turn); });
    expect(settled).toBe(false);
    expect(client.socket.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    await client.gone;
    await closed;
    expect(settled).toBe(true);
  }
  finally {
    vi.useRealTimers();
    client.socket.destroy();
  }
});

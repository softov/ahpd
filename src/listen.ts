import { createPeer, receive } from './rpc.js';
import type { Connected, Listener, ListenOptions, OnConnect, Runtime } from './types/listen.js';

/**
 * Accepts WebSocket connections on Node, Bun or Deno.
 *
 * The runtime is detected at startup and the matching server is used: `ws` on
 * Node, which has no WebSocket server of its own, and the built-in servers on
 * Bun and Deno. `ws` is an optional dependency and is imported only on Node.
 *
 * This is the only module that knows which runtime it is on. Supporting
 * another one is a case added here.
 */

const runtimeOf = (): Runtime => {
  const g = globalThis as { Bun?: unknown; Deno?: unknown };
  if (g.Bun !== undefined) return 'bun';
  if (g.Deno !== undefined) return 'deno';
  return 'node';
};

/** What a runtime's socket has to look like once it is wired up. */
interface Bound {
  peer: ReturnType<typeof createPeer>;
  connected: Connected;
}

/**
 * The token a connection presented, if it presented one.
 *
 * Two places, because only one of them always works: a browser cannot set
 * headers on a WebSocket handshake, so the query string is the portable form
 * and the header is for clients that can.
 */
const presented = (url: string | undefined, authorization: string | null): string | undefined => {
  const query = /[?&]tkn=([^&]*)/.exec(url ?? '');
  if (query) return decodeURIComponent(query[1] ?? '');
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  return bearer?.[1];
};

/**
 * Compares two secrets without returning early on the first difference.
 *
 * The lengths still differ observably, which is why a token is generated
 * rather than chosen: they are all the same length.
 */
const same = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 0; i < a.length; i++) differing |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differing === 0;
};

export async function listen(options: ListenOptions, onConnect: OnConnect): Promise<Listener> {
  const runtime = runtimeOf();
  const host = options.host ?? '127.0.0.1';
  const token = options.token;
  /** Whether this handshake may proceed. No token configured accepts any. */
  const allowed = (url: string | undefined, authorization: string | null): boolean =>
    token === undefined || same(token, presented(url, authorization) ?? '');

  if (runtime === 'bun') {
    const Bun = (globalThis as unknown as { Bun: {
      serve(options: Record<string, unknown>): { stop(closeActive?: boolean): void; port: number };
    } }).Bun;
    // Per socket, because Bun's handler table is one set of callbacks for
    // every connection - `ws` is the only thing distinguishing them.
    const bound = new Map<object, Bound>();
    const server = Bun.serve({
      port: options.port,
      hostname: host,
      fetch(request: Request_, server_: { upgrade(r: Request_): boolean }) {
        // Refused before the upgrade, so an unauthorised client is told in
        // HTTP rather than handed a socket that closes on its first message.
        if (!allowed(request.url, request.headers.get('authorization'))) {
          return new Response('A connection token is required', { status: 401 });
        }
        if (server_.upgrade(request)) return undefined;
        return new Response('ahpd speaks the Agent Host Protocol over WebSocket', { status: 426 });
      },
      websocket: {
        open(ws: BunSocket) {
          const peer = createPeer({
            send: (text) => { ws.send(text); },
            close: () => ws.close(),
            isOpen: () => ws.readyState === 1,
          });
          bound.set(ws, { peer, connected: onConnect(peer) });
        },
        message(ws: BunSocket, raw: string | Uint8Array) {
          const held = bound.get(ws);
          if (!held) return;
          const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
          receive(text, held.peer, (request) => held.connected.handle(request));
        },
        close(ws: BunSocket) {
          const held = bound.get(ws);
          // The peer first: a question this host asked is still pending, and
          // the socket that would have answered it is gone.
          held?.peer.close();
          held?.connected.close();
          bound.delete(ws);
        },
      },
    });
    return { runtime, host, port: server.port, guarded: token !== undefined, close: () => server.stop(true) };
  }

  if (runtime === 'deno') {
    const Deno = (globalThis as unknown as { Deno: {
      serve(options: { port: number; hostname: string }, handler: (r: Request_) => Response): {
        shutdown(): Promise<void>;
        addr: { port: number };
      };
      upgradeWebSocket(r: Request_): { socket: DenoSocket; response: Response };
    } }).Deno;
    const server = Deno.serve({ port: options.port, hostname: host }, (request) => {
      if (!allowed(request.url, request.headers.get('authorization'))) {
        return new Response('A connection token is required', { status: 401 });
      }
      if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
        return new Response('ahpd speaks the Agent Host Protocol over WebSocket', { status: 426 });
      }
      const { socket, response } = Deno.upgradeWebSocket(request);
      let held: Bound | undefined;
      socket.onopen = () => {
        const peer = createPeer({
          send: (text) => { socket.send(text); },
          close: () => socket.close(),
          isOpen: () => socket.readyState === 1,
        });
        held = { peer, connected: onConnect(peer) };
      };
      socket.onmessage = (event) => {
        const open = held;
        if (!open) return;
        receive(String(event.data), open.peer, (request_) => open.connected.handle(request_));
      };
      socket.onclose = () => { held?.peer.close(); held?.connected.close(); held = undefined; };
      return response;
    });
    return {
      runtime,
      host,
      port: server.addr.port,
      guarded: token !== undefined,
      close: () => server.shutdown(),
    };
  }

  let WebSocketServer: new (options: NodeOptions) => NodeServer;
  try {
    ({ WebSocketServer } = await import('ws') as unknown as {
      WebSocketServer: new (options: NodeOptions) => NodeServer;
    });
  } catch {
    throw new Error(
      'Running on Node needs the `ws` package, which has no server in the standard library.\n'
      + '  npm install ws\n'
      + 'Bun and Deno have one built in and need nothing.',
    );
  }

  const server = new WebSocketServer({
    port: options.port,
    host,
    // `ws` answers a rejected handshake with the status this passes back, so
    // an unauthorised client reads 401 rather than a socket that opened and
    // then closed for no stated reason.
    verifyClient: (info, accept) => {
      if (allowed(info.req.url, info.req.headers.authorization ?? null)) accept(true);
      else accept(false, 401, 'A connection token is required');
    },
  });
  server.on('connection', (socket) => {
    const peer = createPeer({
      send: (text) => { socket.send(text); },
      close: () => socket.close(),
      isOpen: () => socket.readyState === 1,
    });
    const connected = onConnect(peer);
    socket.on('message', (raw) => {
      receive(typeof raw === 'string' ? raw : raw.toString('utf8'), peer, (request) => connected.handle(request));
    });
    socket.on('close', () => { peer.close(); connected.close(); });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
  return {
    runtime,
    host,
    // What was bound, not what was asked for: port 0 means the OS chooses.
    port: server.address()?.port ?? options.port,
    guarded: token !== undefined,
    close: () => { server.close(); },
  };
}

// --- the shapes each runtime hands back, named so the code above reads ------

type Request_ = { url: string; headers: { get(name: string): string | null } };

interface BunSocket { send(text: string): unknown; close(): void; readyState: number }

interface DenoSocket {
  send(text: string): void;
  close(): void;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

interface NodeOptions {
  port: number;
  host: string;
  verifyClient(
    info: { req: { url?: string; headers: { authorization?: string } } },
    accept: (allow: boolean, code?: number, message?: string) => void,
  ): void;
}

interface NodeServer {
  on(event: 'connection', handler: (socket: NodeSocket) => void): void;
  once(event: 'listening' | 'error', handler: (error?: unknown) => void): void;
  address(): { port: number } | null;
  close(): void;
}

interface NodeSocket {
  send(text: string): void;
  close(): void;
  readyState: number;
  on(event: 'message', handler: (raw: string | Buffer) => void): void;
  on(event: 'close', handler: () => void): void;
}

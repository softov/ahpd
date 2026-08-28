import { createPeer, receive } from './rpc.js';
import type { Connected, Listener, OnConnect, Runtime } from './types/listen.js';

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

export async function listen(port: number, onConnect: OnConnect): Promise<Listener> {
  const runtime = runtimeOf();

  if (runtime === 'bun') {
    const Bun = (globalThis as unknown as { Bun: {
      serve(options: Record<string, unknown>): { stop(closeActive?: boolean): void };
    } }).Bun;
    // Per socket, because Bun's handler table is one set of callbacks for
    // every connection - `ws` is the only thing distinguishing them.
    const bound = new Map<object, Bound>();
    const server = Bun.serve({
      port,
      fetch(request: Request_, server_: { upgrade(r: Request_): boolean }) {
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
          bound.get(ws)?.connected.close();
          bound.delete(ws);
        },
      },
    });
    return { runtime, port, close: () => server.stop(true) };
  }

  if (runtime === 'deno') {
    const Deno = (globalThis as unknown as { Deno: {
      serve(options: { port: number }, handler: (r: Request_) => Response): { shutdown(): Promise<void> };
      upgradeWebSocket(r: Request_): { socket: DenoSocket; response: Response };
    } }).Deno;
    const server = Deno.serve({ port }, (request) => {
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
      socket.onclose = () => { held?.connected.close(); held = undefined; };
      return response;
    });
    return { runtime, port, close: () => server.shutdown() };
  }

  let WebSocketServer: new (options: { port: number }) => NodeServer;
  try {
    ({ WebSocketServer } = await import('ws') as unknown as {
      WebSocketServer: new (options: { port: number }) => NodeServer;
    });
  } catch {
    throw new Error(
      'Running on Node needs the `ws` package, which has no server in the standard library.\n'
      + '  npm install ws\n'
      + 'Bun and Deno have one built in and need nothing.',
    );
  }

  const server = new WebSocketServer({ port });
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
    socket.on('close', () => connected.close());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
  return { runtime, port, close: () => { server.close(); } };
}

// --- the shapes each runtime hands back, named so the code above reads ------

type Request_ = { headers: { get(name: string): string | null } };

interface BunSocket { send(text: string): unknown; close(): void; readyState: number }

interface DenoSocket {
  send(text: string): void;
  close(): void;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

interface NodeServer {
  on(event: 'connection', handler: (socket: NodeSocket) => void): void;
  once(event: 'listening' | 'error', handler: (error?: unknown) => void): void;
  close(): void;
}

interface NodeSocket {
  send(text: string): void;
  close(): void;
  readyState: number;
  on(event: 'message', handler: (raw: string | Buffer) => void): void;
  on(event: 'close', handler: () => void): void;
}

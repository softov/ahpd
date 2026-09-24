import { createPeer, receive } from './rpc.js';
import type { Connected, Listener, ListenOptions, OnConnect, Runtime, StdioOptions, Tap } from './types/listen.js';
import type { Principal } from './types/users.js';

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

/**
 * Which runtime this is.
 *
 * The knowledge stays in this module rather than moving to a second detector:
 * `listen` is still the only place that knows, and the plugin loader that has
 * to answer a bare spec differently on Deno calls this rather than copying it,
 * so the two can never disagree.
 */
export const runtime = (): Runtime => {
  const g = globalThis as { Bun?: unknown; Deno?: unknown };
  if (g.Bun !== undefined) return 'bun';
  if (g.Deno !== undefined) return 'deno';
  return 'node';
};

/** What a runtime's socket has to look like once it is wired up. */
interface Bound {
  peer: ReturnType<typeof createPeer>;
  connected: Connected;
  seen: ReturnType<typeof tapping>;
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
  if (query) {
    try { return decodeURIComponent(query[1] ?? ''); }
    catch { return undefined; } // A bad escape refuses the handshake, not the process.
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  return bearer?.[1];
};

/**
 * Compares two secrets without returning early on the first difference.
 *
 * The lengths still differ observably, which is why a token is generated
 * rather than chosen: they are all the same length.
 */
export const same = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 0; i < a.length; i++) differing |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differing === 0;
};

/**
 * The tap on one connection, or nothing when nobody asked to see the wire.
 *
 * One number per accepted socket, in order of arrival, so the frames of two
 * clients connected at once can be told apart in what the tap writes.
 */
const tapping = (tap: Tap | undefined, peer: number): {
  out(text: string): void;
  in(text: string): void;
} => ({
  out: (text) => { tap?.('host', text, peer); },
  in: (text) => { tap?.('client', text, peer); },
});

export async function listen(options: ListenOptions, onConnect: OnConnect): Promise<Listener> {
  const here = runtime();
  const host = options.host ?? '127.0.0.1';
  let accepted = 0;
  const token = options.token;
  /**
   * Who, if anyone, this handshake carries.
   *
   * The deployment's own token admits the socket and is the host, which is
   * what it has always done and the one thing that does not change. Anything
   * else is put to `identify`, which a daemon wires to its user directory: the
   * answer says whether the token opens the door at all, and whether it also
   * says who they are. A person's own token opens it and says nobody unless
   * their record trusts it - decision `the-door-is-a-door` - so the socket is
   * admitted and `authenticate` is what authorizes them. A host with no
   * directory passes no `identify`, so nothing changes for it.
   */
  const identityOf = async (
    url: string | undefined,
    authorization: string | null,
  ): Promise<{ admitted: true; principal?: Principal; root?: boolean } | { admitted: false }> => {
    const held = presented(url, authorization);
    if (token === undefined) {
      const arrival = held === undefined || held === '' || options.identify === undefined
        ? undefined
        : await options.identify(held);
      return arrival?.principal === undefined ? { admitted: true } : { admitted: true, principal: arrival.principal };
    }
    // The deployment's own token. It is the host's key, so a socket on it is
    // the host when the caller says so, and is only admitted otherwise.
    if (held !== undefined && same(token, held)) {
      return options.root === true ? { admitted: true, root: true } : { admitted: true };
    }
    if (held !== undefined && held !== '' && options.identify !== undefined) {
      const arrival = await options.identify(held);
      if (arrival !== undefined) {
        return arrival.principal === undefined
          ? { admitted: true }
          : { admitted: true, principal: arrival.principal };
      }
    }
    return { admitted: false };
  };

  if (here === 'bun') {
    const Bun = (globalThis as unknown as { Bun: {
      serve(options: Record<string, unknown>): { stop(closeActive?: boolean): void; port: number };
    } }).Bun;
    // Per socket, because Bun's handler table is one set of callbacks for
    // every connection - `ws` is the only thing distinguishing them.
    const bound = new Map<object, Bound>();
    const server = Bun.serve({
      port: options.port,
      hostname: host,
      async fetch(request: Request_, server_: { upgrade(r: Request_, options?: { data?: unknown }): boolean }) {
        // Refused before the upgrade, so an unauthorised client is told in
        // HTTP rather than handed a socket that closes on its first message.
        const identity = await identityOf(request.url, request.headers.get('authorization'));
        if (!identity.admitted) {
          return new Response('A connection token is required', { status: 401 });
        }
        // The principal rides on the socket, because Bun's `open` is handed
        // the socket and not the request this answer came from.
        if (server_.upgrade(request, { data: { principal: identity.principal, root: identity.root } })) return undefined;
        return new Response('ahpd speaks the Agent Host Protocol over WebSocket', { status: 426 });
      },
      websocket: {
        open(ws: BunSocket) {
          const seen = tapping(options.tap, ++accepted);
          const peer = createPeer({
            send: (text) => { seen.out(text); ws.send(text); },
            close: () => ws.close(),
            isOpen: () => ws.readyState === 1,
          });
          const arrival = ws.data as { principal?: Principal; root?: boolean } | undefined;
          bound.set(ws, { peer, connected: onConnect(peer, arrival?.principal, arrival?.root), seen });
        },
        message(ws: BunSocket, raw: string | Uint8Array) {
          const held = bound.get(ws);
          if (!held) return;
          const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
          held.seen.in(text);
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
    return { runtime: here, host, port: server.port, guarded: token !== undefined, close: () => server.stop(true) };
  }

  if (here === 'deno') {
    const Deno = (globalThis as unknown as { Deno: {
      serve(options: { port: number; hostname: string }, handler: (r: Request_) => Response | Promise<Response>): {
        shutdown(): Promise<void>;
        addr: { port: number };
      };
      upgradeWebSocket(r: Request_): { socket: DenoSocket; response: Response };
    } }).Deno;
    const server = Deno.serve({ port: options.port, hostname: host }, async (request) => {
      const identity = await identityOf(request.url, request.headers.get('authorization'));
      if (!identity.admitted) {
        return new Response('A connection token is required', { status: 401 });
      }
      if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
        return new Response('ahpd speaks the Agent Host Protocol over WebSocket', { status: 426 });
      }
      const { socket, response } = Deno.upgradeWebSocket(request);
      let held: Bound | undefined;
      socket.onopen = () => {
        const seen = tapping(options.tap, ++accepted);
        const peer = createPeer({
          send: (text) => { seen.out(text); socket.send(text); },
          close: () => socket.close(),
          isOpen: () => socket.readyState === 1,
        });
        // Closed over rather than carried on the socket: this handler already
        // has the answer the upgrade was decided on.
        held = { peer, connected: onConnect(peer, identity.principal, identity.root), seen };
      };
      socket.onmessage = (event) => {
        const open = held;
        if (!open) return;
        const text = String(event.data);
        open.seen.in(text);
        receive(text, open.peer, (request_) => open.connected.handle(request_));
      };
      socket.onclose = () => { held?.peer.close(); held?.connected.close(); held = undefined; };
      return response;
    });
    return {
      runtime: here,
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

  /*
   * What `verifyClient` decided, waiting for the connection it decided about.
   *
   * `ws` answers the handshake from one callback and reports the connection
   * from another, and the request object is the one thing both are handed, so
   * it is the key. A `WeakMap` rather than a `Map` because nothing has to be
   * cleaned up when a handshake is refused.
   */
  const decided = new WeakMap<object, { principal?: Principal | undefined; root?: boolean | undefined }>();
  const server = new WebSocketServer({
    port: options.port,
    host,
    // `ws` answers a rejected handshake with the status this passes back, so
    // an unauthorised client reads 401 rather than a socket that opened and
    // then closed for no stated reason.
    verifyClient: (info, accept) => {
      void identityOf(info.req.url, info.req.headers.authorization ?? null).then((identity) => {
        if (identity.admitted) {
          decided.set(info.req, { principal: identity.principal, root: identity.root });
          accept(true);
          return;
        }
        accept(false, 401, 'A connection token is required');
      });
    },
  });
  server.on('connection', (socket, request) => {
    const seen = tapping(options.tap, ++accepted);
    const peer = createPeer({
      send: (text) => { seen.out(text); socket.send(text); },
      close: () => socket.close(),
      isOpen: () => socket.readyState === 1,
    });
    const arrival = decided.get(request);
    const connected = onConnect(peer, arrival?.principal, arrival?.root);
    decided.delete(request);
    socket.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      seen.in(text);
      receive(text, peer, (request) => connected.handle(request));
    });
    socket.on('close', () => { peer.close(); connected.close(); });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
  return {
    runtime: here,
    host,
    // What was bound, not what was asked for: port 0 means the OS chooses.
    port: server.address()?.port ?? options.port,
    guarded: token !== undefined,
    close: () => { server.close(); },
  };
}

/**
 * Serves one client over this process's own stdin and stdout.
 *
 * The second transport, and the whole of it: a frame is one line of JSON, so
 * reading a line and writing a line is the same two calls every socket path
 * makes. Nothing is bound and nothing is refused at a door, because a process
 * holding these pipes is the only thing that can reach them.
 *
 * It exists so a host can be carried by another host: a container runs one of
 * these and the outer host relays its frames - decision
 * `a-nested-host-speaks-stdio`. The connection is the host itself by default,
 * because the process that started this one decided whether it may exist.
 */
export async function overStdio(options: StdioOptions, onConnect: OnConnect): Promise<Listener> {
  const seen = tapping(options.tap, 1);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  let running = true;
  /**
   * What is left of a line whose newline has not arrived yet.
   *
   * Held rather than parsed, because a frame that straddles two reads is one
   * frame: a message split across a pipe is ordinary, and reporting it as two
   * would be a parse error the client never caused.
   */
  let tail = '';

  const peer = createPeer({
    send: (text) => {
      seen.out(text);
      output.write(`${text}\n`);
    },
    // The pipe stays open until the process ends: closing the read side of
    // something another process owns is that process's business, not ours.
    close: () => { input.pause(); },
    isOpen: () => running,
  });
  const connected: Connected = onConnect(peer, undefined, options.root !== false);

  /** The one ending, so a close and an end cannot both release the connection. */
  const finish = (): void => {
    if (!running) return;
    running = false;
    peer.close();
    connected.close();
  };

  /** One complete line, handed on the way a socket hands over a message. */
  const frame = (line: string): void => {
    if (line.trim() === '') return;
    seen.in(line);
    receive(line, peer, (request) => connected.handle(request));
  };

  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    tail += chunk;
    let at = tail.indexOf('\n');
    while (at !== -1) {
      // A carriage return before the newline is a terminal's doing, not a
      // client's, and JSON whitespace either way.
      frame(tail.slice(0, at).replace(/\r$/, ''));
      tail = tail.slice(at + 1);
      at = tail.indexOf('\n');
    }
  });
  // A last line with no newline after it is still a frame: a socket message
  // needs no terminator, and a writer that ends without one meant the same.
  input.on('end', () => {
    if (tail !== '') frame(tail.replace(/\r$/, ''));
    tail = '';
    finish();
  });
  input.on('error', finish);
  // Paused by default when a process has other work; this one has none until
  // a frame arrives, so it is asked to start reading.
  input.resume();

  return {
    runtime: runtime(),
    // Said in its own words rather than as a port nobody bound: a client
    // reading this line should not go looking for a socket.
    host: 'stdio',
    port: 0,
    guarded: false,
    close: () => {
      finish();
      input.pause();
    },
  };
}

// --- the shapes each runtime hands back, named so the code above reads ------

type Request_ = { url: string; headers: { get(name: string): string | null } };

interface BunSocket { send(text: string): unknown; close(): void; readyState: number; data?: unknown }

interface DenoSocket {
  send(text: string): void;
  close(): void;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

interface NodeRequest {
  url?: string;
  headers: { authorization?: string };
}

interface NodeOptions {
  port: number;
  host: string;
  verifyClient(
    info: { req: NodeRequest },
    accept: (allow: boolean, code?: number, message?: string) => void,
  ): void;
}

interface NodeServer {
  // The request as well as the socket, because it is the key the answer
  // `verifyClient` reached is waiting under.
  on(event: 'connection', handler: (socket: NodeSocket, request: NodeRequest) => void): void;
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

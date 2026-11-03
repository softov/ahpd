import { createPeer, receive } from './rpc.js';
import type {
  Admission, Bounds, Connected, Door, DoorOptions, Listener, ListenOptions, NodeRequestListener, OnConnect, Opened, Raw, RequestHandler, RequestsListener, RequestsOptions, Runtime, StdioOptions, Tap,
} from './types/listen.js';
import type { Principal } from './types/users.js';
import type { Bounding, Peer } from './types/rpc.js';

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
 * to answer a bare spec differently on Deno, and the terminal binding that is
 * Bun's own on Bun, call this rather than copying it, so they can never
 * disagree.
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
  connected: Connected | Raw;
  seen: ReturnType<typeof tapping>;
}

/**
 * One message in, wherever it goes.
 *
 * A raw connection is its own wire and is handed the message as it arrived; a
 * connected one is where this host parses the frame and answers its requests.
 */
const take = (held: Connected | Raw, peer: Peer, text: string): void => {
  if ('raw' in held) held.raw(text);
  else receive(text, peer, (request) => held.handle(request));
};

/** Where a connection came in, what it is and which node it is, as the connection handler is told it. */
const openedOf = (seen: {
  url?: string | undefined;
  node?: string | undefined;
  socket?: number | undefined;
  address?: string | undefined;
  forwardedFor?: string | undefined;
}): Opened => ({
  ...(seen.url === undefined ? {} : { url: seen.url }),
  ...(seen.node === undefined ? {} : { node: seen.node }),
  ...(seen.socket === undefined ? {} : { socket: seen.socket }),
  ...(seen.address === undefined ? {} : { address: seen.address }),
  ...(seen.forwardedFor === undefined ? {} : { forwardedFor: seen.forwardedFor }),
});

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

/**
 * How a listener was told to bound its clients, or nothing when it was not.
 *
 * The limit reaches the peer through this and nothing else, since it is the
 * one place that knows whether the caller gave one: a listener with no limit
 * accepts a client that never reads, as every WebSocket server does.
 */
const boundingOf = (options: Bounds): Bounding | undefined => options.clientQueueBytes === undefined
  ? undefined
  : { limit: options.clientQueueBytes, ...(options.log === undefined ? {} : { log: options.log }) };

/**
 * The path of a request's URL, whichever runtime asked.
 *
 * Node hands a path and a query; Bun and Deno hand a whole URL. Resolved
 * against a base that is never reached, both read the same.
 */
const pathOf = (url: string | undefined): string => {
  if (url === undefined) return '';
  try { return new URL(url, 'ws://localhost').pathname; }
  catch { return ''; } // A URL nothing can parse is not the join path.
};

/**
 * The door: who, if anyone, a request's token carries.
 *
 * The deployment's own token admits the socket and is the host, which is
 * what it has always done and the one thing that does not change. Anything
 * else is put to `identify`, which a daemon wires to its user directory: the
 * answer says whether the token opens the door at all, and whether it also
 * says who they are. A person's own token opens it and names them, unless
 * their record requires the issuer - decision
 * `a-persons-token-names-them-unless-the-issuer-is-required` - in which case
 * the socket is admitted and `authenticate` with the issuer's token is what
 * signs them in. A host with no directory passes no `identify`, so nothing
 * changes for it.
 *
 * The WebSocket handshake and a plain request are both decided here, so the
 * two can never disagree about a token.
 */
export const doorOf = (options: DoorOptions): Door => {
  const token = options.token;
  const join = options.join;
  return async (url, authorization) => {
    const held = presented(url, authorization);
    /*
     * The join path, decided by a node's own token and by nothing else. A node
     * holding the deployment's key would be a node holding every key, so that
     * token is not asked about here even where the two paths meet.
     */
    if (join !== undefined && pathOf(url) === join.path) {
      const node = held === undefined || held === '' ? undefined : await join.verify(held);
      return node === undefined ? { admitted: false } : { admitted: true, node };
    }
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
};

/** The sentence a refused token is answered with, on the handshake and on a plain request. */
const TOKEN_REQUIRED = 'A connection token is required';

/** The sentence an admitted plain request is answered with. */
const SPEAKS_AHP = 'ahpd speaks the Agent Host Protocol over WebSocket';

/**
 * The headers of a plain request's answer.
 *
 * Any origin may read it, so a page served from anywhere can test a token.
 */
const PLAIN_HEADERS = { 'content-type': 'text/plain', 'access-control-allow-origin': '*' } as const;

/** The status and the body of a plain request's answer: 401 for a refused token, 426 for an admitted one. */
const plainVerdict = (admission: Admission): { status: number; body: string } =>
  (admission.admitted ? { status: 426, body: SPEAKS_AHP } : { status: 401, body: TOKEN_REQUIRED });

/**
 * The answer to a plain request on a WebSocket port.
 *
 * 401 when the handshake would refuse the request's token, and 426 when it
 * would admit it, so a client can test a token without opening a socket.
 */
export const plainAnswer = async (door: Door, request: Request): Promise<Response> => {
  const { status, body } = plainVerdict(await door(request.url, request.headers.get('authorization')));
  return new Response(body, { status, headers: PLAIN_HEADERS });
};

export async function listen(options: ListenOptions, onConnect: OnConnect): Promise<Listener> {
  const here = runtime();
  if (here === 'node' && options.request !== undefined) mountable(options.nodeRequest);
  const host = options.host ?? '127.0.0.1';
  let accepted = 0;
  const token = options.token;
  const identityOf = doorOf(options);
  // Read once, since the reader inside it is called at each send: what a
  // caller passed is a function, and whether it passed one does not change.
  const bounding = boundingOf(options);

  if (here === 'bun') {
    const Bun = (globalThis as unknown as { Bun: {
      serve(options: Record<string, unknown>): BunServer;
    } }).Bun;
    // Per socket, because Bun's handler table is one set of callbacks for
    // every connection - `ws` is the only thing distinguishing them.
    const bound = new Map<object, Bound>();
    const server = Bun.serve({
      port: options.port,
      hostname: host,
      async fetch(request: Request, server_: {
        upgrade(r: Request, options?: { data?: unknown }): boolean;
        requestIP?(r: Request): { address: string } | null;
      }) {
        // A plain request is the host's own HTTP surface when it has one,
        // answered in full there and never signed in at this door. Without
        // one, it is answered by its token.
        if (!upgrading(request)) return options.request === undefined ? plainAnswer(identityOf, request) : options.request(request);
        // Refused before the upgrade, so an unauthorised client is told in
        // HTTP rather than handed a socket that closes on its first message.
        const identity = await identityOf(request.url, request.headers.get('authorization'));
        if (!identity.admitted) {
          return new Response(TOKEN_REQUIRED, { status: 401 });
        }
        // What the door decided rides on the socket, because Bun's `open` is
        // handed the socket and not the request this answer came from.
        const data = {
          principal: identity.principal, root: identity.root, node: identity.node, url: request.url,
          // Read here because `server_` is the only place either is in hand:
          // Bun answers the address from the request and nowhere else.
          address: server_.requestIP?.(request)?.address,
          forwardedFor: request.headers.get('x-forwarded-for') ?? undefined,
        };
        if (server_.upgrade(request, { data })) return undefined;
        return new Response(SPEAKS_AHP, { status: 426, headers: PLAIN_HEADERS });
      },
      websocket: {
        open(ws: BunSocket) {
          const number = ++accepted;
          const seen = tapping(options.tap, number);
          const peer = createPeer({
            send: (text) => { seen.out(text); ws.send(text); },
            close: () => ws.close(),
            isOpen: () => ws.readyState === 1,
            buffered: () => ws.getBufferedAmount(),
          }, bounding);
          const arrival = ws.data as {
            principal?: Principal; root?: boolean; node?: string; url?: string; address?: string; forwardedFor?: string;
          } | undefined;
          bound.set(ws, {
            peer,
            connected: onConnect(peer, arrival?.principal, arrival?.root, openedOf({
              url: arrival?.url,
              node: arrival?.node,
              socket: number,
              address: arrival?.address,
              forwardedFor: arrival?.forwardedFor,
            })),
            seen,
          });
        },
        message(ws: BunSocket, raw: string | Uint8Array) {
          const held = bound.get(ws);
          if (!held) return;
          const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
          held.seen.in(text);
          take(held.connected, held.peer, text);
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
    return {
      runtime: here,
      host,
      port: server.port,
      guarded: token !== undefined,
      // The sockets first, since a stop waits on an open one as on a request.
      close: () => {
        for (const ws of bound.keys()) (ws as BunSocket).close(GOING_AWAY, STOPPING);
        return stopBun(server);
      },
    };
  }

  if (here === 'deno') {
    const Deno = (globalThis as unknown as { Deno: {
      serve(
        options: { port: number; hostname: string },
        handler: (r: Request, info: { remoteAddr: { transport: string; hostname?: string } }) => Response | Promise<Response>,
      ): {
        shutdown(): Promise<void>;
        addr: { port: number };
      };
      upgradeWebSocket(r: Request): { socket: DenoSocket; response: Response };
    } }).Deno;
    /** The upgraded sockets still open, closed first on close: a shutdown waits on each. */
    const sockets = new Set<DenoSocket>();
    const server = Deno.serve({ port: options.port, hostname: host }, async (request, info) => {
      if (!upgrading(request)) return options.request === undefined ? plainAnswer(identityOf, request) : options.request(request);
      const identity = await identityOf(request.url, request.headers.get('authorization'));
      if (!identity.admitted) {
        return new Response(TOKEN_REQUIRED, { status: 401 });
      }
      // A unix socket has a path rather than an address, and Deno reports the
      // transport that tells them apart.
      const address = info.remoteAddr.transport === 'tcp' ? info.remoteAddr.hostname : undefined;
      const forwardedFor = request.headers.get('x-forwarded-for') ?? undefined;
      const { socket, response } = Deno.upgradeWebSocket(request);
      sockets.add(socket);
      let held: Bound | undefined;
      socket.onopen = () => {
        const number = ++accepted;
        const seen = tapping(options.tap, number);
        const peer = createPeer({
          send: (text) => { seen.out(text); socket.send(text); },
          close: () => socket.close(),
          isOpen: () => socket.readyState === 1,
          buffered: () => socket.bufferedAmount,
        }, bounding);
        // Closed over rather than carried on the socket: this handler already
        // has the answer the upgrade was decided on.
        held = {
          peer,
          connected: onConnect(peer, identity.principal, identity.root, openedOf({
            url: request.url, node: identity.node, socket: number, address, forwardedFor,
          })),
          seen,
        };
      };
      socket.onmessage = (event) => {
        const open = held;
        if (!open) return;
        const text = String(event.data);
        open.seen.in(text);
        take(open.connected, open.peer, text);
      };
      socket.onclose = () => { sockets.delete(socket); held?.peer.close(); held?.connected.close(); held = undefined; };
      return response;
    });
    return {
      runtime: here,
      host,
      port: server.addr.port,
      guarded: token !== undefined,
      close: () => {
        for (const socket of sockets) socket.close(GOING_AWAY, STOPPING);
        return within(server.shutdown());
      },
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
  const decided = new WeakMap<object, { principal?: Principal | undefined; root?: boolean | undefined; node?: string | undefined }>();
  // `ws` answers a rejected handshake with the status this passes back, so an
  // unauthorised client reads 401 rather than a socket that opened and then
  // closed for no stated reason.
  const verifyClient = (
    info: { req: NodeRequest },
    accept: (allow: boolean, code?: number, message?: string) => void,
  ): void => {
    void identityOf(info.req.url, info.req.headers.authorization ?? null).then((identity) => {
      if (identity.admitted) {
        decided.set(info.req, { principal: identity.principal, root: identity.root, node: identity.node });
        accept(true);
        return;
      }
      accept(false, 401, TOKEN_REQUIRED);
    });
  };
  /*
   * The upgrade, and the plain requests beside it.
   *
   * Served on a `node:http` server of this module's own that `ws` attaches to,
   * so a close lets a request in flight finish as `serveRequests` does. A host
   * with an HTTP surface on the same port brings `nodeRequest`; one without is
   * answered by its token as on the other runtimes. The upgrade itself is
   * decided by the same `verifyClient` either way.
   */
  const { createServer } = await import('node:http');
  /** The `node:http` server `ws` is attached to, which `ws` does not close. */
  const plain = createServer(options.request === undefined
    ? (request, response) => {
      void identityOf(request.url, request.headers.authorization ?? null).then((admission) => {
        const { status, body } = plainVerdict(admission);
        response.writeHead(status, PLAIN_HEADERS);
        response.end(body);
      });
    }
    : mountable(options.nodeRequest));
  const server: NodeServer = new WebSocketServer({ server: plain, verifyClient });
  plain.listen(options.port, host);
  server.on('connection', (socket, request) => {
    const number = ++accepted;
    const seen = tapping(options.tap, number);
    const peer = createPeer({
      send: (text) => { seen.out(text); socket.send(text); },
      close: () => socket.close(),
      isOpen: () => socket.readyState === 1,
      buffered: () => socket.bufferedAmount,
    }, bounding);
    const arrival = decided.get(request);
    const connected = onConnect(peer, arrival?.principal, arrival?.root, openedOf({
      url: request.url,
      node: arrival?.node,
      socket: number,
      address: request.socket?.remoteAddress,
      forwardedFor: request.headers['x-forwarded-for'],
    }));
    decided.delete(request);
    socket.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      seen.in(text);
      take(connected, peer, text);
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
    // Settled once the port is let go of and every connection is gone: each
    // client is told the host is going away, and dropped if it has not closed
    // after `CLOSE_GRACE_MS`.
    close: () => new Promise<void>((done) => {
      for (const client of server.clients) client.close(GOING_AWAY, STOPPING);
      const stuck = setTimeout(() => {
        for (const client of server.clients) client.terminate();
      }, CLOSE_GRACE_MS);
      server.close(() => {
        clearTimeout(stuck);
        void closeHttp(plain).then(done);
      });
    }),
  };
}

/**
 * Serves plain HTTP requests on a port of their own, with no WebSocket.
 *
 * The same three runtimes `listen` answers on, through the same servers: the
 * handler is handed straight to `Bun.serve` and `Deno.serve`, and Node serves
 * `options.nodeRequest` on a `node:http` server. A port that cannot be bound
 * rejects, so a caller that must have it refuses to start.
 */
export async function serveRequests(options: RequestsOptions, handler: RequestHandler): Promise<RequestsListener> {
  const here = runtime();
  const host = options.host ?? '127.0.0.1';
  if (here === 'bun') {
    const Bun = (globalThis as unknown as { Bun: {
      serve(options: Record<string, unknown>): BunServer;
    } }).Bun;
    const server = Bun.serve({ port: options.port, hostname: host, fetch: handler });
    return { runtime: here, host, port: server.port, close: () => stopBun(server) };
  }
  if (here === 'deno') {
    const Deno = (globalThis as unknown as { Deno: {
      serve(options: { port: number; hostname: string }, handler: RequestHandler): {
        shutdown(): Promise<void>;
        addr: { port: number };
      };
    } }).Deno;
    const server = Deno.serve({ port: options.port, hostname: host }, handler);
    return { runtime: here, host, port: server.addr.port, close: () => within(server.shutdown()) };
  }
  const listener = mountable(options.nodeRequest);
  const { createServer } = await import('node:http');
  const server = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    const failed = (error: unknown): void => { reject(error instanceof Error ? error : new Error(String(error))); };
    server.once('error', failed);
    server.listen(options.port, host, () => {
      server.removeListener('error', failed);
      // A later error is one connection's, not the bind's.
      server.on('error', () => undefined);
      resolve();
    });
  });
  const bound = server.address();
  return {
    runtime: here,
    host,
    port: typeof bound === 'object' && bound !== null ? bound.port : options.port,
    close: () => closeHttp(server),
  };
}

/**
 * How long a closing listener lets a request in flight finish before its
 * connection is dropped, and how long a Deno shutdown is waited on.
 */
const CLOSE_GRACE_MS = 2_000;

/** The close code each WebSocket client gets when its listener closes: 1001, going away. */
const GOING_AWAY = 1001;

/** The reason sent with `GOING_AWAY`. */
const STOPPING = 'the host is stopping';

/**
 * Close a `node:http` server: the port at once, idle connections at once and
 * each busy one as its response finishes, and whatever is still busy after
 * `CLOSE_GRACE_MS`. Settles once the port is free and every connection is gone.
 */
const closeHttp = (server: import('node:http').Server): Promise<void> => new Promise((done) => {
  const idle = setInterval(() => { server.closeIdleConnections(); }, 25);
  const busy = setTimeout(() => { server.closeAllConnections(); }, CLOSE_GRACE_MS);
  server.close(() => {
    clearInterval(idle);
    clearTimeout(busy);
    done();
  });
  server.closeIdleConnections();
});

/**
 * Stop a Bun server: the port at once and each request in flight as it
 * finishes, and whatever is still running after `CLOSE_GRACE_MS`. Settles once
 * the port is free and every connection is gone.
 */
const stopBun = (server: BunServer): Promise<void> => new Promise((done) => {
  const busy = setTimeout(() => { void Promise.resolve(server.stop(true)).finally(done); }, CLOSE_GRACE_MS);
  void Promise.resolve(server.stop(false)).finally(() => { clearTimeout(busy); done(); });
});

/** A Deno shutdown, waited on for `CLOSE_GRACE_MS` at most: it waits for every request, however long. */
const within = (closing: Promise<void>): Promise<void> => new Promise((done) => {
  const bound = setTimeout(done, CLOSE_GRACE_MS);
  void closing.finally(() => { clearTimeout(bound); done(); });
});

/** Whether a request asks for the WebSocket upgrade. */
const upgrading = (request: Request): boolean =>
  (request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket';

/**
 * The Node listener a host handed in, or a refusal that says it is missing.
 *
 * Node's `node:http` takes a request and a response rather than a `Request`,
 * and this package has no adapter between the two: the host builds one.
 */
const mountable = (listener: NodeRequestListener | undefined): NodeRequestListener => {
  if (listener === undefined) {
    throw new Error(
      'Serving plain HTTP requests on Node needs `nodeRequest`, the handler as a `node:http` listener,\n'
      + 'for example `toNodeListener(handler)` from `@cofold/remote`. Bun and Deno serve the handler as it is.',
    );
  }
  return listener;
};

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
    // What a pipe has taken and the reader has not, which is the same
    // question a socket's queue answers.
    buffered: () => output.writableLength,
  }, boundingOf(options));
  // Never raw: there is no join path over a pipe, so nothing here is a node's.
  // The one pipe is socket one, which is the number its frames are tapped under.
  const connected = onConnect(peer, undefined, options.root !== false, openedOf({ socket: 1 }));

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
    take(connected, peer, line);
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

/** A server `Bun.serve` answered: `stop(true)` drops the connections still open, `stop(false)` waits for them. */
interface BunServer { stop(closeActive?: boolean): void | Promise<void>; port: number }

interface BunSocket { send(text: string): unknown; close(code?: number, reason?: string): void; readyState: number; getBufferedAmount(): number; data?: unknown }

interface DenoSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  /** What the socket has taken and the client has not read, as `WebSocket` declares it. */
  bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

interface NodeRequest {
  url?: string;
  headers: { authorization?: string; 'x-forwarded-for'?: string };
  /** The socket the request came in on, which is where Node reports the peer's address. */
  socket?: { remoteAddress?: string };
}

interface NodeOptions {
  port?: number;
  host?: string;
  /** An `http.Server` to attach to, when it also answers plain requests. */
  server?: unknown;
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
  /** Every socket still open. */
  readonly clients: Set<{ close(code: number, reason: string): void; terminate(): void }>;
  close(done?: () => void): void;
}

interface NodeSocket {
  send(text: string): void;
  close(): void;
  readyState: number;
  /** What `ws` has taken and the client has not read, as `@types/ws` declares it. */
  bufferedAmount: number;
  on(event: 'message', handler: (raw: string | Buffer) => void): void;
  on(event: 'close', handler: () => void): void;
}

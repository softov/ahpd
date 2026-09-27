/**
 * The HTTP API, mounted.
 *
 * `@cofold/remote`'s `serve()` answers a registry over HTTP; this is the two
 * decisions around it: the API lives under `/api`, and when the configuration
 * gives it a port of its own it gets a listener of its own rather than sharing
 * the daemon's - decision `the-http-api-is-on-the-daemon-port-under-api`.
 *
 * Off, the daemon's listener still answers plain requests, so `/api` is a 404
 * rather than the 426 it would otherwise be; everything that is not the API
 * keeps the answer it always had.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { serve, type RequestHandler } from '@cofold/remote';
import type { Runner } from '@cofold/commands';
import type { Users } from '@ahpd/sdk';
import { authorizeOverHttp } from './commands/authorize.js';

/** The path the API is served under, on whichever listener carries it. */
export const API_PREFIX = '/api';

/** The sentence this listener answers a non-upgrade request with, as `ws` did. */
const SPEAKS_AHP = 'ahpd speaks the Agent Host Protocol over WebSocket';

/** What the manifest names. */
export interface ApiProgram {
  name: string;
  version: string;
  description?: string;
}

/**
 * The authorities and origins this API answers to.
 *
 * An authority is a `Host` header value: a loopback name or the bound address
 * at the bound port, and the host of `resource` when a deployment names the
 * name it is reached through. An origin is what a browser sends in `Origin`.
 */
export interface ApiOrigins {
  /** Every `host:port` a request's `Host` header may name. */
  readonly authorities: readonly string[];
  /** Every `Origin` header value the API accepts. */
  readonly origins: readonly string[];
}

/** What a mount is built from. */
export interface ApiOptions {
  /** The same declarations the terminal renders. */
  registry: Runner;
  /** The deployment's own token, which is root. */
  token?: string;
  /** The people who may sign in, when any are configured. */
  users?: Users;
  /** What the API says it is, in the manifest. */
  program: ApiProgram;
  /** The daemon's own names, read per request because the bound port is known after `listen`. */
  origins(): ApiOrigins;
}

/**
 * Why a request is not one this API answers, or nothing.
 *
 * A `Host` that is not one of the daemon's names is the DNS-rebinding shape: a
 * page on another site points its own name at loopback and reads the answers as
 * same-origin. An `Origin` is the cross-site shape, and a browser sends it
 * without being asked. A request with no `Host` at all names nothing this API
 * could be, so it is refused with the same sentence. Neither is a credential
 * question, so all three are refused before a route or a grant is looked at.
 */
function foreign(request: IncomingMessage, allowed: ApiOrigins): string | undefined {
  const host = request.headers.host;
  if (host === undefined) return 'This API does not answer to a request with no Host';
  if (!allowed.authorities.includes(host)) return `This API does not answer to ${host}`;
  const origin = request.headers.origin;
  if (origin !== undefined && !allowed.origins.includes(origin)) return `This API does not answer to ${origin}`;
  return undefined;
}

/**
 * The API, as the request handler a listener carries.
 *
 * The prefix is what every route and the manifest hang off. `authorize` answers
 * who the caller is and hands that on to the command; the registry's own
 * `authorize` hook is what holds them to the command's scopes. A request from
 * another site is refused here, before either.
 */
export function apiHandler(options: ApiOptions): RequestHandler {
  const api = serve(options.registry, options.program, {
    prefix: API_PREFIX,
    authorize: authorizeOverHttp({
      ...(options.token === undefined ? {} : { token: options.token }),
      ...(options.users === undefined ? {} : { users: options.users }),
    }),
  });
  return guarded((request, response, path) => {
    if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
      const refusal = foreign(request, options.origins());
      if (refusal !== undefined) {
        sendJson(response, 403, { message: refusal });
        return;
      }
    }
    api(request, response);
  });
}

/**
 * What a daemon with no API answers a plain request with.
 *
 * `/api` and everything under it is 404, because a path nobody serves is not a
 * WebSocket handshake; anything else is 426, because this listener speaks the
 * protocol and a plain request is not one.
 */
export function withoutApi(): RequestHandler {
  return guarded((request, response, path) => {
    if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
      sendJson(response, 404, { message: `No API at ${path}` });
      return;
    }
    response.writeHead(426, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(SPEAKS_AHP) });
    response.end(SPEAKS_AHP);
  });
}

/** What a request whose `Host` or path cannot be read is answered with. */
const REQUEST_UNREADABLE = 'The request path or Host is not valid';

/**
 * A handler no malformed request can throw out of.
 *
 * The URL is built and every path segment decoded before a route looks at
 * either: a `Host` that does not parse and a path that is not a valid
 * percent-encoding are nobody's route, and a daemon that ended on one would
 * take every other connection with it. The handler is called outside that check
 * and its own failure is answered rather than allowed to escape.
 */
function guarded(handler: (request: IncomingMessage, response: ServerResponse, path: string) => void): RequestHandler {
  return (request, response) => {
    let path: string;
    try {
      path = pathOf(request);
      for (const part of path.split('/')) decodeURIComponent(part);
    }
    catch {
      sendJson(response, 400, { message: REQUEST_UNREADABLE });
      return;
    }
    try {
      handler(request, response, path);
    }
    catch {
      if (response.headersSent) response.destroy();
      else sendJson(response, 500, { message: 'Failed' });
    }
  };
}

/** A listener of the API's own, and the port it actually bound. */
export interface ApiListener {
  readonly port: number;
  close(): void;
}

/**
 * The API on its own port, for `http.port`.
 *
 * Bound before the daemon announces itself, so a port that is taken refuses the
 * start rather than leaving a daemon whose API is missing. `port: 0` is the OS
 * choosing, and the answer is the port it chose.
 */
export function listenApi(handler: RequestHandler, options: { port: number; host: string }): Promise<ApiListener> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    const failed = (error: unknown): void => { reject(error instanceof Error ? error : new Error(String(error))); };
    server.once('error', failed);
    server.listen(options.port, options.host, () => {
      server.removeListener('error', failed);
      server.on('error', () => { /* a later error is the socket's, not the start's */ });
      const bound = server.address();
      resolve({
        port: typeof bound === 'object' && bound !== null ? bound.port : options.port,
        close: () => { server.close(); },
      });
    });
  });
}

/** The pathname a request asked for, host header and all. */
const pathOf = (request: IncomingMessage): string =>
  new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(`${body}\n`);
}

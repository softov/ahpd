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
}

/**
 * The API, as the request handler a listener carries.
 *
 * The prefix is what every route and the manifest hang off, and `authorize` is
 * the grant check asked once per request - the same question the WebSocket gate
 * asks, answered from the same directory.
 */
export function apiHandler(options: ApiOptions): RequestHandler {
  return serve(options.registry, options.program, {
    prefix: API_PREFIX,
    authorize: authorizeOverHttp({
      registry: options.registry,
      ...(options.token === undefined ? {} : { token: options.token }),
      ...(options.users === undefined ? {} : { users: options.users }),
    }),
  });
}

/**
 * What a daemon with no API answers a plain request with.
 *
 * `/api` and everything under it is 404, because a path nobody serves is not a
 * WebSocket handshake; anything else keeps the 426 this listener has always
 * answered, so the only thing that changes for a request is the path the whole
 * task is about.
 */
export function withoutApi(): RequestHandler {
  return (request, response) => {
    const path = pathOf(request);
    if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
      sendJson(response, 404, { message: `No API at ${path}` });
      return;
    }
    response.writeHead(426, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(SPEAKS_AHP) });
    response.end(SPEAKS_AHP);
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

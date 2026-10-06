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
 *
 * A plugin's own route is mounted here too, under `/plugins/<name>/`, because
 * it is the same listener, the same `Request` and the same path handling as
 * the API - decision `plugin-registration-kinds`, whose route row is this.
 */

import { serve, toNodeListener, type RequestHandler } from '@cofold/remote';
import type { Runner } from '@cofold/commands';
import { routeOf, ROUTE_ROOT, serveRequests, type NodeRequestListener, type Route, type Users } from '@ahpd/sdk';
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
 * Why a request's `Host` is not one this answers, or nothing.
 *
 * A `Host` that is not one of the daemon's names is the DNS-rebinding shape: a
 * page on another site points its own name at loopback and reads the answers as
 * same-origin. A request with no `Host` at all names nothing this could be, so
 * it is refused with the same sentence.
 *
 * One helper for the API and for a plugin's route, because the two guards are
 * the same one: a name this host does not answer to is a name this host does
 * not answer to, whatever asked. What differs is the sentence, which is what
 * the caller passes, and the `Origin` below, which is the API's alone.
 */
export function hostRefusal(request: Request, authorities: readonly string[], subject: string): string | undefined {
  const host = request.headers.get('host');
  if (host === null) return `${subject} does not answer to a request with no Host`;
  if (!authorities.includes(host)) return `${subject} does not answer to ${host}`;
  return undefined;
}

/**
 * Why a request is not one this API answers, or nothing.
 *
 * The `Host` above, and then an `Origin` that is not one of the daemon's: the
 * cross-site shape, which a browser sends without being asked. A route takes
 * only the `Host`, because a webhook and a platform callback send no `Origin`
 * and authenticate their own caller instead. Neither is a credential question,
 * so both are refused before a command or a grant is looked at.
 */
export function foreign(request: Request, allowed: ApiOrigins): string | undefined {
  return hostRefusal(request, allowed.authorities, 'This API') ?? originRefusal(request, allowed.origins, 'This API');
}

/** Why a request's `Origin` is not one of the daemon's, or nothing; a request with none is a caller outside a browser. */
export function originRefusal(request: Request, origins: readonly string[], subject: string): string | undefined {
  const origin = request.headers.get('origin');
  if (origin !== null && !origins.includes(origin)) return `${subject} does not answer to ${origin}`;
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
  return guarded((request, path) => {
    if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
      const refusal = foreign(request, options.origins());
      if (refusal !== undefined) return Promise.resolve(json(403, { message: refusal }));
    }
    return api(request);
  });
}

/** The path the model proxy is served under, beside the API - decision `the-proxy-answers-under-v1-beside-the-api`. */
export const PROXY_PREFIX = '/v1';

/** Whether a path is `prefix` or under it. */
export const isUnder = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/**
 * What a daemon with no API answers a plain request with.
 *
 * `/api` and `/v1` and everything under them is 404, because a path nobody
 * serves is not a WebSocket handshake; anything else is 426, because this
 * listener speaks the protocol and a plain request is not one.
 */
export function withoutApi(): RequestHandler {
  return guarded((_request, path) => {
    if (isUnder(path, API_PREFIX) || isUnder(path, PROXY_PREFIX)) {
      return Promise.resolve(json(404, { message: `No API at ${path}` }));
    }
    return Promise.resolve(new Response(SPEAKS_AHP, { status: 426, headers: { 'content-type': 'text/plain' } }));
  });
}

/** What a plugin's routes are served from, read when a request asks. */
export interface PluginRoutesOptions {
  /**
   * Every route the loaded plugins registered, by plugin name.
   *
   * A function rather than a value, because this mount is built before any
   * plugin has applied: the listener is handed the plain-request handler
   * before `loadPlugins` folds what the plugins registered.
   */
  routes(): Readonly<Record<string, Route>>;
  /**
   * Every `Host` a route answers to, read per request.
   *
   * The daemon's own names plus whatever a tunnel announced, so a webhook that
   * arrives through a tunnel names a host this has never been configured with.
   */
  authorities(): readonly string[];
  /** What answers a path that is not a plugin's route: the API, or the 426. */
  otherwise(request: Request): Promise<Response>;
  /** One line to the daemon's log, for a handler that failed. */
  onProblem?(line: string): void;
}

/**
 * A plugin's routes, mounted on the daemon's own listener.
 *
 * The same `guarded` wrapper the API goes through, so a path that is not a
 * valid percent-encoding is answered 400 here rather than throwing out of a
 * handler, and every segment is decoded before a prefix looks at one.
 *
 * `Host` is checked and `Origin` is not, and no body is held to JSON. A route
 * is called by something outside a browser - a webhook, a platform callback, a
 * tunnel - and it authenticates its own caller: a signature, or a token in its
 * own path or headers. What it does on the host goes through its plugin's
 * connection, so the grants its operator wrote are the gate.
 *
 * A path under `/plugins/` that no loaded plugin registered is 404 rather than
 * the 426 the rest of this listener gives, so an author whose route did not
 * load is told there is nothing there instead of being told they spoke the
 * wrong protocol.
 */
export function pluginRoutes(options: PluginRoutesOptions): RequestHandler {
  return guarded(async (request, path) => {
    const found = routeOf(options.routes(), path);
    if (found === undefined) {
      return path === ROUTE_ROOT || path.startsWith(`${ROUTE_ROOT}/`)
        ? json(404, { message: `No plugin route at ${path}` })
        : options.otherwise(request);
    }
    const refusal = hostRefusal(request, options.authorities(), 'This route');
    if (refusal !== undefined) return json(403, { message: refusal });
    /*
     * A handler that throws is one plugin's failed request, not a failed
     * listener: the daemon keeps serving, the log names the plugin whose route
     * it was, and the caller is told the shape of the failure rather than the
     * reason, which is that plugin's own.
     */
    try {
      return await found.handler(request);
    }
    catch (error) {
      options.onProblem?.(`plugin ${found.by} failed at ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return json(500, { message: `The route plugin ${found.by} registered failed; its reason is in the daemon log` });
    }
  });
}

/** What a request whose `Host` or path cannot be read is answered with. */
const REQUEST_UNREADABLE = 'The request path or Host is not valid';

/**
 * A handler no malformed request can throw out of.
 *
 * The URL is read and every path segment decoded before a route looks at
 * either: a path that is not a valid percent-encoding is nobody's route, and a
 * daemon that ended on one would take every other connection with it. The
 * handler is called outside that check and its own failure is answered rather
 * than allowed to escape.
 */
export function guarded(handler: (request: Request, path: string) => Promise<Response>): RequestHandler {
  return async (request) => {
    let path: string;
    try {
      path = pathOf(request);
      for (const part of path.split('/')) decodeURIComponent(part);
    }
    catch {
      return json(400, { message: REQUEST_UNREADABLE });
    }
    try {
      return await handler(request, path);
    }
    catch {
      return json(500, { message: 'Failed' });
    }
  };
}

/** One handler in both shapes a listener takes: as it is for Bun and Deno, and as a `node:http` listener for Node. */
export interface PlainRequests {
  request: RequestHandler;
  nodeRequest: NodeRequestListener;
}

/** `handler` in both shapes, for `listen` and `serveRequests` to mount whichever the runtime takes. */
export const plainRequests = (handler: RequestHandler): PlainRequests => ({
  request: handler,
  nodeRequest: toNodeListener(handler),
});

/** A listener of the API's own, and the port it actually bound. */
export interface ApiListener {
  readonly port: number;
  close(): void | Promise<void>;
}

/**
 * The API on its own port, for `http.port`.
 *
 * Bound before the daemon announces itself, so a port that is taken refuses the
 * start rather than leaving a daemon whose API is missing. `port: 0` is the OS
 * choosing, and the answer is the port it chose. Served on whichever runtime
 * this is, the same way the daemon's own listener is.
 */
export async function listenApi(handler: RequestHandler, options: { port: number; host: string }): Promise<ApiListener> {
  const served = await serveRequests(
    { port: options.port, host: options.host, nodeRequest: plainRequests(handler).nodeRequest },
    handler,
  );
  return { port: served.port, close: () => served.close() };
}

/** The pathname a request asked for. */
const pathOf = (request: Request): string => new URL(request.url).pathname;

/** A JSON answer, in the shape `serve()` gives its own. */
export function json(status: number, value: unknown): Response {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, { status, headers: { 'content-type': 'application/json' } });
}

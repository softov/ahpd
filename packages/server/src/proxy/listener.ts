/**
 * The model proxy, under `/v1` on the listener that carries `/api`.
 *
 * A person's own tool posts a chat completion or a message here with its ahpd
 * token, naming a model `<maker>/<name>`. The call is checked (the guard, the
 * caller, the body), routed to the first provider entry that can take it, and
 * sent there with that provider's own model id and key; the provider's answer
 * streams back as it came, SSE included, and nothing is translated - decision
 * `the-proxy-answers-under-v1-beside-the-api`.
 *
 * Every refusal is the caller's dialect's own error body, so a tool shows it
 * rather than failing to parse it. A provider's key is read from its variable
 * per call and goes into the one upstream header and nowhere else: not a
 * refusal, not a log line, not a record.
 *
 * The proxy configuration is the one read when the daemon started; a
 * provider's key is read from the environment and a caller from the users
 * file on every call.
 */

import type { RequestHandler } from '@cofold/remote';
import { decide, type ModelUse, type Owner, type Policies, type Scope, type Usage, type Users } from '@ahpd/sdk';
import { foreign, guarded, isUnder, json, originRefusal, PROXY_PREFIX, type ApiOrigins } from '../http.js';
import { callerName, callerOf, type ProxyCaller, type SessionCaller } from './caller.js';
import {
  dialectAt, dialectOfHeaders, keyHeader, MODELS_PATH, modelList, refusalBody, usageReader,
  type Refusal, type Tokens,
} from './dialects.js';
import { DIALECTS, type Dialect, type ModelEntry, type ProxyConfiguration } from './providers.js';
import { route, type Candidate } from './route.js';

/** How long a provider has to send its status and headers. A local model loading its weights is slow to start. */
export const HEADERS_TIMEOUT_MS = 120_000;

/** How long a provider may go between two chunks of its answer before the call is cut. */
export const IDLE_TIMEOUT_MS = 300_000;

/** The largest request body a call may send, which is the request size Anthropic's API documents. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** What the proxy is built from. */
export interface ProxyOptions {
  /** The providers and model names, as read when the daemon started. */
  proxy(): ProxyConfiguration;
  /** The deployment's own token, which is root. */
  token?: string;
  /** The people who may call. */
  users?: Users;
  /**
   * The session a token belongs to, or nothing when it is no session's.
   *
   * Asked after the deployment token and before the directory, so a session's
   * token never reaches an issuer over the network. Filled by whatever hands a
   * session a token for this proxy.
   */
  whose?(token: string): SessionCaller | undefined;
  /** The policies a call is held to, when `policiesCheck` is on. */
  policies?: Policies;
  /** Whether policies are checked: `policies.check`. */
  policiesCheck?: boolean;
  /** Where a call is recorded, read per call because a plugin may replace the store. */
  usage?(): Usage | undefined;
  /** What this host is called, for the work root does: `root:<hostName>`. */
  hostName: string;
  /** The daemon's own names, read per request because the bound port is known after `listen`. */
  origins(): ApiOrigins;
  /** What answers a path that is not under `/v1`: the API, or the 426. */
  otherwise(request: Request): Promise<Response>;
  /** One line to the daemon's log. Never handed a header or a key. */
  onProblem?(line: string): void;
  /** Where a provider's key is read from. The process's environment when absent. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The `fetch` a call goes out through. The global one when absent. */
  fetch?: typeof fetch;
  /** Overrides `HEADERS_TIMEOUT_MS`. */
  headersTimeoutMs?: number;
  /** Overrides `IDLE_TIMEOUT_MS`. */
  idleTimeoutMs?: number;
  /** Overrides `MAX_BODY_BYTES`. */
  maxBodyBytes?: number;
}

/** A `Host` naming a loopback address, at any port: where a `-R` forward lands. */
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/u;

/** Headers that belong to one connection, which a proxy never copies either way. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

/**
 * Request headers that never go upstream.
 *
 * The caller's credential and scope are this host's, not the provider's; the
 * rest name this connection or this host, or are recomputed for the body that
 * is actually sent. `accept-encoding` is left to `fetch`, which decodes what it
 * asked for.
 */
const NOT_SENT = new Set([
  'authorization', 'x-api-key', 'cookie', 'host', 'content-length', 'origin', 'forwarded', 'accept-encoding', 'expect',
]);

/** Response headers that never come back: `fetch` has already decoded the body, and a provider's cookie is not this host's. */
const NOT_RETURNED = new Set(['set-cookie', 'content-encoding', 'content-length']);

/**
 * Headers that name the provider account's organization or project, kept out
 * both ways: a caller does not pick the host's account, and an answer does not
 * tell a caller which account the host's key belongs to.
 */
const ACCOUNT = new Set(['openai-organization', 'openai-project', 'anthropic-organization-id']);

/**
 * Prefixes of the response headers that report the provider account's rate
 * limits: OpenAI's and OpenRouter's `x-ratelimit-*`, Anthropic's
 * `anthropic-ratelimit-*`. `retry-after` and `retry-after-ms` are kept: they
 * say only when this answer may be retried, which a client's SDK backs off by.
 */
const ACCOUNT_LIMITS = ['x-ratelimit-', 'anthropic-ratelimit-'];

/** The headers `from`'s own `Connection` header names, which are hop-by-hop as well (RFC 9110 7.6.1). */
const connectionNamed = (from: Headers): Set<string> =>
  new Set((from.get('connection') ?? '').split(',').map((one) => one.trim().toLowerCase()).filter((one) => one !== ''));

/** The headers a call goes upstream with: the caller's own, less this host's, plus the provider's key. */
export const upstreamHeaders = (from: Headers, dialect: Dialect, key: string | undefined): Headers => {
  const out = new Headers();
  const named = connectionNamed(from);
  for (const [name, value] of from) {
    const lower = name.toLowerCase();
    if (NOT_SENT.has(lower) || HOP_BY_HOP.has(lower) || named.has(lower) || ACCOUNT.has(lower)) continue;
    if (lower.startsWith('x-ahp-') || lower.startsWith('x-forwarded-') || lower.startsWith('proxy-')) continue;
    out.append(name, value);
  }
  if (key !== undefined) out.set(...keyHeader(dialect, key));
  if (!out.has('content-type')) out.set('content-type', 'application/json');
  return out;
};

/** The headers an answer comes back with: the provider's, less what describes a body or connection it no longer is and the account's own. */
const returnedHeaders = (from: Headers): Headers => {
  const out = new Headers();
  const named = connectionNamed(from);
  for (const [name, value] of from) {
    const lower = name.toLowerCase();
    if (NOT_RETURNED.has(lower) || HOP_BY_HOP.has(lower) || named.has(lower) || ACCOUNT.has(lower)) continue;
    if (ACCOUNT_LIMITS.some((prefix) => lower.startsWith(prefix))) continue;
    out.append(name, value);
  }
  return out;
};

/** The body a caller sent, or the refusal for one too large or not a call. */
const bodyOf = async (request: Request, limit: number): Promise<{ body: Record<string, unknown>; model: string } | { refusal: Refusal }> => {
  const tooLarge: Refusal = { status: 413, message: `The request body is larger than ${String(limit)} bytes` };
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) return { refusal: tooLarge };
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        return { refusal: tooLarge };
      }
      chunks.push(value);
    }
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return { refusal: { status: 400, message: 'The request body is not JSON' } }; }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { refusal: { status: 400, message: 'The request body is not a JSON object' } };
  }
  const model = (body as Record<string, unknown>)['model'];
  if (typeof model !== 'string' || model === '') {
    return { refusal: { status: 400, message: 'The request body names no model: set model to <maker>/<name>' } };
  }
  return { body: body as Record<string, unknown>, model };
};

/** Why a fetch failed, as words that hold no URL and no header: the system's error code when it gave one. */
const failureOf = (error: unknown): string => {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : undefined;
  return code === undefined ? 'unreachable' : `unreachable (${code})`;
};

/**
 * The pools one record is charged to: the owner, the team and the project,
 * each only when the record has it - decision
 * `agent-usage-is-charged-to-owner-team-and-project-pools`. The same spelling
 * the agent meter charges under.
 */
const poolsOf = (owner: Owner | undefined, scope: Scope | undefined): string[] => [
  ...(owner === undefined ? [] : [owner]),
  ...(scope === undefined ? [] : [`team:${scope.team}`]),
  ...(scope?.project === undefined ? [] : [`project:${scope.team}:${scope.project}`]),
];

/**
 * What a call cost by the entry's price, in dollars per million tokens.
 *
 * Cache reads and writes are charged at the input price until there are cache
 * prices, so the figure is never under what the call could have cost. Nothing
 * when the entry has no price or no tokens were read.
 */
const costOf = (entry: ModelEntry, tokens: Tokens): number | undefined => {
  const price = entry.price;
  if (price === undefined) return undefined;
  const prompt = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
  const read = tokens.input !== undefined || tokens.output !== undefined || tokens.cache !== undefined;
  if (!read) return undefined;
  return (prompt * (price.input ?? 0) + (tokens.output ?? 0) * (price.output ?? 0)) / 1_000_000;
};

/** One call's caller, as what a policy checks and a record carries. */
interface Charged {
  /** Whose policies are asked, or nothing: root, a host with no directory, a session for nobody. */
  principal?: Parameters<typeof decide>[1];
  /** The team and project. */
  scope?: Scope;
  /** Who it belongs to. */
  owner?: Owner;
  /** Whether a record is written. */
  recorded: boolean;
  /** The session, chat and turn, for a session's call. */
  session?: SessionCaller;
}

/** What a caller is checked and charged as. */
const chargedAs = (caller: ProxyCaller, options: ProxyOptions, proxy: ProxyConfiguration): Charged => {
  if (caller.kind === 'root') return { owner: `root:${options.hostName}`, recorded: true };
  if (caller.kind === 'person') {
    return {
      principal: caller.principal,
      ...(caller.scope === undefined ? {} : { scope: caller.scope }),
      owner: `user:${caller.principal.id}`,
      recorded: true,
    };
  }
  // `skip`: the session meter is the one record, and the session is not held
  // to a policy here either.
  if (proxy.sessionCalls === 'skip') return { recorded: false };
  const owner = caller.owner ?? (caller.principal === undefined ? undefined : `user:${caller.principal.id}` as const);
  return {
    ...(caller.principal === undefined ? {} : { principal: caller.principal }),
    ...(caller.scope === undefined ? {} : { scope: caller.scope }),
    ...(owner === undefined ? {} : { owner }),
    recorded: true,
    session: caller,
  };
};

/**
 * The policy a route is held to for one caller and one name, or nothing.
 *
 * Only with the checks on, a store, and a person behind the call. A store that
 * cannot be read refuses, as the host's own check does: a check that failed
 * open is not a check.
 */
const policyFor = (options: ProxyOptions, charged: Charged, name: string) => {
  const store = options.policies;
  const principal = charged.principal;
  if (options.policiesCheck !== true || store === undefined || principal === undefined) return undefined;
  return async (entry: ModelEntry): Promise<string | undefined> => {
    try {
      const decision = await decide(store, principal, charged.scope, 'model', { model: name, proxy: entry.provider });
      return decision.allowed ? undefined : decision.refusal.message;
    }
    catch (error) {
      return `no policy could be read, so model is refused: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
};

/** Why one candidate was left, for the log. */
type Left = { provider: string; why: string };

/** What one attempt at a candidate came to. */
type Attempt =
  | { kind: 'answered'; response: Response; controller: AbortController }
  | { kind: 'failed'; why: string; status: 502 | 504; retry: boolean };

/**
 * The proxy, as the request handler a listener carries.
 *
 * A path under `/v1` is the proxy's: a call at `/v1/chat/completions` or
 * `/v1/messages`, the list at `/v1/models`, and a 404 in OpenAI's body for any
 * other. Everything else is `otherwise`'s.
 */
export function proxyHandler(options: ProxyOptions): RequestHandler {
  const say = (line: string): void => { options.onProblem?.(line); };
  const headersTimeout = options.headersTimeoutMs ?? HEADERS_TIMEOUT_MS;
  const idleTimeout = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const maxBody = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const send = options.fetch ?? globalThis.fetch;

  /**
   * Why a request is not one this proxy answers, or nothing.
   *
   * `Host` is the API's names, or a loopback name at any port: a forward from
   * a machine elsewhere lands on a loopback port that is not the daemon's, and
   * a rebinding page sends its own name, not a loopback one. `Origin` is held
   * as the API holds it.
   */
  const refusedGuard = (request: Request): string | undefined => {
    const allowed = options.origins();
    const host = request.headers.get('host');
    if (host !== null && LOOPBACK_HOST.test(host)) return originRefusal(request, allowed.origins, 'This API');
    return foreign(request, allowed);
  };

  /**
   * One attempt at one candidate: its status and headers, or why there were none.
   *
   * A caller who has hung up starts no attempt. A provider that sends no
   * headers in time is not retried, since it may be doing the work.
   */
  const attempt = async (request: Request, dialect: Dialect, body: Record<string, unknown>, candidate: Candidate): Promise<Attempt> => {
    if (request.signal.aborted) return { kind: 'failed', why: 'not tried, the caller hung up', status: 502, retry: false };
    const controller = new AbortController();
    const hangUp = (): void => { controller.abort(); };
    request.signal.addEventListener('abort', hangUp, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, headersTimeout);
    try {
      const response = await send(candidate.url, {
        method: 'POST',
        headers: upstreamHeaders(request.headers, dialect, candidate.key),
        body: JSON.stringify({ ...body, model: candidate.entry.id }),
        signal: controller.signal,
        // A redirect would carry the key to wherever it points.
        redirect: 'error',
      });
      return { kind: 'answered', response, controller };
    }
    catch (error) {
      if (timedOut) return { kind: 'failed', why: `no answer within ${String(headersTimeout / 1000)} s`, status: 504, retry: false };
      if (request.signal.aborted) return { kind: 'failed', why: 'left when the caller hung up', status: 502, retry: false };
      return { kind: 'failed', why: failureOf(error), status: 502, retry: true };
    }
    finally {
      clearTimeout(timer);
      // `streamed` listens for the hang-up itself from here on.
      request.signal.removeEventListener('abort', hangUp);
    }
  };

  /** A call: the caller, the body, the route, then each candidate until one answers. */
  const call = async (request: Request, dialect: Dialect): Promise<Response> => {
    const refuse = (refusal: Refusal, headers?: Record<string, string>): Response => refusalBody(dialect, refusal, headers);
    if (request.method !== 'POST') return refuse({ status: 405, message: `${new URL(request.url).pathname} takes POST` }, { allow: 'POST' });

    const called = await callerOf(request, options, 'proxy:write');
    if ('refusal' in called) return refuse(called.refusal);
    const caller = called.caller;

    const read = await bodyOf(request, maxBody);
    if ('refusal' in read) return refuse(read.refusal);
    const { body, model: name } = read;

    const proxy = options.proxy();
    const charged = chargedAs(caller, options, proxy);
    const allowed = policyFor(options, charged, name);
    const routed = await route(proxy, name, dialect, { ...(options.env === undefined ? {} : { env: options.env }), ...(allowed === undefined ? {} : { allowed }) });
    if ('refusal' in routed) return refuse(routed.refusal);

    const at = new Date().toISOString();
    const left: Left[] = [];
    const who = callerName(caller);
    const said = (end: string): void => {
      const tried = left.map((one) => `${one.provider} ${one.why}`).join(', ');
      say(`proxy: ${who} ${name}: ${tried === '' ? '' : `${tried}; `}${end}`);
    };

    for (const [index, candidate] of routed.candidates.entries()) {
      const last = index === routed.candidates.length - 1;
      const tried = await attempt(request, dialect, body, candidate);
      if (tried.kind === 'failed') {
        if (!last && tried.retry) {
          left.push({ provider: candidate.provider, why: tried.why });
          continue;
        }
        left.push({ provider: candidate.provider, why: tried.why });
        said(`answered ${String(tried.status)}`);
        const message = tried.status === 504
          ? `model ${name} on ${candidate.provider} sent no answer in time`
          : `model ${name} on ${candidate.provider} could not be reached`;
        return refuse({ status: tried.status, message });
      }
      const { response, controller } = tried;
      if (!last && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel().catch(() => undefined);
        left.push({ provider: candidate.provider, why: String(response.status) });
        continue;
      }
      if (response.status >= 400 || left.length > 0) said(`${candidate.provider} answered ${String(response.status)}`);
      return streamed(request, dialect, response, controller, (tokens) => {
        record(options, charged, { at, name, candidate, tokens });
      }, (why) => { say(`proxy: ${who} ${name}: ${candidate.provider} ${why}`); });
    }
    // Unreachable: a route answers at least one candidate.
    return refuse({ status: 502, message: `model ${name} could not be reached` });
  };

  /**
   * The answer as it came, its body read through on its way to the caller.
   *
   * One chunk is pulled from the provider each time the caller wants one, so
   * the caller's pace is the provider's and nothing is buffered. Each chunk is
   * shown to the usage reader and passed on. The idle timer runs only while
   * waiting on the provider; at its end the stream is closed, since the status
   * is already sent. A provider that fails mid-answer errors the stream, so
   * the caller's connection is cut rather than ended as if the answer were
   * whole. `done` is called once, however the stream ends.
   */
  const streamed = (
    request: Request,
    dialect: Dialect,
    response: Response,
    controller: AbortController,
    done: (tokens: Tokens) => void,
    cut: (why: string) => void,
  ): Response => {
    const usage = usageReader(dialect, response.headers.get('content-type'));
    const hangUp = (): void => { controller.abort(); };
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      request.signal.removeEventListener('abort', hangUp);
      done(usage.tokens());
    };
    const upstream = response.body;
    if (upstream === null) {
      finish();
      return new Response(null, { status: response.status, statusText: response.statusText, headers: returnedHeaders(response.headers) });
    }
    request.signal.addEventListener('abort', hangUp, { once: true });
    if (request.signal.aborted) controller.abort();
    const reader = upstream.getReader();
    let stalled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: async (out) => {
        const timer = setTimeout(() => { stalled = true; controller.abort(); }, idleTimeout);
        try {
          const { done: ended, value } = await reader.read();
          clearTimeout(timer);
          if (ended) {
            finish();
            out.close();
            return;
          }
          usage.read(value);
          out.enqueue(value);
        }
        catch (error) {
          clearTimeout(timer);
          const failed = !stalled && !request.signal.aborted;
          if (stalled) cut(`sent nothing for ${String(idleTimeout / 1000)} s; the answer was ended`);
          else if (failed) cut('ended its answer early');
          finish();
          try {
            if (failed) out.error(error);
            else out.close();
          }
          catch { /* the caller has gone */ }
        }
      },
      cancel: () => {
        controller.abort();
        finish();
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: returnedHeaders(response.headers) });
  };

  /** `GET /v1/models`: the names this caller could call now. */
  const models = async (request: Request): Promise<Response> => {
    const dialect = dialectOfHeaders(request.headers);
    if (request.method !== 'GET') return refusalBody(dialect, { status: 405, message: `${MODELS_PATH} takes GET` }, { allow: 'GET' });
    const called = await callerOf(request, options, 'proxy:read');
    if ('refusal' in called) return refusalBody(dialect, called.refusal);
    const proxy = options.proxy();
    const charged = chargedAs(called.caller, options, proxy);
    const names: string[] = [];
    for (const name of Object.keys(proxy.models)) {
      const allowed = policyFor(options, charged, name);
      for (const one of DIALECTS) {
        const routed = await route(proxy, name, one, { ...(options.env === undefined ? {} : { env: options.env }), ...(allowed === undefined ? {} : { allowed }) });
        if ('candidates' in routed) { names.push(name); break; }
      }
    }
    return new Response(`${JSON.stringify(modelList(dialect, names))}\n`, { status: 200, headers: { 'content-type': 'application/json' } });
  };

  return guarded(async (request, path) => {
    if (!isUnder(path, PROXY_PREFIX)) return options.otherwise(request);
    const dialect = dialectAt(path);
    const refused = refusedGuard(request);
    if (refused !== undefined) {
      return dialect === undefined && path !== MODELS_PATH
        ? json(403, { message: refused })
        : refusalBody(dialect ?? dialectOfHeaders(request.headers), { status: 403, message: refused });
    }
    if (dialect !== undefined) return call(request, dialect);
    if (path === MODELS_PATH) return models(request);
    return refusalBody('openai-chat', { status: 404, message: `Nothing is served at ${path}`, code: 'not_found' });
  });
}

/** What one answered call is recorded from. */
interface Answered {
  /** When the call was made. */
  at: string;
  /** The `<maker>/<name>` called. */
  name: string;
  /** The entry that answered. */
  candidate: Candidate;
  /** What its answer reported. */
  tokens: Tokens;
}

/**
 * One `ModelUse` with `source: 'proxy'`, charged to the caller's pools.
 *
 * A store that fails is a line in the log, never the caller's error: the
 * answer has already gone.
 */
const record = (options: ProxyOptions, charged: Charged, call: Answered): void => {
  if (!charged.recorded) return;
  const store = options.usage?.();
  if (store === undefined) return;
  const usd = costOf(call.candidate.entry, call.tokens);
  const session = charged.session;
  const entry: ModelUse = {
    at: call.at,
    kind: 'model',
    source: 'proxy',
    ...(charged.owner === undefined ? {} : { owner: charged.owner }),
    ...(charged.scope === undefined ? {} : { team: charged.scope.team, ...(charged.scope.project === undefined ? {} : { project: charged.scope.project }) }),
    ...(session === undefined ? {} : {
      session: session.session,
      ...(session.chat === undefined ? {} : { chat: session.chat }),
      ...(session.turn === undefined ? {} : { turn: session.turn }),
    }),
    model: { name: call.name, provider: call.candidate.provider, ...call.tokens },
    ...(usd === undefined ? {} : { cost: { amount: usd, currency: 'usd', from: 'price' as const } }),
    pools: poolsOf(charged.owner, charged.scope),
  };
  void Promise.resolve()
    .then(() => store.record(entry))
    .catch((error: unknown) => {
      options.onProblem?.(`proxy: could not keep the record of a call to ${call.name}: ${error instanceof Error ? error.message : String(error)}`);
    });
};

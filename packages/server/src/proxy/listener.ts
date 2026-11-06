/**
 * The model proxy, under `/v1` on the listener that carries `/api`.
 *
 * A person's own tool posts a chat completion or a message here with its ahpd
 * token, naming a model `<maker>/<name>`. The call is checked (the guard, the
 * caller, the body), routed to the first connector that can take it, and sent
 * there with that connector's own model id and key; the provider's answer
 * streams back as it came, SSE included, and nothing is translated.
 *
 * Every refusal is the caller's dialect's own error body, so a tool shows it
 * rather than failing to parse it. A connector's key is the one the connectors
 * channel resolved when it opened it, and it goes into the one upstream header
 * and nowhere else: not a refusal, not a log line, not a record.
 *
 * The model names are the configuration read when the daemon started. The open
 * connectors and their keys are read per call, a caller from the users file per
 * call, and each attempt is reported to the connector that served it.
 */

import type { RequestHandler } from '@cofold/remote';
import {
  chargeFor, countCall, decide, keyRowOf, type ConnectorModel, type ConnectorModels, type Cost, type MinuteMeter, type ModelPricing, type ModelUse, type Owner, type PayOrder, type Policies, type ProviderConnector,
  type ProviderModel, type Scope, type Usage, type Users,
} from '@ahpd/sdk';
import { foreign, guarded, isUnder, json, originRefusal, PROXY_PREFIX, type ApiOrigins } from '../http.js';
import { callerName, callerOf, type ProxyCaller, type SessionCaller } from './caller.js';
import { prefixOf, type ModelCatalog } from './catalog.js';
import {
  dialectAt, dialectOfHeaders, dialectRow, isRootPath, keyHeader, MODELS_PATH, modelList, refusalBody, ROOT_MODELS_PATH,
  upstreamFor, usageReader, type Refusal, type Tokens, type Units,
} from './dialects.js';
import { DIALECTS, type Dialect, type ModelEntry, type ModelPrice, type ProxyConfiguration } from './providers.js';
import { decodeResponseId, rewriteAnswer } from './responseids.js';
import { connectorForCaller, fetchedName, route, upstreamUrl, type Candidate } from './route.js';

/** How long a provider has to send its status and headers. A local model loading its weights is slow to start. */
export const HEADERS_TIMEOUT_MS = 120_000;

/** How long a provider may go between two chunks of its answer before the call is cut. */
export const IDLE_TIMEOUT_MS = 300_000;

/**
 * The largest request body a call may send, which is the request size Anthropic's API documents for its
 * Messages API, 128 MB.
 * https://platform.claude.com/docs/en/api/errors#request-size-limits
 */
export const MAX_BODY_BYTES = 128 * 1024 * 1024;

/** What the proxy is built from. */
export interface ProxyOptions {
  /** The model names, as read when the daemon started. */
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
  /** Which row of one scope pays first: `policies.payOrder`, `ending` unless said. */
  policiesPayOrder?: PayOrder;
  /** The zone the checked periods are cut in, which is the store's: `usage.timezone`. */
  usageTimezone?: string;
  /**
   * What each key used in this minute, the same one the store and the host were
   * given, so a `minute` limit on a call is read from the totals the records
   * fill and the calls count in.
   */
  meter?: MinuteMeter;
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
  /**
   * The open provider connectors, read per call, so a connector put or removed
   * while the daemon runs is used or left at once. The answer may hold a key.
   */
  providers(): readonly ProviderConnector[];
  /**
   * The lists the open connectors answered, read per call. Absent when the
   * host keeps none, and then a name outside the table has no price.
   */
  catalog?(): ModelCatalog | undefined;
  /**
   * Record one call's outcome for one connector, as the connectors channel
   * does: `ok` for a 2xx, and a failure with the status or the error.
   */
  note?(id: string, outcome: { ok: boolean; status?: number; error?: string }): void;
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

/** How the body a call sends is written, which decides its `content-type`. */
export type SentBody = 'json' | 'form' | 'none';

/** The headers a call goes upstream with: the caller's own, less this host's, plus the provider's key. */
export const upstreamHeaders = (from: Headers, dialect: Dialect, key: string | undefined, sent: SentBody = 'json'): Headers => {
  const out = new Headers();
  const named = connectionNamed(from);
  for (const [name, value] of from) {
    const lower = name.toLowerCase();
    if (NOT_SENT.has(lower) || HOP_BY_HOP.has(lower) || named.has(lower) || ACCOUNT.has(lower)) continue;
    if (lower.startsWith('x-ahp-') || lower.startsWith('x-forwarded-') || lower.startsWith('proxy-')) continue;
    out.append(name, value);
  }
  if (key !== undefined) out.set(...keyHeader(dialect, key));
  // A form's boundary is the new form's, which `fetch` sets; a body-less call
  // names no type at all.
  if (sent !== 'json') out.delete('content-type');
  else if (!out.has('content-type')) out.set('content-type', 'application/json');
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

/** A call's body once it is read: a JSON object or a form, and the model it names. */
interface JsonBody {
  kind: 'json';
  body: Record<string, unknown>;
  model: string;
}

/** A multipart body, with the model its form field names. */
interface FormBody {
  kind: 'form';
  form: FormData;
  model: string;
}

/** What one call sent. */
type CallBody = JsonBody | FormBody;

/** The body a caller sent, or the refusal for one too large or not a call. */
const bodyOf = async (request: Request, limit: number): Promise<CallBody | { refusal: Refusal }> => {
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
  const bytes = Buffer.concat(chunks);
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (type.startsWith('multipart/form-data')) {
    let form: FormData;
    try {
      form = await new Request('http://proxy.invalid/', {
        method: 'POST',
        headers: { 'content-type': request.headers.get('content-type') ?? '' },
        body: bytes,
      }).formData();
    }
    catch { return { refusal: { status: 400, message: 'The request body is not a form' } }; }
    const model = form.get('model');
    if (typeof model !== 'string' || model === '') {
      return { refusal: { status: 400, message: 'The request body names no model: set model to <maker>/<name>' } };
    }
    return { kind: 'form', form, model };
  }
  let body: unknown;
  try { body = JSON.parse(bytes.toString('utf8')); }
  catch { return { refusal: { status: 400, message: 'The request body is not JSON' } }; }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { refusal: { status: 400, message: 'The request body is not a JSON object' } };
  }
  const model = (body as Record<string, unknown>)['model'];
  if (typeof model !== 'string' || model === '') {
    return { refusal: { status: 400, message: 'The request body names no model: set model to <maker>/<name>' } };
  }
  return { kind: 'json', body: body as Record<string, unknown>, model };
};

/** The same form with the provider's model id set, so the caller's fields and files are sent unchanged. */
const formBody = (from: FormData, model: string): FormData => {
  const form = new FormData();
  for (const [name, value] of from) form.append(name, value);
  form.set('model', model);
  return form;
};

/** The system's error code behind a failed fetch, when it gave one. */
const codeOf = (error: unknown): string | undefined => {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  return typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : undefined;
};

/** Why a fetch failed, as words that hold no URL and no header: the system's error code when it gave one. */
const failureOf = (error: unknown): string => {
  const code = codeOf(error);
  return code === undefined ? 'unreachable' : `unreachable (${code})`;
};

/**
 * The failures that mean the provider never received the call.
 *
 * A connection refused, a name that does not resolve, a host or network that
 * is not reachable, a connect that timed out: nothing was sent, so trying the
 * next candidate sends the call once.
 *
 * Every other failure is one the provider may have received - a socket reset
 * after the body was read, an answer that never came - and asking the next
 * candidate too would spend the call twice. `UND_ERR_CONNECT_TIMEOUT` is
 * undici's, the client `fetch` uses; the rest are the system's own.
 */
const NEVER_ARRIVED = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * The pools one record is charged to: the owner, the team and the project,
 * each only when the record has it, then the keys the check chose. The same
 * spelling the agent meter charges under, and a name already given is added
 * once: a team key's owner is `team:<team>`, which is the team pool too, and
 * a charge adds to every pool it is given.
 */
const poolsOf = (owner: Owner | undefined, scope: Scope | undefined, keys?: readonly string[]): string[] => [
  ...new Set([
    ...(owner === undefined ? [] : [owner]),
    ...(scope === undefined ? [] : [`team:${scope.team}`]),
    ...(scope?.project === undefined ? [] : [`project:${scope.team}:${scope.project}`]),
    ...(keys ?? []),
  ]),
];

/**
 * The zone `usage.timezone` names, or the system's own when it is absent or
 * cannot be read.
 *
 * The usage store cuts its days in this zone, so a walked period reads the days
 * the store kept. An unreadable name is said by the store itself at startup,
 * and the system's zone is what both fall back to.
 */
const zoneOf = (wanted: string | undefined): string => {
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (wanted === undefined || wanted.trim() === '') return here;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: wanted }).format(new Date());
    return wanted;
  }
  catch {
    return here;
  }
};

/**
 * What a call costs by the entry's price.
 *
 * Tokens are priced per million, cache reads and writes at the input price
 * until there are cache prices, so the figure is never under what the call
 * could have cost. A speech call is priced per million characters of its input,
 * and a transcription by its minutes of audio when it reports seconds.
 *
 * Nothing when the entry has no price or the answer reported nothing to charge,
 * and nothing when what was reported has no price: a side priced at nothing is
 * free, a side with no price at all is not priced.
 */
const costOf = (entry: ModelEntry, tokens: Tokens, units: Units = {}): Cost | undefined => {
  const price = entry.price;
  if (price === undefined) return undefined;
  const read = tokens.input !== undefined || tokens.output !== undefined || tokens.cache !== undefined;
  if (read) {
    const prompt = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
    const answer = tokens.output ?? 0;
    if ((prompt > 0 && price.input === undefined) || (answer > 0 && price.output === undefined)) return undefined;
    const input = (prompt * (price.input ?? 0)) / 1_000_000;
    const output = (answer * (price.output ?? 0)) / 1_000_000;
    return { amount: input + output, currency: 'usd', from: 'price', input, output };
  }
  const characters = units.characters ?? 0;
  if (characters > 0) {
    if (price.characters === undefined) return undefined;
    const amount = (characters * price.characters) / 1_000_000;
    return { amount, currency: 'usd', from: 'price', input: amount, output: 0 };
  }
  const seconds = units.seconds ?? 0;
  if (seconds > 0) {
    if (price.minutes === undefined) return undefined;
    const amount = (seconds / 60) * price.minutes;
    return { amount, currency: 'usd', from: 'price', input: amount, output: 0 };
  }
  return undefined;
};

/**
 * A price written per million tokens as OpenRouter writes one: dollars per
 * token, as a string, never in exponent form.
 *
 * Nine places reaches below a thousandth of a cent per million tokens, which
 * is finer than any price the file can usefully hold.
 */
const perToken = (value: number): string => {
  const token = value / 1_000_000;
  return token === 0 ? '0' : token.toFixed(9).replace(/0+$/u, '');
};

/** A file price as the list writes it, or nothing when the entry prices neither side. */
const priced = (price: ModelPrice): ModelPricing | undefined => {
  const prompt = price.input === undefined ? undefined : perToken(price.input);
  const completion = price.output === undefined ? undefined : perToken(price.output);
  if (prompt === undefined && completion === undefined) return undefined;
  return { ...(prompt === undefined ? {} : { prompt }), ...(completion === undefined ? {} : { completion }) };
};

/** How much of a provider's refusal is read for the log: enough for its sentence, not its whole body. */
const REFUSAL_HELD = 4 * 1024;

/** Up to `limit` characters of an answer's body, the rest cancelled: a body nobody is going to read is not left arriving. */
const bodyBound = async (response: Response, limit: number): Promise<string> => {
  const body = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let held = '';
  try {
    while (held.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      held += decoder.decode(value, { stream: true });
    }
  }
  catch { /* what was read is what there is */ }
  finally { await reader.cancel().catch(() => undefined); }
  return held.slice(0, limit);
};

/** One line of text, so what a provider said cannot break the log line it is written on. */
const oneLine = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** What a key-shaped run of text reads as once it is out of the log line. */
const REDACTED = '[redacted]';

/** The shortest value worth matching whole: anything less is a word, and replacing it would eat the sentence. */
const SHORTEST_KEY = 8;

/**
 * A provider's words with anything key-shaped taken out.
 *
 * A refusal's sentence is about the key this host called with and often quotes
 * it. The line is written to the daemon's log, which lives on disk and is
 * carried off the machine with a bug report, so the key does not go in it.
 * Four shapes come out: the value this host called the provider with, an
 * `sk-`-prefixed value, a `Bearer` value, and a long run of token characters
 * after the word `key`. A shape that is not matched is a sentence that stays
 * whole; a sentence that is, says less than it did, which is the way round
 * this has to err.
 */
const redact = (text: string, keys: readonly string[]): string => {
  let out = text;
  for (const key of keys) {
    if (key.length >= SHORTEST_KEY) out = out.split(key).join(REDACTED);
  }
  return out
    .replace(/sk-[A-Za-z0-9_-]+/gu, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/giu, `Bearer ${REDACTED}`)
    .replace(/(key\b[^\p{L}\p{N}]{0,4})[A-Za-z0-9_-]{20,}/giu, `$1${REDACTED}`);
};

/**
 * The provider's own words about a refusal, for the log.
 *
 * The caller is shown this host's sentence rather than the provider's, so the
 * body is wanted only by whoever reads the daemon's log - and it is a
 * provider's, which may be anything at all. At most `REFUSAL_HELD` of it is
 * read and the rest cancelled. A JSON body's `error.message` is used when it
 * has one, since that is where both dialects put their sentence; anything else
 * is the body itself, on one line. What comes out is redacted against `keys`,
 * the values this call was made with.
 */
const refusalWords = async (response: Response, keys: readonly string[]): Promise<string> => {
  const held = await bodyBound(response, REFUSAL_HELD);
  try {
    const parsed = JSON.parse(held) as { error?: unknown; message?: unknown };
    const error = parsed?.error;
    const message = typeof error === 'string' ? error
      : typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : typeof parsed?.message === 'string' ? parsed.message : undefined;
    if (message !== undefined) return redact(oneLine(message), keys);
  }
  catch { /* not JSON: the body's own words are what there is */ }
  return redact(oneLine(held), keys);
};

/** One call's caller, as what a policy checks and a record carries. */
interface Charged {
  /** Whose policies are asked, or nothing: root, a host with no directory, a session for nobody. */
  principal?: Parameters<typeof decide>[1];
  /** The team and project. */
  scope?: Scope;
  /** The id of the key that made the call, when the person signed in with one. */
  token?: string;
  /** What the key and the call said about themselves. */
  meta?: Record<string, string>;
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
      ...(caller.principal.token === undefined ? {} : { token: caller.principal.token }),
      ...(caller.meta === undefined ? {} : { meta: caller.meta }),
      // A team key is charged to the team it is, never to a person.
      owner: caller.principal.team === undefined ? `user:${caller.principal.id}` : `team:${caller.principal.team}`,
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

/** What the checking of one candidate entry answers, and what its record carries. */
interface EntryCheck {
  /** Why the entry is refused, or nothing when it may be called. */
  allowed(entry: ModelEntry): Promise<string | undefined>;
  /** The keys that entry's record is charged under, once it was allowed. */
  keysOf(entry: ModelEntry): string[] | undefined;
}

/**
 * The policy a route is held to for one caller and one name, or nothing.
 *
 * With the checks on, a store and a person behind the call. A store that cannot
 * be read refuses, as the host's own check does: a check that failed open is
 * not a check.
 *
 * With the checks off, a key's own limits still hold: they are on the key rather
 * than in the store, so the decision is the key's row alone and the walk is the
 * same one. A host with neither a store nor a key with limits checks nothing and
 * answers nothing here.
 *
 * After an allowed decision the entry is walked for room, the same way a turn
 * is, and a row with no room refuses the entry with its sentence. The keys the
 * walk chose are kept for the entry, because the record is written for the
 * candidate that answered rather than for the name. With no usage store there
 * is no total to read, so no key is chosen and nothing is refused on a limit.
 * The walk counts nothing: the request counts its `calls` key once, on the
 * candidate it sends to, so a name served by two entries is one call. A listing
 * passes `zone` as `undefined`: it asks only whether the policy allows the
 * name, so a model at its limit stays listed and its call is refused.
 */
const policyFor = (options: ProxyOptions, charged: Charged, name: string, zone: string | undefined): EntryCheck | undefined => {
  const store = options.policies;
  const principal = charged.principal;
  if (principal === undefined) return undefined;
  const checking = options.policiesCheck === true && store !== undefined;
  // The key's row is added to an allowed decision by `decide` when the checks
  // are on, so it is walked alone only when the store is not read at all.
  const alone = checking ? undefined : keyRowOf(principal);
  if (!checking && alone === undefined) return undefined;
  const kept = new Map<ModelEntry, string[]>();
  const allowed = async (entry: ModelEntry): Promise<string | undefined> => {
    try {
      let decision: Awaited<ReturnType<typeof decide>>;
      if (checking && store !== undefined) {
        decision = await decide(store, principal, charged.scope, 'model', { model: name, proxy: entry.provider });
      }
      else if (alone !== undefined) {
        decision = { allowed: true, candidates: [alone] };
      }
      else {
        return undefined;
      }
      if (!decision.allowed) return decision.refusal.message;
      const usage = options.usage?.();
      if (usage === undefined || zone === undefined) return undefined;
      const walked = await chargeFor(decision, 'model', principal, charged.scope, usage, {
        zone,
        ...(options.policiesPayOrder === undefined ? {} : { payOrder: options.policiesPayOrder }),
        ...(options.meter === undefined ? {} : { meter: options.meter }),
      });
      if (!walked.allowed) return walked.refusal.message;
      kept.set(entry, walked.pools);
      return undefined;
    }
    catch (error) {
      return `no policy could be read, so model is refused: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  return { allowed, keysOf: (entry) => kept.get(entry) };
};

/** Why one candidate was left, for the log. */
type Left = { connector: string; why: string };

/** What one attempt at a candidate came to. */
type Attempt =
  | { kind: 'answered'; response: Response; controller: AbortController }
  /** `sent` is false when the caller had hung up and no request went out. */
  | { kind: 'failed'; why: string; status: 502 | 504; retry: boolean; sent: boolean };

/**
 * The proxy, as the request handler a listener carries.
 *
 * A path under `/v1` is the proxy's: a call at `/v1/chat/completions` or
 * `/v1/messages`, the list at `/v1/models`, and a 404 in OpenAI's body for any
 * other. Everything else is `otherwise`'s.
 */
/** The first candidate of a name for one caller, in either dialect, or nothing when it is refused or serves nobody. */
const firstCandidate = async (
  options: ProxyOptions,
  proxy: ProxyConfiguration,
  caller: ProxyCaller,
  charged: Charged,
  open: readonly ProviderConnector[],
  catalog: ModelCatalog | undefined,
  name: string,
): Promise<Candidate | undefined> => {
  const check = policyFor(options, charged, name, undefined);
  for (const one of DIALECTS) {
    const routed = await route(proxy, name, one, {
      providers: open,
      caller,
      ...(catalog === undefined ? {} : { catalog }),
      ...(check === undefined ? {} : { allowed: check.allowed }),
    });
    if ('candidates' in routed) return routed.candidates[0];
  }
  return undefined;
};

/**
 * The models one provider connector serves, as the catalog last read them, for
 * one caller: the name each is called by, and whether that caller may call it
 * now. A connector the catalog has not read is read first.
 *
 * `callable` is asked the way `GET /v1/models` asks it, through the routes and
 * the policies, so the two never disagree.
 */
export const connectorModels = async (options: ProxyOptions, connector: ProviderConnector, caller: ProxyCaller): Promise<ConnectorModels> => {
  const catalog = options.catalog?.();
  if (catalog === undefined) return { models: [] };
  await catalog.refresh();
  const kept = catalog.listOf(connector);
  if (kept === undefined) return { models: [] };
  const proxy = options.proxy();
  const charged = chargedAs(caller, options, proxy);
  const open = options.providers();
  const prefix = prefixOf(connector);
  const models: ConnectorModel[] = [];
  for (const one of kept.models) {
    const model = `${prefix}/${one.id}`;
    const callable = await firstCandidate(options, proxy, caller, charged, open, catalog, model) !== undefined;
    models.push({ ...one, model, callable });
  }
  return { models, at: new Date(kept.at).toISOString() };
};

export function proxyHandler(options: ProxyOptions): RequestHandler {
  const say = (line: string): void => { options.onProblem?.(line); };
  // One zone for every check, read once because it does not move while the
  // daemon runs and the store cuts its days in it.
  const zone = zoneOf(options.usageTimezone);
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
   * headers in time is not retried, since it may be doing the work - and one
   * whose socket dropped after it read the call is not either, because it
   * received the call. Only a failure in `NEVER_ARRIVED` is retried, which is
   * why `retry` is set from the error's code and not from the failure.
   */
  const attempt = async (request: Request, dialect: Dialect, call: CallBody, candidate: Candidate): Promise<Attempt> => {
    if (request.signal.aborted) return { kind: 'failed', why: 'not tried, the caller hung up', status: 502, retry: false, sent: false };
    const controller = new AbortController();
    const hangUp = (): void => { controller.abort(); };
    request.signal.addEventListener('abort', hangUp, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, headersTimeout);
    try {
      const sent = call.kind === 'form' ? 'form' : 'json';
      const body = call.kind === 'form'
        ? formBody(call.form, candidate.entry.id)
        : JSON.stringify({ ...call.body, model: candidate.entry.id });
      const response = await send(candidate.url, {
        method: 'POST',
        headers: upstreamHeaders(request.headers, dialect, candidate.key, sent),
        body,
        signal: controller.signal,
        // A redirect would carry the key to wherever it points.
        redirect: 'error',
      });
      return { kind: 'answered', response, controller };
    }
    catch (error) {
      if (timedOut) return { kind: 'failed', why: `no answer within ${String(headersTimeout / 1000)} s`, status: 504, retry: false, sent: true };
      if (request.signal.aborted) return { kind: 'failed', why: 'left when the caller hung up', status: 502, retry: false, sent: true };
      const code = codeOf(error);
      return { kind: 'failed', why: failureOf(error), status: 502, retry: code !== undefined && NEVER_ARRIVED.has(code), sent: true };
    }
    finally {
      clearTimeout(timer);
      // `streamed` listens for the hang-up itself from here on.
      request.signal.removeEventListener('abort', hangUp);
    }
  };

  /** What a follow-up for an id that is not the caller's answers, whether it was forged or belongs to somebody else. */
  const NO_SUCH_RESPONSE: Refusal = { status: 404, message: 'No such response', code: 'not_found' };

  /**
   * The entry one connector serves a name under, when a route did not name it.
   *
   * A Responses follow-up names its connector, so the model it was made with
   * has to be read from the table or from a fetched `<prefix>/<id>`. Nothing
   * when that connector serves neither spelling of the name.
   */
  const entryFor = (
    proxy: ProxyConfiguration,
    name: string,
    connector: ProviderConnector,
    catalog?: ModelCatalog,
  ): ModelEntry | undefined => {
    const written = proxy.models[name] ?? [];
    const byTable = written.find((entry) => entry.provider === connector.id || entry.provider === connector.adapter);
    if (byTable !== undefined) return byTable;
    const fetched = fetchedName(name);
    if (fetched === undefined || prefixOf(connector) !== fetched.prefix) return undefined;
    const price = catalog?.priceOf(connector, fetched.id);
    return { provider: connector.adapter, id: fetched.id, ...(price === undefined ? {} : { price }) };
  };

  /** A call: the caller, the body, the route, then each candidate until one answers. */
  const call = async (request: Request, dialect: Dialect, callerPath: string): Promise<Response> => {
    const refuse = (refusal: Refusal, headers?: Record<string, string>): Response => refusalBody(dialect, refusal, headers);
    if (request.method !== 'POST') return refuse({ status: 405, message: `${new URL(request.url).pathname} takes POST` }, { allow: 'POST' });

    const called = await callerOf(request, options, 'proxy:call');
    if ('refusal' in called) return refuse(called.refusal);
    const caller = called.caller;

    const read = await bodyOf(request, maxBody);
    if ('refusal' in read) return refuse(read.refusal);
    const name = read.model;

    const proxy = options.proxy();
    const charged = chargedAs(caller, options, proxy);
    const check = policyFor(options, charged, name, zone);
    const catalog = options.catalog?.();
    const providers = options.providers();
    let routed = await route(proxy, name, dialect, {
      providers,
      caller,
      callerPath,
      ...(catalog === undefined ? {} : { catalog }),
      ...(check === undefined ? {} : { allowed: check.allowed }),
    });

    /*
     * A create that continues a response carries its connector in the id, and
     * the state is at that provider only: the call is pinned to it, with no
     * fallback, and the provider's own id goes out in place of the proxy's.
     */
    if (dialect === 'openai-responses' && read.kind === 'json' && typeof read.body['previous_response_id'] === 'string') {
      const decoded = decodeResponseId(read.body['previous_response_id']);
      if (decoded === undefined) return refuse(NO_SUCH_RESPONSE);
      const connector = connectorForCaller(decoded.connector, providers, caller);
      if (connector === undefined || !connector.provider.accepts.includes('openai-responses')) return refuse(NO_SUCH_RESPONSE);
      const matched = 'candidates' in routed ? routed.candidates.find((one) => one.connector === connector.id) : undefined;
      const entry = matched?.entry ?? entryFor(proxy, name, connector, catalog);
      if (entry === undefined) return refuse(NO_SUCH_RESPONSE);
      if (matched === undefined && check !== undefined) {
        const refused = await check.allowed(entry);
        if (refused !== undefined) return refuse({ status: 403, message: refused });
      }
      const model = catalog?.modelOf(connector, entry.id);
      routed = {
        candidates: [{
          connector: connector.id,
          provider: connector.adapter,
          entry,
          url: upstreamUrl(connector.provider.endpoint, dialect, callerPath, connector.provider.paths),
          ...(connector.provider.key === undefined ? {} : { key: connector.provider.key }),
          ...(model === undefined ? {} : { model }),
        }],
      };
      read.body['previous_response_id'] = decoded.id;
    }
    if ('refusal' in routed) return refuse(routed.refusal);

    const row = dialectRow(dialect);
    const characters = dialect === 'openai-speech' && read.kind === 'json' && typeof read.body['input'] === 'string'
      ? read.body['input'].length
      : undefined;
    const at = new Date().toISOString();
    const left: Left[] = [];
    const who = callerName(caller);
    const said = (end: string): void => {
      const tried = left.map((one) => `${one.connector} ${one.why}`).join(', ');
      say(`proxy: ${who} ${name}: ${tried === '' ? '' : `${tried}; `}${end}`);
    };
    /** Keep one attempt in the connector's health, as the connectors channel keeps it. */
    const noted = (connector: string, outcome: { ok: boolean; status?: number; error?: string }): void => {
      options.note?.(connector, outcome);
    };

    /*
     * One request is one call, however many entries and candidates the policy
     * walk judged, so the `calls` figure is counted once, on the keys of the
     * candidate the request is sent to first. A fallback to the next candidate
     * is the same call, and a candidate the walk kept no keys for counts
     * nothing.
     */
    let counted = false;
    for (const [index, candidate] of routed.candidates.entries()) {
      const last = index === routed.candidates.length - 1;
      if (!counted) {
        counted = true;
        if (check !== undefined) countCall(check.keysOf(candidate.entry) ?? [], options.meter);
      }
      const tried = await attempt(request, dialect, read, candidate);
      if (tried.kind === 'failed') {
        // A call that never went out is not the connector's failure.
        if (tried.sent) noted(candidate.connector, { ok: false, error: tried.why });
        left.push({ connector: candidate.connector, why: tried.why });
        if (!last && tried.retry) continue;
        said(`answered ${String(tried.status)}`);
        const message = tried.status === 504
          ? `model ${name} on ${candidate.connector} sent no answer in time`
          : `model ${name} on ${candidate.connector} could not be reached`;
        return refuse({ status: tried.status, message });
      }
      const { response, controller } = tried;
      noted(candidate.connector, { ok: response.ok, status: response.status });
      /*
       * A provider's 401 or 403 is about the key this host called it with and
       * not the credential the caller arrived with, so it is not streamed back
       * as it came: a client that read a 401 would ask its person to sign in
       * again over the host's key, and the body can name the host's account. The
       * caller gets this host's own error, and the provider's status and words
       * go to the log, with anything key-shaped redacted out of it.
       *
       * Not tried elsewhere either: a key refusal is this host's own
       * configuration, and the caller is told so with this host's error, not
       * sent to another provider to be refused again - the loop retries only
       * a connection that never arrived, a 429 and a 5xx.
       *
       * That is `modelProxy.keyRefusal` at `hostError`, the default. At
       * `passthrough` the provider's status and error reach the caller as they
       * came, as VS Code's Claude proxy re-emits an upstream error verbatim
       * (src/vs/platform/agentHost/node/claude/anthropicErrors.ts L16-L18,
       * L48-L61 at 6b68d3fe).
       */
      if ((response.status === 401 || response.status === 403) && proxy.keyRefusal === 'hostError') {
        const words = await refusalWords(response, candidate.key === undefined ? [] : [candidate.key]);
        left.push({
          connector: candidate.connector,
          why: words === '' ? String(response.status) : `${String(response.status)} ${words}`,
        });
        said('answered 502');
        return refuse({ status: 502, message: `model ${name} on ${candidate.connector} refused this host's key` });
      }
      if (!last && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel().catch(() => undefined);
        left.push({ connector: candidate.connector, why: String(response.status) });
        continue;
      }
      if (response.status >= 400 || left.length > 0) said(`${candidate.connector} answered ${String(response.status)}`);
      const answer = dialect === 'openai-responses' ? await rewriteAnswer(response, candidate.connector) : response;
      return streamed(request, dialect, answer, controller, (tokens, providerCost, units) => {
        if (row.record === false) return;
        const pools = check?.keysOf(candidate.entry);
        record(options, charged, {
          at, name, candidate, tokens,
          ...(characters === undefined ? {} : { characters }),
          ...(units.seconds === undefined ? {} : { seconds: units.seconds }),
          ...(providerCost === undefined ? {} : { providerCost }),
          ...(pools === undefined ? {} : { pools }),
        });
      }, (why) => { say(`proxy: ${who} ${name}: ${candidate.connector} ${why}`); });
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
    done: (tokens: Tokens, providerCost: Cost | undefined, units: Units) => void,
    cut: (why: string) => void,
  ): Response => {
    const usage = usageReader(dialect, response.headers.get('content-type'));
    const hangUp = (): void => { controller.abort(); };
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      request.signal.removeEventListener('abort', hangUp);
      done(usage.tokens(), usage.cost(), usage.units());
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

  /** One Responses follow-up: the id it names and the operation after it. */
  interface FollowUp {
    /** The proxy id, encoded as the caller sees it. */
    id: string;
    /** The operation, which is empty on a plain response. */
    suffix: '' | '/cancel' | '/input_items';
  }

  /**
   * The follow-up a path names, or nothing when it is not one.
   *
   * The create paths are exact rows and are answered before this, so only an
   * id, or an id and `/cancel` or `/input_items`, reaches here.
   */
  const followUpAt = (path: string): FollowUp | undefined => {
    const match = /^(?:\/v1)?\/responses\/([^/]+)(\/cancel|\/input_items)?$/u.exec(path);
    if (match === null || match[1] === undefined) return undefined;
    try {
      return { id: decodeURIComponent(match[1]), suffix: (match[2] ?? '') as FollowUp['suffix'] };
    }
    catch {
      return undefined;
    }
  };

  /**
   * One follow-up, sent to the connector its id names.
   *
   * The id is decoded here, and the connector is used only when it is open and
   * the caller may use it. Any other id is the same 404, so a forged id and
   * another person's id say the same thing. There is no fallback: the state is
   * at that provider only.
   */
  const follow = async (request: Request, followUp: FollowUp): Promise<Response> => {
    const refuse = (refusal: Refusal, headers?: Record<string, string>): Response =>
      refusalBody('openai-responses', refusal, headers);
    const allow = followUp.suffix === '/cancel' ? 'POST' : followUp.suffix === '/input_items' ? 'GET' : 'GET, DELETE';
    const allowed = followUp.suffix === '/cancel'
      ? request.method === 'POST'
      : followUp.suffix === '/input_items'
        ? request.method === 'GET'
        : request.method === 'GET' || request.method === 'DELETE';
    if (!allowed) {
      return refuse({ status: 405, message: `${new URL(request.url).pathname} takes ${allow}` }, { allow });
    }

    const called = await callerOf(request, options, 'proxy:call');
    if ('refusal' in called) return refuse(called.refusal);
    const decoded = decodeResponseId(followUp.id);
    if (decoded === undefined) return refuse(NO_SUCH_RESPONSE);
    const connector = connectorForCaller(decoded.connector, options.providers(), called.caller);
    if (connector === undefined || !connector.provider.accepts.includes('openai-responses')) return refuse(NO_SUCH_RESPONSE);

    const base = upstreamFor('openai-responses', '/responses', connector.provider.paths);
    const url = `${connector.provider.endpoint.replace(/\/+$/u, '')}${base}/${encodeURIComponent(decoded.id)}${followUp.suffix}`;
    const controller = new AbortController();
    const hangUp = (): void => { controller.abort(); };
    request.signal.addEventListener('abort', hangUp, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, headersTimeout);
    let response: Response;
    try {
      response = await send(url, {
        method: request.method,
        headers: upstreamHeaders(request.headers, 'openai-responses', connector.provider.key, 'none'),
        signal: controller.signal,
        redirect: 'error',
      });
    }
    catch (error) {
      if (timedOut) return refuse({ status: 504, message: 'the provider sent no answer in time' });
      if (request.signal.aborted) return refuse({ status: 502, message: 'the call was left before the provider answered' });
      return refuse({ status: 502, message: `the provider could not be reached (${failureOf(error)})` });
    }
    finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', hangUp);
    }

    options.note?.(connector.id, { ok: response.ok, status: response.status });
    if (response.status === 401 || response.status === 403) {
      await refusalWords(response, connector.provider.key === undefined ? [] : [connector.provider.key]);
      return refuse({ status: 502, message: `the connector ${connector.id} refused this host's key` });
    }
    const answer = await rewriteAnswer(response, connector.id);
    return streamed(request, 'openai-responses', answer, controller, () => undefined, (why) => {
      say(`proxy: ${connector.id} ${why}`);
    });
  };

  /** `GET /v1/models` and `GET /models`: the names this caller could call now. */
  const models = async (request: Request, path: string): Promise<Response> => {
    const dialect = dialectOfHeaders(request.headers);
    if (request.method !== 'GET') return refusalBody(dialect, { status: 405, message: `${path} takes GET` }, { allow: 'GET' });
    const called = await callerOf(request, options, 'proxy:models');
    if ('refusal' in called) return refusalBody(dialect, called.refusal);
    const proxy = options.proxy();
    const charged = chargedAs(called.caller, options, proxy);
    const open = options.providers();
    const catalog = options.catalog?.();
    // A connector that opened since the last read is read now, so the names
    // listed are never an hour behind the connectors that serve them.
    await catalog?.refresh();

    const first = (name: string): Promise<Candidate | undefined> =>
      firstCandidate(options, proxy, called.caller, charged, open, catalog, name);
    /**
     * One entry of the list: the name a caller calls, and the fields the first
     * connector it routes to knows. A price in the file is written here as
     * OpenRouter writes one, per token.
     */
    const entryOf = (name: string, candidate: Candidate, filePrice?: ModelPrice): ProviderModel => {
      const model = candidate.model;
      const pricing = filePrice === undefined ? model?.pricing : priced(filePrice);
      return {
        id: name,
        ...(model?.name === undefined ? {} : { name: model.name }),
        ...(model?.context_length === undefined ? {} : { context_length: model.context_length }),
        ...(pricing === undefined ? {} : { pricing }),
      };
    };

    const listed: ProviderModel[] = [];
    for (const name of Object.keys(proxy.models)) {
      const candidate = await first(name);
      if (candidate === undefined) continue;
      listed.push(entryOf(name, candidate, candidate.entry.price));
    }
    const fetched = new Set<string>();
    for (const row of catalog?.listed() ?? []) {
      for (const model of row.models) {
        const name = `${prefixOf(row.connector)}/${model.id}`;
        // A name the file holds is listed from the file, however the provider spells it.
        if (Object.hasOwn(proxy.models, name)) continue;
        fetched.add(name);
      }
    }
    for (const name of [...fetched].sort((one, two) => one.localeCompare(two))) {
      const candidate = await first(name);
      if (candidate === undefined) continue;
      listed.push(entryOf(name, candidate));
    }
    return new Response(`${JSON.stringify(modelList(dialect, listed))}\n`, { status: 200, headers: { 'content-type': 'application/json' } });
  };

  return guarded(async (request, path) => {
    if (!isUnder(path, PROXY_PREFIX) && !isRootPath(path)) return options.otherwise(request);
    const dialect = dialectAt(path);
    const followUp = dialect === undefined ? followUpAt(path) : undefined;
    const refusalDialect = dialect ?? (followUp === undefined ? undefined : 'openai-responses');
    const refused = refusedGuard(request);
    if (refused !== undefined) {
      return refusalDialect === undefined && path !== MODELS_PATH && path !== ROOT_MODELS_PATH
        ? json(403, { message: refused })
        : refusalBody(refusalDialect ?? dialectOfHeaders(request.headers), { status: 403, message: refused });
    }
    if (dialect !== undefined) return call(request, dialect, path);
    if (followUp !== undefined) return follow(request, followUp);
    if (path === MODELS_PATH || path === ROOT_MODELS_PATH) return models(request, path);
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
  /** Characters of a speech input, when the call is speech. */
  characters?: number;
  /** Seconds of audio a transcription reported, when it did. */
  seconds?: number;
  /** The cost its answer reported, when the provider gave one. */
  providerCost?: Cost;
  /** The policy keys the check chose for this entry, when it was charged. */
  pools?: string[];
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
  const provider = call.providerCost;
  // The entry's price is what the pools are charged, so it wins; a call no
  // price names is charged what the provider said it cost.
  const cost = costOf(call.candidate.entry, call.tokens, {
    ...(call.characters === undefined ? {} : { characters: call.characters }),
    ...(call.seconds === undefined ? {} : { seconds: call.seconds }),
  }) ?? provider;
  const session = charged.session;
  const entry: ModelUse = {
    at: call.at,
    kind: 'model',
    source: 'proxy',
    ...(charged.owner === undefined ? {} : { owner: charged.owner }),
    ...(charged.token === undefined ? {} : { token: charged.token }),
    ...(charged.meta === undefined ? {} : { meta: charged.meta }),
    ...(charged.scope === undefined ? {} : { team: charged.scope.team, ...(charged.scope.project === undefined ? {} : { project: charged.scope.project }) }),
    ...(session === undefined ? {} : {
      session: session.session,
      ...(session.chat === undefined ? {} : { chat: session.chat }),
      ...(session.turn === undefined ? {} : { turn: session.turn }),
    }),
    model: { name: call.name, provider: call.candidate.provider, connector: call.candidate.connector, ...call.tokens },
    ...(cost === undefined ? {} : { cost }),
    ...(provider === undefined ? {} : { providerCost: provider }),
    pools: poolsOf(charged.owner, charged.scope, call.pools),
  };
  void Promise.resolve()
    .then(() => store.record(entry))
    .catch((error: unknown) => {
      options.onProblem?.(`proxy: could not keep the record of a call to ${call.name}: ${error instanceof Error ? error.message : String(error)}`);
    });
};

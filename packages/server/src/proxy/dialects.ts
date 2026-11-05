/**
 * What each dialect the proxy serves looks like on the wire.
 *
 * A caller's tool speaks one API, OpenAI's chat completions, OpenAI's
 * embeddings or Anthropic's messages, and reads every answer in that API's
 * shape: a refusal that is not the dialect's own error body is a parse failure
 * in the tool rather than a message the person reads. So the paths, the error
 * bodies, the header a key goes in, the usage an answer reports and the models
 * list are all here, by dialect, and the listener asks this file rather than
 * knowing either API.
 */

import { isRecord, type Cost, type ModelProvider, type ProviderModel } from '@ahpd/sdk';
import type { Dialect } from './providers.js';

/** The wire family a dialect speaks, which picks its error body and its key header. */
export type DialectFamily = 'openai' | 'anthropic';

/** The kind of call a dialect makes, which the 404 hint keeps to. */
export type DialectKind = 'chat' | 'count' | 'embeddings' | 'responses' | 'images' | 'audio' | 'rerank';

/** What a usage reader looks for in an answer. */
export type UsageKind = 'openai' | 'anthropic' | 'responses' | 'images' | 'audio' | 'rerank' | 'none';

/** One dialect's row: where a caller posts, where it goes, and how it is read. */
export interface DialectRow {
  /** Every path a caller posts to, in the order a refusal names one. */
  caller: readonly string[];
  /** The path joined onto a provider's endpoint, or one path per caller path. */
  upstream: string | Readonly<Record<string, string>>;
  /** The wire family, which picks the error body and the key header. */
  family: DialectFamily;
  /** The kind of call, which the 404 hint keeps to. */
  kind: DialectKind;
  /** What the answer's usage looks like. */
  usage: UsageKind;
  /** Whether an answered call is recorded; a count costs nothing and is not. */
  record?: false;
}

/** The dialect rows, one per API the proxy serves. */
export const DIALECT_ROWS: Readonly<Record<Dialect, DialectRow>> = {
  'openai-chat': {
    caller: ['/v1/chat/completions', '/chat/completions'],
    upstream: '/chat/completions',
    family: 'openai',
    kind: 'chat',
    usage: 'openai',
  },
  'anthropic-messages': {
    caller: ['/v1/messages'],
    upstream: '/v1/messages',
    family: 'anthropic',
    kind: 'chat',
    usage: 'anthropic',
  },
  'anthropic-count-tokens': {
    caller: ['/v1/messages/count_tokens'],
    upstream: '/v1/messages/count_tokens',
    family: 'anthropic',
    kind: 'count',
    usage: 'none',
    record: false,
  },
  'openai-input-tokens': {
    caller: ['/v1/responses/input_tokens', '/responses/input_tokens'],
    upstream: '/responses/input_tokens',
    family: 'openai',
    kind: 'count',
    usage: 'none',
    record: false,
  },
  'openai-embeddings': {
    caller: ['/v1/embeddings', '/embeddings'],
    upstream: '/embeddings',
    family: 'openai',
    kind: 'embeddings',
    usage: 'openai',
  },
  'openai-responses': {
    caller: ['/v1/responses', '/responses', '/v1/responses/compact', '/responses/compact'],
    upstream: {
      '/v1/responses': '/responses',
      '/responses': '/responses',
      '/v1/responses/compact': '/responses/compact',
      '/responses/compact': '/responses/compact',
    },
    family: 'openai',
    kind: 'responses',
    usage: 'responses',
  },
  'openai-images': {
    caller: [
      '/v1/images/generations', '/images/generations',
      '/v1/images/edits', '/images/edits',
      '/v1/images/variations', '/images/variations',
    ],
    upstream: {
      '/v1/images/generations': '/images/generations',
      '/images/generations': '/images/generations',
      '/v1/images/edits': '/images/edits',
      '/images/edits': '/images/edits',
      '/v1/images/variations': '/images/variations',
      '/images/variations': '/images/variations',
    },
    family: 'openai',
    kind: 'images',
    usage: 'images',
  },
  'openai-speech': {
    caller: ['/v1/audio/speech', '/audio/speech'],
    upstream: '/audio/speech',
    family: 'openai',
    kind: 'audio',
    usage: 'none',
  },
  'openai-transcriptions': {
    caller: [
      '/v1/audio/transcriptions', '/audio/transcriptions',
      '/v1/audio/translations', '/audio/translations',
    ],
    upstream: {
      '/v1/audio/transcriptions': '/audio/transcriptions',
      '/audio/transcriptions': '/audio/transcriptions',
      '/v1/audio/translations': '/audio/translations',
      '/audio/translations': '/audio/translations',
    },
    family: 'openai',
    kind: 'audio',
    usage: 'audio',
  },
  rerank: {
    caller: ['/rerank', '/v1/rerank', '/v2/rerank'],
    upstream: '/rerank',
    family: 'openai',
    kind: 'rerank',
    usage: 'rerank',
  },
};

/** The one row a dialect is read through. */
export const dialectRow = (dialect: Dialect): DialectRow => DIALECT_ROWS[dialect];

/** The wire family a dialect speaks. */
export const familyOf = (dialect: Dialect): DialectFamily => DIALECT_ROWS[dialect].family;

/** The kind of call a dialect makes. */
export const kindOf = (dialect: Dialect): DialectKind => DIALECT_ROWS[dialect].kind;

/** The first path a dialect answers at, which a refusal names. */
export const callerPathOf = (dialect: Dialect): string => DIALECT_ROWS[dialect].caller[0] ?? '';

/** The path a caller posts to, by the dialect it is read as. */
export const CALLER_PATHS: Readonly<Record<Dialect, string>> = Object.fromEntries(
  (Object.entries(DIALECT_ROWS) as [Dialect, DialectRow][]).map(([dialect, row]) => [dialect, row.caller[0] ?? '']),
) as Record<Dialect, string>;

/**
 * The path joined onto a provider's endpoint for one caller path.
 *
 * A provider may replace the whole dialect with `paths`, as OpenRouter does for
 * its one image path. Otherwise a row names one path, or one path for each
 * caller path, and a `/v1` prefix on the caller's path is not part of the
 * lookup: `/v1/images/edits` and `/images/edits` go to the same place.
 */
export const upstreamFor = (
  dialect: Dialect,
  callerPath: string,
  paths?: ModelProvider['paths'],
): string => {
  const replaced = paths?.[dialect];
  if (replaced !== undefined) return replaced;
  const row = DIALECT_ROWS[dialect];
  if (typeof row.upstream === 'string') return row.upstream;
  const canonical = callerPath.startsWith('/v1/') ? callerPath.slice(3) : callerPath;
  return row.upstream[callerPath] ?? row.upstream[canonical] ?? '';
};

/** The path the models list answers at, for both dialects. */
export const MODELS_PATH = '/v1/models';

/** The path an OpenAI chat call answers at the root. */
export const ROOT_CALL_PATH = '/chat/completions';

/** The path the models list answers at the root. */
export const ROOT_MODELS_PATH = '/models';

/**
 * The OpenAI paths that answer at the root as well as under `/v1`.
 *
 * Both SDKs are given `http://host:port` as their base URL, so only Anthropic's
 * paths keep their `/v1`: `/v1/messages` and the count path have no root twin.
 */
export const ROOT_PATHS: readonly string[] = [
  ROOT_CALL_PATH,
  ROOT_MODELS_PATH,
  '/embeddings',
  '/responses',
  '/responses/compact',
  '/responses/input_tokens',
  '/images/generations',
  '/images/edits',
  '/images/variations',
  '/audio/speech',
  '/audio/transcriptions',
  '/audio/translations',
  '/rerank',
  '/v2/rerank',
];

/** The shape of a Responses follow-up at the root, whose id is part of the path. */
const RESPONSE_FOLLOW_UP = /^(?:\/v1)?\/responses\/[^/]+(?:\/cancel|\/input_items)?$/u;

/** Whether a path is one of the proxy's root paths, or a Responses follow-up there. */
export const isRootPath = (path: string): boolean => ROOT_PATHS.includes(path) || RESPONSE_FOLLOW_UP.test(path);

/** The dialect a caller's path is read as, or nothing when it is not a call. */
export const dialectAt = (path: string): Dialect | undefined => {
  for (const [dialect, row] of Object.entries(DIALECT_ROWS) as [Dialect, DialectRow][]) {
    if (row.caller.includes(path)) return dialect;
  }
  return undefined;
};

/**
 * The dialect a request that names none by its path is answered in.
 *
 * Anthropic's SDKs and Claude Code send `anthropic-version` on every request
 * and OpenAI's never do.
 */
export const dialectOfHeaders = (headers: Headers): Dialect =>
  headers.has('anthropic-version') ? 'anthropic-messages' : 'openai-chat';

/**
 * The error type a status is given, the names Anthropic's API documents.
 *
 * OpenAI's SDKs map an error by its status alone, so the same names serve its
 * body as well; a status not listed is `api_error`.
 */
const ERROR_TYPES: Readonly<Record<number, string>> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  405: 'invalid_request_error',
  413: 'request_too_large',
  500: 'api_error',
  502: 'api_error',
  503: 'api_error',
  504: 'timeout_error',
};

/** The error type a status is given. */
export const errorType = (status: number): string => ERROR_TYPES[status] ?? 'api_error';

/** A refusal, before it is put in a dialect's body. */
export interface Refusal {
  /** The HTTP status. */
  status: number;
  /** The sentence the person is shown. */
  message: string;
  /** OpenAI's machine-readable `code`, such as `model_not_found`. */
  code?: string;
  /** The `WWW-Authenticate` challenge a 401 carries (RFC 9110 section 11.6.1). */
  challenge?: string;
}

/**
 * A refusal in the dialect's own error body.
 *
 * `openai`: `{ error: { message, type, param: null, code } }`.
 * `anthropic`: `{ type: 'error', error: { type, message } }`.
 * `headers` adds to the answer, such as `Allow` on a 405; a refusal's
 * challenge goes out as its `WWW-Authenticate`.
 */
export const refusalBody = (dialect: Dialect, refusal: Refusal, headers: Record<string, string> = {}): Response => {
  const type = errorType(refusal.status);
  const body = familyOf(dialect) === 'anthropic'
    ? { type: 'error', error: { type, message: refusal.message } }
    : { error: { message: refusal.message, type, param: null, code: refusal.code ?? null } };
  return new Response(`${JSON.stringify(body)}\n`, {
    status: refusal.status,
    headers: {
      'content-type': 'application/json',
      ...(refusal.challenge === undefined ? {} : { 'www-authenticate': refusal.challenge }),
      ...headers,
    },
  });
};

/** The header a provider's key is sent in, by the dialect's family. */
export const keyHeader = (dialect: Dialect, key: string): [string, string] =>
  familyOf(dialect) === 'anthropic' ? ['x-api-key', key] : ['authorization', `Bearer ${key}`];

/** The tokens an answer reported, each absent when it did not say. */
export interface Tokens {
  /** Prompt tokens not read from or written to the cache. */
  input?: number;
  /** Tokens written back. */
  output?: number;
  /** Prompt tokens read from and written to the provider's cache. */
  cache?: { read?: number; write?: number };
}

/** What an answer reported besides tokens: the units an audio call is charged in. */
export interface Units {
  /** Characters of a speech input, charged per million characters. */
  characters?: number;
  /** Seconds of audio a transcription reports, charged per minute. */
  seconds?: number;
}

/** What reads the usage out of an answer as it passes, holding no more of it than it must. */
export interface UsageReader {
  /** One chunk of the answer's body, as it was sent to the caller. */
  read(chunk: Uint8Array): void;
  /** What was read so far. */
  tokens(): Tokens;
  /** The units the answer reported, when it reported any. */
  units(): Units;
  /** The cost the answer reported, when it reported one. */
  cost(): Cost | undefined;
}

/** How much of a JSON answer is held to read its usage; past it, the tokens are not known. */
export const JSON_HELD = 4 * 1024 * 1024;

/** How long one SSE line may be before it is dropped unread. */
export const LINE_HELD = 1024 * 1024;

/** A count, when the value is one. */
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** The tokens one dialect's `usage` object says, merged over what was read before. */
type UsageMerge = (into: Tokens, usage: Record<string, unknown>) => void;

/** A field set only when the value is a count, so a later partial report keeps the earlier one. */
const set = (into: Tokens, key: 'input' | 'output', value: unknown): void => {
  const n = count(value);
  if (n !== undefined) into[key] = n;
};

/** A cache field, set the same way. */
const setCache = (into: Tokens, key: 'read' | 'write', value: unknown): void => {
  const n = count(value);
  if (n !== undefined) into.cache = { ...into.cache, [key]: n };
};

/** The cached prompt tokens OpenAI reports under a details object. */
const cachedIn = (usage: Record<string, unknown>, field: string): number | undefined => {
  const details = usage[field];
  return isRecord(details) ? count(details['cached_tokens']) : undefined;
};

/**
 * OpenAI's `usage`: `prompt_tokens` counts the cached ones too, so they are
 * taken out of `input` and kept as a cache read, which is how a total that adds
 * input and cache counts each token once.
 */
const openaiUsage: UsageMerge = (into, usage) => {
  const prompt = count(usage['prompt_tokens']);
  const cached = cachedIn(usage, 'prompt_tokens_details');
  if (prompt !== undefined) into.input = Math.max(0, prompt - (cached ?? 0));
  if (cached !== undefined && cached > 0) setCache(into, 'read', cached);
  set(into, 'output', usage['completion_tokens']);
};

/** Anthropic's `usage`, whose `input_tokens` already leaves the cache out. */
const anthropicUsage: UsageMerge = (into, usage) => {
  set(into, 'input', usage['input_tokens']);
  set(into, 'output', usage['output_tokens']);
  setCache(into, 'read', usage['cache_read_input_tokens']);
  setCache(into, 'write', usage['cache_creation_input_tokens']);
};

/** Responses' `usage`, whose `input_tokens` counts the cached ones as OpenAI's prompt does. */
const responsesUsage: UsageMerge = (into, usage) => {
  const input = count(usage['input_tokens']);
  const cached = cachedIn(usage, 'input_tokens_details');
  if (input !== undefined) into.input = Math.max(0, input - (cached ?? 0));
  if (cached !== undefined && cached > 0) setCache(into, 'read', cached);
  set(into, 'output', usage['output_tokens']);
};

/** An image answer's usage: `input_tokens` and `output_tokens`, or the chat shape. */
const imageUsage: UsageMerge = (into, usage) => {
  openaiUsage(into, usage);
  const input = count(usage['input_tokens']);
  const cached = cachedIn(usage, 'input_tokens_details');
  if (input !== undefined) into.input = Math.max(0, input - (cached ?? 0));
  if (cached !== undefined && cached > 0) setCache(into, 'read', cached);
  set(into, 'output', usage['output_tokens']);
};

/** A transcription's token usage; its seconds are read beside the tokens. */
const audioUsage: UsageMerge = (into, usage) => {
  set(into, 'input', usage['input_tokens']);
  set(into, 'output', usage['output_tokens']);
};

/** A rerank answer's usage: `total_tokens`, or the billed input tokens of `meta`. */
const rerankUsage: UsageMerge = (into, usage) => {
  set(into, 'input', usage['total_tokens']);
  set(into, 'input', usage['input_tokens']);
};

/** The merge one usage kind reads with. */
const mergeFor = (kind: UsageKind): UsageMerge => {
  if (kind === 'anthropic') return anthropicUsage;
  if (kind === 'responses') return responsesUsage;
  if (kind === 'images') return imageUsage;
  if (kind === 'audio') return audioUsage;
  if (kind === 'rerank') return rerankUsage;
  return openaiUsage;
};

/**
 * The cost one `usage` object reports, when it reports one.
 *
 * OpenRouter sends it in both dialects: `cost` is the amount, and
 * `cost_details.upstream_inference_prompt_cost` and
 * `upstream_inference_completions_cost` are what was sent and what came back.
 * A non-number or a negative amount is not a cost, and a cost of zero is: a
 * model OpenRouter serves free really did cost nothing. The figure is in US
 * dollars, which is the one currency `UsageTotal` sums.
 */
const costIn = (usage: Record<string, unknown>): Cost | undefined => {
  const amount = count(usage['cost']);
  if (amount === undefined) return undefined;
  const details = usage['cost_details'];
  const input = isRecord(details) ? count(details['upstream_inference_prompt_cost']) : undefined;
  const output = isRecord(details) ? count(details['upstream_inference_completions_cost']) : undefined;
  return {
    amount,
    currency: 'usd',
    from: 'harness',
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
  };
};

/** A `JSON.parse` that answers nothing rather than throwing. */
const parsed = (text: string): unknown => {
  try { return JSON.parse(text) as unknown; }
  catch { return undefined; }
};

/**
 * The usage object one parsed event or answer carries, by kind.
 *
 * A Responses event carries the response, and its usage is on that response;
 * a rerank answer carries its billed input beside `usage`, so the whole answer
 * is read rather than one object.
 */
const usageIn = (kind: UsageKind, value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  if (kind === 'anthropic') {
    // Anthropic's stream says the input in `message_start`'s message and the
    // output in each `message_delta`, the last of which is the total; a JSON
    // answer is the message itself.
    if (value['type'] === 'message_start' && isRecord(value['message'])) {
      const usage = value['message']['usage'];
      return isRecord(usage) ? usage : undefined;
    }
    return isRecord(value['usage']) ? value['usage'] : undefined;
  }
  if (kind === 'responses') {
    const response = value['response'];
    if (isRecord(response) && isRecord(response['usage'])) return response['usage'];
    return isRecord(value['usage']) ? value['usage'] : undefined;
  }
  if (kind === 'rerank') {
    const usage = isRecord(value['usage']) ? value['usage'] : {};
    const meta = isRecord(value['meta']) ? value['meta'] : undefined;
    const billed = meta !== undefined && isRecord(meta['billed_units'])
      ? count(meta['billed_units']['input_tokens'])
      : undefined;
    return billed === undefined ? usage : { ...usage, input_tokens: billed };
  }
  return isRecord(value['usage']) ? value['usage'] : undefined;
};

/**
 * A reader of the usage in one answer, chosen by its `content-type`.
 *
 * An SSE stream is read line by line and each line is dropped once read, so a
 * long answer is never held: only the line still arriving is. A JSON answer is
 * held up to `JSON_HELD` and parsed when it ends, since its usage may be
 * anywhere in it. Anything else reports no tokens, and a dialect that records
 * nothing reads nothing at all.
 */
export const usageReader = (dialect: Dialect, contentType: string | null): UsageReader => {
  const kind = DIALECT_ROWS[dialect].usage;
  const found: Tokens = {};
  const units: Units = {};
  let cost: Cost | undefined;
  const decoder = new TextDecoder();
  const type = (contentType ?? '').toLowerCase();
  const empty: UsageReader = {
    read: () => undefined,
    tokens: () => found,
    units: () => units,
    cost: () => cost,
  };
  if (kind === 'none') return empty;
  const merge = mergeFor(kind);

  /** What one parsed event or answer carries: its usage, read into the tokens and the cost. */
  const absorb = (value: unknown): void => {
    const usage = usageIn(kind, value);
    if (usage === undefined) return;
    merge(found, usage);
    if (kind === 'audio') {
      const seconds = count(usage['seconds']);
      if (seconds !== undefined) units.seconds = seconds;
    }
    // A partial report that keeps its cost keeps the earlier one; the last
    // report to carry one is the answer's whole figure.
    const reported = costIn(usage);
    if (reported !== undefined) cost = reported;
  };

  if (type.includes('text/event-stream')) {
    let line = '';
    let overlong = false;
    const take = (text: string): void => {
      if (!text.startsWith('data:')) return;
      absorb(parsed(text.slice(5).trim()));
    };
    /** The line still arriving, which no newline has ended yet. */
    const flush = (): void => {
      if (!overlong && line !== '') { take(line.replace(/\r$/u, '')); line = ''; }
    };
    return {
      read: (chunk) => {
        const text = decoder.decode(chunk, { stream: true });
        let start = 0;
        for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', start)) {
          if (!overlong) take((line + text.slice(start, at)).replace(/\r$/u, ''));
          line = '';
          overlong = false;
          start = at + 1;
        }
        if (overlong) return;
        line += text.slice(start);
        if (line.length > LINE_HELD) { line = ''; overlong = true; }
      },
      tokens: () => { flush(); return found; },
      units: () => { flush(); return units; },
      cost: () => { flush(); return cost; },
    };
  }

  if (type.includes('json')) {
    let held = '';
    let over = false;
    let done = false;
    /** The whole answer, read once when it has ended. */
    const settle = (): void => {
      if (over || done) return;
      done = true;
      absorb(parsed(held));
      held = '';
    };
    return {
      read: (chunk) => {
        if (over) return;
        held += decoder.decode(chunk, { stream: true });
        if (held.length > JSON_HELD) { held = ''; over = true; }
      },
      tokens: () => { settle(); return found; },
      units: () => { settle(); return units; },
      cost: () => { settle(); return cost; },
    };
  }

  return empty;
};

/** The `<maker>` of a `<maker>/<name>`. */
const makerOf = (name: string): string => name.split('/')[0] ?? name;

/**
 * The models list in a dialect's shape.
 *
 * OpenAI: `{ object: 'list', data: [{ id, object: 'model', created: 0, owned_by }] }`.
 * Anthropic: `{ data: [{ type: 'model', id, display_name, created_at }], has_more, first_id, last_id }`.
 * Both carry `total_count`, and each entry carries the fields OpenRouter's list
 * has when they are known: `name`, `context_length` and `pricing`. A field a
 * provider did not send is left out rather than written empty.
 *
 * Only what a caller may call is in it: never a connector, its key, its own
 * model id or a variable.
 */
export const modelList = (dialect: Dialect, models: readonly ProviderModel[]): unknown => {
  const fields = (model: ProviderModel): Record<string, unknown> => ({
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.context_length === undefined ? {} : { context_length: model.context_length }),
    ...(model.pricing === undefined ? {} : { pricing: model.pricing }),
  });
  if (familyOf(dialect) === 'anthropic') {
    return {
      data: models.map((model) => ({
        type: 'model',
        id: model.id,
        display_name: model.name ?? model.id,
        created_at: '1970-01-01T00:00:00Z',
        ...fields(model),
      })),
      has_more: false,
      first_id: models[0]?.id ?? null,
      last_id: models[models.length - 1]?.id ?? null,
      total_count: models.length,
    };
  }
  return {
    object: 'list',
    data: models.map((model) => ({ id: model.id, object: 'model', created: 0, owned_by: makerOf(model.id), ...fields(model) })),
    total_count: models.length,
  };
};

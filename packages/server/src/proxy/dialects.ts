/**
 * What each dialect the proxy serves looks like on the wire.
 *
 * A caller's tool speaks one API, OpenAI's chat completions or Anthropic's
 * messages, and reads every answer in that API's shape: a refusal that is not
 * the dialect's own error body is a parse failure in the tool rather than a
 * message the person reads. So the paths, the error bodies, the header a key
 * goes in, the usage an answer reports and the models list are all here, by
 * dialect, and the listener asks this file rather than knowing either API.
 */

import type { Dialect } from './providers.js';

/** The path a caller posts to, by the dialect it is read as. */
export const CALLER_PATHS: Readonly<Record<Dialect, string>> = {
  'openai-chat': '/v1/chat/completions',
  'anthropic-messages': '/v1/messages',
};

/**
 * The path joined onto a provider's endpoint, by dialect.
 *
 * An endpoint is written as each vendor's SDK base URL: OpenAI-style ones end
 * in `/v1` and Anthropic's has none, which is why only Anthropic's path holds it.
 */
export const UPSTREAM_PATHS: Readonly<Record<Dialect, string>> = {
  'openai-chat': '/chat/completions',
  'anthropic-messages': '/v1/messages',
};

/** The path the models list answers at, for both dialects. */
export const MODELS_PATH = '/v1/models';

/** The dialect a caller's path is read as, or nothing when it is not a call. */
export const dialectAt = (path: string): Dialect | undefined => {
  for (const [dialect, at] of Object.entries(CALLER_PATHS) as [Dialect, string][]) {
    if (path === at) return dialect;
  }
  return undefined;
};

/**
 * The dialect a request that names none by its path is answered in.
 *
 * Anthropic's SDKs and Claude Code send `anthropic-version` on every request
 * and OpenAI's never do - decision
 * `the-models-list-answers-in-the-dialect-the-caller-sent`.
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
}

/**
 * A refusal in the dialect's own error body.
 *
 * `openai-chat`: `{ error: { message, type, param: null, code } }`.
 * `anthropic-messages`: `{ type: 'error', error: { type, message } }`.
 * `headers` adds to the answer, such as `Allow` on a 405.
 */
export const refusalBody = (dialect: Dialect, refusal: Refusal, headers: Record<string, string> = {}): Response => {
  const type = errorType(refusal.status);
  const body = dialect === 'anthropic-messages'
    ? { type: 'error', error: { type, message: refusal.message } }
    : { error: { message: refusal.message, type, param: null, code: refusal.code ?? null } };
  return new Response(`${JSON.stringify(body)}\n`, {
    status: refusal.status,
    headers: { 'content-type': 'application/json', ...headers },
  });
};

/** The header a provider's key is sent in, by dialect. */
export const keyHeader = (dialect: Dialect, key: string): [string, string] =>
  dialect === 'anthropic-messages' ? ['x-api-key', key] : ['authorization', `Bearer ${key}`];

/** The tokens an answer reported, each absent when it did not say. */
export interface Tokens {
  /** Prompt tokens not read from or written to the cache. */
  input?: number;
  /** Tokens written back. */
  output?: number;
  /** Prompt tokens read from and written to the provider's cache. */
  cache?: { read?: number; write?: number };
}

/** What reads the usage out of an answer as it passes, holding no more of it than it must. */
export interface UsageReader {
  /** One chunk of the answer's body, as it was sent to the caller. */
  read(chunk: Uint8Array): void;
  /** What was read so far. */
  tokens(): Tokens;
}

/** How much of a JSON answer is held to read its usage; past it, the tokens are not known. */
export const JSON_HELD = 4 * 1024 * 1024;

/** How long one SSE line may be before it is dropped unread. */
export const LINE_HELD = 1024 * 1024;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

/**
 * OpenAI's `usage`: `prompt_tokens` counts the cached ones too, so they are
 * taken out of `input` and kept as a cache read, which is how a total that adds
 * input and cache counts each token once.
 */
const openaiUsage: UsageMerge = (into, usage) => {
  const prompt = count(usage['prompt_tokens']);
  const details = usage['prompt_tokens_details'];
  const cached = isObject(details) ? count(details['cached_tokens']) : undefined;
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

/** The usage one parsed SSE event or JSON answer carries, by dialect. */
const usageIn = (dialect: Dialect, value: unknown): Record<string, unknown> | undefined => {
  if (!isObject(value)) return undefined;
  if (dialect === 'openai-chat') return isObject(value['usage']) ? value['usage'] : undefined;
  // Anthropic's stream says the input in `message_start`'s message and the
  // output in each `message_delta`, the last of which is the total; a JSON
  // answer is the message itself.
  if (value['type'] === 'message_start' && isObject(value['message'])) {
    const usage = value['message']['usage'];
    return isObject(usage) ? usage : undefined;
  }
  return isObject(value['usage']) ? value['usage'] : undefined;
};

/** A `JSON.parse` that answers nothing rather than throwing. */
const parsed = (text: string): unknown => {
  try { return JSON.parse(text) as unknown; }
  catch { return undefined; }
};

/**
 * A reader of the usage in one answer, chosen by its `content-type`.
 *
 * An SSE stream is read line by line and each line is dropped once read, so a
 * long answer is never held: only the line still arriving is. A JSON answer is
 * held up to `JSON_HELD` and parsed when it ends, since its usage may be
 * anywhere in it. Anything else reports no tokens.
 */
export const usageReader = (dialect: Dialect, contentType: string | null): UsageReader => {
  const merge = dialect === 'openai-chat' ? openaiUsage : anthropicUsage;
  const found: Tokens = {};
  const decoder = new TextDecoder();
  const type = (contentType ?? '').toLowerCase();

  if (type.includes('text/event-stream')) {
    let line = '';
    let overlong = false;
    const take = (text: string): void => {
      if (!text.startsWith('data:')) return;
      const usage = usageIn(dialect, parsed(text.slice(5).trim()));
      if (usage !== undefined) merge(found, usage);
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
      tokens: () => {
        if (!overlong && line !== '') { take(line.replace(/\r$/u, '')); line = ''; }
        return found;
      },
    };
  }

  if (type.includes('json')) {
    let held = '';
    let over = false;
    let done = false;
    return {
      read: (chunk) => {
        if (over) return;
        held += decoder.decode(chunk, { stream: true });
        if (held.length > JSON_HELD) { held = ''; over = true; }
      },
      tokens: () => {
        if (!over && !done) {
          done = true;
          const usage = usageIn(dialect, parsed(held));
          held = '';
          if (usage !== undefined) merge(found, usage);
        }
        return found;
      },
    };
  }

  return { read: () => undefined, tokens: () => found };
};

/** The `<maker>` of a `<maker>/<name>`. */
const makerOf = (name: string): string => name.split('/')[0] ?? name;

/**
 * The models list in a dialect's shape.
 *
 * OpenAI: `{ object: 'list', data: [{ id, object: 'model', created: 0, owned_by }] }`.
 * Anthropic: `{ data: [{ type: 'model', id, display_name, created_at }], has_more, first_id, last_id }`.
 * Only the names are in it: never a provider, its own id, a price or a variable.
 */
export const modelList = (dialect: Dialect, names: readonly string[]): unknown => {
  if (dialect === 'anthropic-messages') {
    return {
      data: names.map((id) => ({ type: 'model', id, display_name: id, created_at: '1970-01-01T00:00:00Z' })),
      has_more: false,
      first_id: names[0] ?? null,
      last_id: names[names.length - 1] ?? null,
    };
  }
  return {
    object: 'list',
    data: names.map((id) => ({ id, object: 'model', created: 0, owned_by: makerOf(id) })),
  };
};

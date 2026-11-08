/**
 * One call to a webhook connector, read once.
 *
 * The route reads the body before it can decide anything: a signature is
 * checked over the raw bytes, `match` is checked against the headers, the query
 * and the parsed body, and every target then reads the same object rather than
 * the request a second time. The bytes are kept beside the parsed body for the
 * signature schemes.
 */

/**
 * The most of a body this plugin reads unless its option says otherwise: 25 MiB,
 * which holds every payload GitHub delivers, since GitHub caps its payloads at
 * 25 MB.
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads#payload-cap
 */
export const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

/** One call, as a route reads it. */
export interface Call {
  /** The bytes exactly as they arrived, which a signature is checked over. */
  raw: Uint8Array;
  /** The body parsed by its type: an object, an array, text, or `null` when empty. */
  body: unknown;
  /** The request's headers, names lowercased. `dataOf` keeps the proof's own out of a run. */
  headers: Record<string, string>;
  /** The query, without the `token` parameter, which a run is not shown. */
  query: Record<string, string>;
  /** The `token` query parameter, kept only for the `query` scheme to check. */
  token?: string;
  /** The request's method, which is `POST` for a call this route serves. */
  method: string;
}

/** What reading a call answered: the call, or the answer that refuses it. */
export type Read = { call: Call } | { refused: Response };

/** One JSON answer with a `message`, which is all a refusal says. */
export const answer = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** How a body is read, by the content type it declares. */
const kindOf = (contentType: string): 'json' | 'form' | 'text' => {
  const lower = contentType.toLowerCase();
  if (lower.startsWith('application/json') || lower.endsWith('+json')) return 'json';
  if (lower.startsWith('application/x-www-form-urlencoded')) return 'form';
  return 'text';
};

/**
 * The body's bytes, up to `max`.
 *
 * Read in chunks so a body larger than the limit is cut off rather than held:
 * answering 413 after reading everything would bound what a run is given and
 * not what a caller can make this process hold. A declared `content-length`
 * over the limit is refused before the first chunk.
 */
const bytesOf = async (request: Request, max: number): Promise<Uint8Array | undefined> => {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > max) return undefined;
  const stream = request.body;
  if (stream === null) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const raw = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    raw.set(chunk, at);
    at += chunk.byteLength;
  }
  return raw;
};

/**
 * The body as a run reads it.
 *
 * A JSON content type is parsed, and a body that is not JSON under it is
 * refused: a sender that says JSON and sends none is a sender whose signature
 * this host cannot account for. Any other body that parses as JSON is JSON too,
 * because senders exist that set no content type at all. A form is its fields,
 * anything else is text, and no bytes at all is `null`.
 */
const bodyOf = (raw: Uint8Array, contentType: string): { body: unknown } | { refused: Response } => {
  if (raw.byteLength === 0) return { body: null };
  const text = new TextDecoder().decode(raw);
  const kind = kindOf(contentType);
  if (kind === 'form') return { body: Object.fromEntries(new URLSearchParams(text)) };
  if (kind === 'json') {
    try {
      return { body: JSON.parse(text) as unknown };
    }
    catch {
      return { refused: answer(400, { message: 'The body is not JSON.' }) };
    }
  }
  try {
    return { body: JSON.parse(text) as unknown };
  }
  catch {
    return { body: text };
  }
};

/** Every header of the request, names lowercased as the listener hands them over. */
const headersOf = (request: Request): Record<string, string> => {
  const kept: Record<string, string> = {};
  request.headers.forEach((value, name) => { kept[name] = value; });
  return kept;
};

/** The query a run may read, without the token a URL may carry. */
const queryOf = (request: Request): Record<string, string> => {
  const kept: Record<string, string> = {};
  for (const [name, value] of new URL(request.url).searchParams) {
    if (name !== 'token') kept[name] = value;
  }
  return kept;
};

/**
 * Read one call, or answer the refusal that stops it.
 *
 * The call keeps every header, because a scheme reads its proof from one; the
 * event data a run sees is what `dataOf` gives, which takes the proof's own
 * headers out.
 */
export async function readCall(
  request: Request,
  max = DEFAULT_MAX_BODY_BYTES,
): Promise<Read> {
  const raw = await bytesOf(request, max);
  if (raw === undefined) return { refused: answer(413, { message: `The body is larger than ${max} bytes.` }) };
  const parsed = bodyOf(raw, request.headers.get('content-type') ?? '');
  if ('refused' in parsed) return parsed;
  const query = new URL(request.url).searchParams;
  const token = query.get('token');
  return {
    call: {
      raw,
      body: parsed.body,
      headers: headersOf(request),
      query: queryOf(request),
      ...(token === null ? {} : { token }),
      method: request.method,
    },
  };
}

/**
 * The event data of one call: what a run reads, and what `match` is checked against.
 *
 * `omit` names the headers a connector's proof is read from, so a run is not
 * shown the token its caller was checked with; `authorization` and `cookie`
 * are always kept out too.
 */
export const dataOf = (call: Call, connector: string, omit: readonly string[] = []): Record<string, unknown> => {
  const hidden = new Set(['authorization', 'cookie', ...omit.map((one) => one.toLowerCase())]);
  const headers = Object.fromEntries(Object.entries(call.headers).filter(([name]) => !hidden.has(name)));
  return { connector, method: call.method, body: call.body, headers, query: call.query };
};

/** One value of the event data by a dotted path, or nothing the path names. */
const at = (data: Record<string, unknown>, path: string): unknown => {
  let held: unknown = data;
  for (const step of path.split('.')) {
    if (typeof held !== 'object' || held === null || !Object.hasOwn(held, step)) return undefined;
    held = (held as Record<string, unknown>)[step];
  }
  return held;
};

/**
 * Whether a call passes the connector's `match`.
 *
 * Every path names a value the call must hold, and every value is one of the
 * listed ones. A path the call does not hold blocks it: `only production` has
 * to mean only production, so a call this host cannot read the field of is not
 * one it lets through.
 */
export const allows = (match: Record<string, string | string[]>, data: Record<string, unknown>): boolean => {
  for (const [path, wanted] of Object.entries(match)) {
    const held = at(data, path);
    if (held === undefined || held === null) return false;
    const choices = Array.isArray(wanted) ? wanted : [wanted];
    if (!choices.includes(String(held))) return false;
  }
  return true;
};

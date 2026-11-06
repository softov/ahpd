/**
 * What a key and a call say about themselves, as a map of names to values.
 *
 * One check for every door: `ahpd token mint --meta` writes a key's meta, and a
 * proxy call writes its own as LiteLLM takes a call's `spend_logs_metadata`,
 * a JSON object of string values in its header or its body
 * (https://docs.litellm.ai/docs/proxy/cost_tracking). The bounds are the same,
 * so a value the mint accepts is one a call may send, and a key's meta merged
 * under a call's is a map `checkMeta` has already seen.
 */

import { INVALID_PARAMS, RpcError } from '../rpc.js';

/** How long a name may be. */
const KEY_LIMIT = 64;

/** How long a value may be. */
const VALUE_LIMIT = 256;

/** How many entries one key, or one call, may name. */
export const META_LIMIT = 32;

/** What a value said, said back in a refusal that is worth reading. */
const said = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);

/**
 * One meta, checked against the bounds every meta has.
 *
 * The map is rebuilt, so what comes back holds only the names it checked and
 * never the body's own object. A name is 1 to 64 characters, a value is a
 * string of at most 256 characters, and one meta names at most 32 entries.
 */
export function checkMeta(body: unknown): Record<string, string> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RpcError(INVALID_PARAMS, `A meta is a map of names to values, and that body has ${said(body)}`);
  }
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length > META_LIMIT) {
    throw new RpcError(INVALID_PARAMS,
      `A meta names ${String(META_LIMIT)} entries at most, and that body names ${String(entries.length)}`);
  }
  return Object.fromEntries(entries.map(([name, value]): [string, string] => {
    if (name.length === 0 || name.length > KEY_LIMIT) {
      throw new RpcError(INVALID_PARAMS, `A meta's name ${said(name)} is 1 to ${String(KEY_LIMIT)} characters`);
    }
    if (typeof value !== 'string') {
      throw new RpcError(INVALID_PARAMS, `A meta's ${name} is a string, and that body has ${said(value)}`);
    }
    if (value.length > VALUE_LIMIT) {
      throw new RpcError(INVALID_PARAMS,
        `A meta's ${name} is ${String(VALUE_LIMIT)} characters at most, and that one has ${String(value.length)}`);
    }
    return [name, value];
  }));
}

/**
 * A meta's text read as the map it names: a JSON object of string values, as
 * LiteLLM reads its `x-litellm-spend-logs-metadata` header.
 *
 * Text that is nothing but space is no meta at all, which is what a client
 * sending an empty header means. The bounds are `checkMeta`'s, so every door
 * refuses the same things.
 */
export function parseMeta(text: string): Record<string, string> {
  if (text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  }
  catch {
    throw new RpcError(INVALID_PARAMS, `A meta is a JSON object of string values, and ${text} is not JSON`);
  }
  return checkMeta(parsed);
}

/**
 * Which provider a model name is called on.
 *
 * A name lists the entries serving it in the order the file writes them, and a
 * call goes to the first that can take it: its provider accepts the caller's
 * dialect, a policy allows it, and its key is set or it has none. The rest that
 * could are kept in order, for the listener to fall back to when the first
 * fails before answering.
 *
 * Nothing is called and nothing is logged here: what a route answers is known
 * from the table, the policy and the environment, so a call that could never
 * be made is refused before anything is spent finding that out.
 */

import { CALLER_PATHS, UPSTREAM_PATHS, type Refusal } from './dialects.js';
import { DIALECTS, type Dialect, type ModelEntry, type ProxyConfiguration } from './providers.js';

/** One entry a call may go to, with everything the call needs. */
export interface Candidate {
  /** The provider's id, as the table names it. */
  provider: string;
  /** The entry: the provider's own model id and its price. */
  entry: ModelEntry;
  /** The URL the call is posted to. */
  url: string;
  /** The provider's key, read from its variable; absent for a provider with none. */
  key?: string;
}

/** What a route answers: the candidates in order, or why there are none. */
export type Routed = { candidates: Candidate[] } | { refusal: Refusal };

/** What a route reads besides the table. */
export interface RouteOptions {
  /** Where keys are read from. The process's environment when absent. */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Why a policy refuses this entry, or nothing when it allows it. Every entry
   * is allowed when absent. A promise, because a policy store is read.
   */
  allowed?(entry: ModelEntry): string | undefined | Promise<string | undefined>;
}

/**
 * An endpoint and a dialect's path, joined with exactly one slash.
 *
 * `https://openrouter.ai/api/v1` gives `.../api/v1/chat/completions`, and
 * `https://api.anthropic.com` gives `.../v1/messages`.
 */
export const upstreamUrl = (endpoint: string, dialect: Dialect): string =>
  `${endpoint.replace(/\/+$/u, '')}${UPSTREAM_PATHS[dialect]}`;

/**
 * The entries a call of `name` in `dialect` may go to, or the refusal.
 *
 * The filters run in the order the refusals are told: no entry at all, no
 * entry in this dialect, none a policy allows, none with its key set. So a
 * name a policy refuses is a 403 whatever its keys, and a key is only reported
 * missing for an entry the caller could otherwise have used.
 */
export async function route(proxy: ProxyConfiguration, name: string, dialect: Dialect, options: RouteOptions = {}): Promise<Routed> {
  const env = options.env ?? process.env;
  const entries = (Object.hasOwn(proxy.models, name) ? proxy.models[name] : undefined) ?? [];
  // An entry naming a provider the table does not hold serves nothing.
  const known = entries.filter((entry) => Object.hasOwn(proxy.providers, entry.provider));
  if (known.length === 0) {
    return { refusal: { status: 404, message: `model ${name} is not served here`, code: 'model_not_found' } };
  }

  const speaking = known.filter((entry) => proxy.providers[entry.provider]?.accepts.includes(dialect));
  if (speaking.length === 0) {
    const other = DIALECTS.find((one) => one !== dialect && known.some((entry) => proxy.providers[entry.provider]?.accepts.includes(one)));
    const where = other === undefined ? '' : ` is served in ${other}, not ${dialect}: call POST ${CALLER_PATHS[other]}`;
    return { refusal: { status: 404, message: `model ${name}${where}`, code: 'model_not_found' } };
  }

  const allowed: ModelEntry[] = [];
  let firstRefusal: string | undefined;
  for (const entry of speaking) {
    const refused = options.allowed === undefined ? undefined : await options.allowed(entry);
    if (refused === undefined) allowed.push(entry);
    else firstRefusal ??= refused;
  }
  if (allowed.length === 0) return { refusal: { status: 403, message: firstRefusal ?? `model ${name} is refused` } };

  const candidates: Candidate[] = [];
  const missing: string[] = [];
  for (const entry of allowed) {
    const provider = proxy.providers[entry.provider];
    if (provider === undefined) continue;
    const key = provider.key === undefined ? undefined : env[provider.key.env];
    if (provider.key !== undefined && key === undefined) {
      missing.push(`${entry.provider} needs ${provider.key.env}`);
      continue;
    }
    candidates.push({
      provider: entry.provider,
      entry,
      url: upstreamUrl(provider.endpoint, dialect),
      ...(key === undefined ? {} : { key }),
    });
  }
  if (candidates.length === 0) {
    return { refusal: { status: 503, message: `model ${name} has no provider with its key set: ${missing.join(', ')}` } };
  }
  return { candidates };
}

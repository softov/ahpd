/**
 * `ahpd proxy list`: the providers this daemon would call, and the model names.
 *
 * Nothing is called and no key is read: the listing answers what the
 * configuration and the built-in providers say the proxy knows, which is the
 * table the routing will be by. A provider's key is named by the variable
 * holding it, and only whether that variable is set is said - the key itself is
 * in the environment and is never printed, here or in the JSON.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import type { ModelEntry, ModelPrice, ProxyConfiguration } from '../proxy/providers.js';
import { flagFields, optionsFrom } from './options.js';
import type { ServedFacts } from './served.js';

/** One provider as the listing shows it. */
export interface ProviderRow {
  /** The id a model entry names it by. */
  id: string;
  /** Where its API answers. */
  endpoint: string;
  /** The APIs it is called in. */
  accepts: readonly string[];
  /** The variable holding its key, when the provider has one. */
  key?: { env: string };
  /** Whether that variable is set in this process. Never the key. */
  keySet: boolean;
}

/** One model name and the entries that serve it. */
export interface ModelRow {
  /** The name as `<maker>/<name>`. */
  name: string;
  /** Each provider serving it, in the order the file lists them. */
  providers: readonly ModelEntry[];
}

/**
 * One provider as a line, with its id in a column wide enough for the longest.
 *
 * A listing read down rather than across, so every provider is one line and
 * two of them are never mistaken for one row split in two.
 */
export const providerLine = (row: ProviderRow, width: number): string => {
  const key = row.key === undefined ? 'no key' : `key set: ${String(row.keySet)} (${row.key.env})`;
  return `  ${row.id.padEnd(width)}  ${row.endpoint}  [${row.accepts.join(', ')}]  ${key}`;
};

/** What a model costs there, as the sentence that says so. */
const priceOf = (price: ModelPrice | undefined): string | undefined => {
  if (price === undefined) return undefined;
  const parts = [
    price.input === undefined ? undefined : `$${String(price.input)} in`,
    price.output === undefined ? undefined : `$${String(price.output)} out`,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : `${parts.join(', ')} per Mtok`;
};

/** One entry of a model name, as the line that says where it is served. */
const entryLine = (entry: ModelEntry): string => {
  const price = priceOf(entry.price);
  return `    ${entry.provider}: ${entry.id}${price === undefined ? '' : ` (${price})`}`;
};

export const declareProxy = (registry: Registry<object>, served?: ServedFacts): Command => registry.action({
  id: 'proxy.list',
  summary: 'The providers this proxy would call, and the model names that point at them',
  description: 'The built-in providers and any the configuration adds or replaces, then every model name with the providers serving it. A provider\'s key is never printed: only whether the variable holding it is set.',
  surfaces: { cli: { pattern: ['proxy', 'list'] }, http: { method: 'GET', path: '/proxy/list' } },
  // No key: this is the listing, and each row carries the `id` a provider is
  // named by.
  effect: 'read',
  resource: { kind: 'provider' },
  scopes: ['config:read'],
  // Served, the list is the daemon's own, so no field could name another.
  ...(served === undefined ? { input: flagFields } : {}),
  run: (context) => {
    const proxy: ProxyConfiguration = served === undefined
      ? optionsFrom(context.input as Readonly<Record<string, unknown>>).proxy
      : served.options.proxy;
    const rows: ProviderRow[] = Object.entries(proxy.providers).map(([id, provider]) => ({
      id,
      endpoint: provider.endpoint,
      accepts: provider.accepts,
      ...(provider.key === undefined ? {} : { key: provider.key }),
      keySet: provider.key !== undefined && process.env[provider.key.env] !== undefined,
    }));
    const models: ModelRow[] = Object.entries(proxy.models).map(([name, providers]) => ({ name, providers }));

    const width = Math.max(...rows.map((row) => row.id.length));
    const text = `providers:\n${rows.map((row) => `${providerLine(row, width)}\n`).join('')}`
      + (models.length === 0
        ? 'models:\n  (none named)\n'
        : `models:\n${models.map((row) => `  ${row.name}\n${row.providers.map((entry) => `${entryLine(entry)}\n`).join('')}`).join('')}`);
    return output({ providers: rows, models }, text);
  },
});

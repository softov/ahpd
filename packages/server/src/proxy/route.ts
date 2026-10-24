/**
 * Which connector a model name is called on.
 *
 * A name lists the entries serving it in the order the file writes them, and a
 * call goes to each entry's connectors in turn: the caller's own first, then
 * the scope team's, then the host's, each tier in id order. An entry's provider
 * names an adapter, and every open connector of it is a candidate in that
 * order; it may also name one connector's id, which is the only candidate for
 * it. A policy may refuse an entry, and a connector whose provider does not
 * speak the caller's dialect is left out. The rest are kept in order, for the
 * listener to fall back to when the first fails before answering.
 *
 * A name the file does not hold is read as `<prefix>/<id>`: the prefix is the
 * adapter's name, or the connector's id through a provider that names one, and
 * every open connector with that prefix serves the name. That is how a
 * provider's whole list is callable with no line in the file.
 *
 * Nothing is called and nothing is logged here: what a route answers is known
 * from the table, the open connectors and the policy, so a call that could
 * never be made is refused before anything is spent finding that out.
 */

import type { ProviderConnector, ProviderModel } from '@ahpd/sdk';
import type { ProxyCaller } from './caller.js';
import { prefixOf, type ModelCatalog } from './catalog.js';
import { CALLER_PATHS, UPSTREAM_PATHS, type Refusal } from './dialects.js';
import { DIALECTS, type Dialect, type ModelEntry, type ProxyConfiguration } from './providers.js';

/** One connector a call may go to, with everything the call needs. */
export interface Candidate {
  /** The connector's id, which names whose key pays for the call. */
  connector: string;
  /** The adapter that connector is of, such as `openrouter`. */
  provider: string;
  /** The entry: the provider's own model id and its price. */
  entry: ModelEntry;
  /** The URL the call is posted to. */
  url: string;
  /** The connector's key, from the vault or the daemon's environment; absent when it has none. */
  key?: string;
  /** The provider's own row for the model, when its list holds the id; absent when it does not. */
  model?: ProviderModel;
}

/** What a route answers: the candidates in order, or why there are none. */
export type Routed = { candidates: Candidate[] } | { refusal: Refusal };

/** What a route reads besides the table. */
export interface RouteOptions {
  /** The open provider connectors, as the connectors channel lists them. */
  providers: readonly ProviderConnector[];
  /**
   * The lists the open connectors answered, for a name the table does not hold.
   * A name outside every list is still routed: the provider answers it or not.
   */
  catalog?: ModelCatalog;
  /** Who makes the call: their own connectors come first, then a team's, then the host's. */
  caller?: ProxyCaller;
  /**
   * Why a policy refuses this entry, or nothing when it allows it. Every entry
   * is allowed when absent. A promise, because a policy store is read.
   */
  allowed?(entry: ModelEntry): string | undefined | Promise<string | undefined>;
}

/** Where a caller stands among connector owners: the person and the team a connector may be theirs. */
interface Places {
  /** The id of the person the call runs for, when it runs for one. */
  me?: string;
  /** The team the call is charged to, when it is. */
  team?: string;
}

/**
 * The person and the team a caller brings.
 *
 * A person is themselves. A session is the person whose work it is, when
 * `owner` names one. Root is the daemon, which owns no connector: it calls the
 * host's.
 */
const placesOf = (caller?: ProxyCaller): Places => {
  if (caller === undefined || caller.kind === 'root') return {};
  const team = caller.scope?.team;
  const me = caller.kind === 'person'
    ? caller.principal.id
    : caller.owner !== undefined && caller.owner.startsWith('user:') ? caller.owner.slice('user:'.length) : undefined;
  return { ...(me === undefined ? {} : { me }), ...(team === undefined ? {} : { team }) };
};

/** Which tier a connector serves a caller from: 0 their own, 1 their team's, 2 the host's, `undefined` nobody's it is. */
const tierOf = (connector: ProviderConnector, places: Places): 0 | 1 | 2 | undefined => {
  if (connector.owner === 'host') return 2;
  if (places.me !== undefined && connector.owner === `user:${places.me}`) return 0;
  if (places.team !== undefined && connector.owner === `team:${places.team}`) return 1;
  return undefined;
};

/**
 * The connectors an entry names at all, whoever owns them.
 *
 * An entry names one connector by its id when such a connector exists, and
 * that connector alone: the id is how a person points at one endpoint. It names
 * an adapter otherwise, and every open connector of that adapter answers.
 */
const namedBy = (entry: ModelEntry, providers: readonly ProviderConnector[]): ProviderConnector[] => {
  const byId = providers.filter((one) => one.id === entry.provider);
  if (byId.length > 0) return byId;
  return providers.filter((one) => one.adapter === entry.provider);
};

/**
 * The connectors a caller may use, in the order they are tried.
 *
 * Their own first, then their team's, then the host's, each tier in connector
 * id order. A connector of another person or another team is not theirs.
 */
const inOrder = (connectors: readonly ProviderConnector[], places: Places): ProviderConnector[] =>
  connectors
    .map((one) => ({ one, tier: tierOf(one, places) }))
    .filter((one): one is { one: ProviderConnector; tier: 0 | 1 | 2 } => one.tier !== undefined)
    .sort((one, two) => one.tier - two.tier || one.one.id.localeCompare(two.one.id))
    .map((one) => one.one);

/**
 * The connectors a caller may use for an entry, in the order they are tried.
 *
 * Their own first, then their team's, then the host's, each tier in connector
 * id order. A connector of another person or another team is not theirs.
 */
const usableFor = (entry: ModelEntry, providers: readonly ProviderConnector[], places: Places): ProviderConnector[] =>
  inOrder(namedBy(entry, providers), places);

/** Whether a connector's provider speaks one dialect. */
const speaks = (connector: ProviderConnector, dialect: Dialect): boolean => connector.provider.accepts.includes(dialect);

/**
 * An endpoint and a dialect's path, joined with exactly one slash.
 *
 * `https://openrouter.ai/api/v1` gives `.../api/v1/chat/completions`, and
 * `https://api.anthropic.com` gives `.../v1/messages`.
 */
export const upstreamUrl = (endpoint: string, dialect: Dialect): string =>
  `${endpoint.replace(/\/+$/u, '')}${UPSTREAM_PATHS[dialect]}`;

/** The same provider named twice, once. */
const distinct = (names: readonly string[]): string[] => [...new Set(names)];

/**
 * The prefix and the provider's own id of a name the table does not hold.
 *
 * The split is at the first slash, because a provider's id may hold one:
 * `openrouter/anthropic/claude-sonnet-5.5` is OpenRouter's own
 * `anthropic/claude-sonnet-5.5`. Nothing when either side is empty.
 */
const fetchedName = (name: string): { prefix: string; id: string } | undefined => {
  const at = name.indexOf('/');
  if (at <= 0 || at === name.length - 1) return undefined;
  return { prefix: name.slice(0, at), id: name.slice(at + 1) };
};

/**
 * The candidates for a name the table does not hold, read as `<prefix>/<id>`.
 *
 * Every open connector whose prefix is that prefix serves the name, whatever
 * its list holds: a call made before the first fetch still goes out, and the
 * provider's own 404 names the model. The refusals come in the table's order:
 * no connector with that prefix, none in this dialect, none a policy allows,
 * and none the caller may use.
 *
 * The policy is asked on the whole name, as it is for a table entry, so
 * `openrouter/*` allows every OpenRouter model. The fetched price goes into the
 * entry when the connector's list prices that model, so the record and the list
 * show one figure.
 */
const fetchedRoute = async (name: string, fetched: { prefix: string; id: string }, dialect: Dialect, options: RouteOptions): Promise<Routed> => {
  const named = options.providers.filter((one) => prefixOf(one) === fetched.prefix);
  if (named.length === 0) {
    return { refusal: { status: 404, message: `model ${name} is not served here`, code: 'model_not_found' } };
  }

  const speaking = named.filter((one) => speaks(one, dialect));
  if (speaking.length === 0) {
    const other = DIALECTS.find((one) => one !== dialect && named.some((connector) => speaks(connector, one)));
    const where = other === undefined ? '' : ` is served in ${other}, not ${dialect}: call POST ${CALLER_PATHS[other]}`;
    return { refusal: { status: 404, message: `model ${name}${where}`, code: 'model_not_found' } };
  }

  const adapters = distinct(speaking.map((one) => one.adapter));
  const allowed = new Set<string>();
  let firstRefusal: string | undefined;
  for (const adapter of adapters) {
    const entry: ModelEntry = { provider: adapter, id: fetched.id };
    const refused = options.allowed === undefined ? undefined : await options.allowed(entry);
    if (refused === undefined) allowed.add(adapter);
    else firstRefusal ??= refused;
  }
  if (allowed.size === 0) return { refusal: { status: 403, message: firstRefusal ?? `model ${name} is refused` } };

  const usable = inOrder(speaking.filter((one) => allowed.has(one.adapter)), placesOf(options.caller));
  if (usable.length === 0) {
    return { refusal: { status: 503, message: `model ${name} has no connector this caller may use for ${adapters.join(', ')}` } };
  }

  const catalog = options.catalog;
  return {
    candidates: usable.map((one) => {
      const model = catalog?.modelOf(one, fetched.id);
      const price = catalog?.priceOf(one, fetched.id);
      return {
        connector: one.id,
        provider: one.adapter,
        entry: { provider: one.adapter, id: fetched.id, ...(price === undefined ? {} : { price }) },
        url: upstreamUrl(one.provider.endpoint, dialect),
        ...(one.provider.key === undefined ? {} : { key: one.provider.key }),
        ...(model === undefined ? {} : { model }),
      };
    }),
  };
};

/**
 * The candidates a call of `name` in `dialect` may go to, or the refusal.
 *
 * The filters run in the order the refusals are told: no entry at all, no open
 * connector for the entries, no connector in this dialect, none a policy
 * allows, and none the caller may use. So a name a policy refuses is a 403
 * whatever its connectors, and a connector is only reported unusable for an
 * entry the caller could otherwise have used.
 *
 * A name in the table is answered from the table, even when a provider lists
 * the same spelling: the table is what a person wrote. A name the table does
 * not hold is read as `<prefix>/<id>`.
 */
export async function route(proxy: ProxyConfiguration, name: string, dialect: Dialect, options: RouteOptions): Promise<Routed> {
  const written = Object.hasOwn(proxy.models, name);
  const entries = (written ? proxy.models[name] : undefined) ?? [];
  if (entries.length === 0) {
    const fetched = written ? undefined : fetchedName(name);
    if (fetched === undefined) {
      return { refusal: { status: 404, message: `model ${name} is not served here`, code: 'model_not_found' } };
    }
    return fetchedRoute(name, fetched, dialect, options);
  }

  const places = placesOf(options.caller);
  // An entry naming a provider no open connector answers serves nothing yet.
  const known = entries.filter((entry) => namedBy(entry, options.providers).length > 0);
  if (known.length === 0) {
    return { refusal: { status: 503, message: `model ${name} has no open connector for ${distinct(entries.map((entry) => entry.provider)).join(', ')}` } };
  }

  const speaking = known.filter((entry) => namedBy(entry, options.providers).some((one) => speaks(one, dialect)));
  if (speaking.length === 0) {
    const other = DIALECTS.find((one) => one !== dialect && known.some((entry) => namedBy(entry, options.providers).some((connector) => speaks(connector, one))));
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
  const nowhere: string[] = [];
  for (const entry of allowed) {
    const usable = usableFor(entry, options.providers, places).filter((one) => speaks(one, dialect));
    if (usable.length === 0) {
      nowhere.push(entry.provider);
      continue;
    }
    for (const one of usable) {
      const model = options.catalog?.modelOf(one, entry.id);
      candidates.push({
        connector: one.id,
        provider: one.adapter,
        entry,
        url: upstreamUrl(one.provider.endpoint, dialect),
        ...(one.provider.key === undefined ? {} : { key: one.provider.key }),
        ...(model === undefined ? {} : { model }),
      });
    }
  }
  if (candidates.length === 0) {
    return { refusal: { status: 503, message: `model ${name} has no connector this caller may use for ${distinct(nowhere).join(', ')}` } };
  }
  return { candidates };
}

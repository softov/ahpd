/**
 * The models each open provider connector says it serves, kept in memory.
 *
 * A model is callable as `<prefix>/<id>` without a line in the file, so the
 * proxy has to know each connector's own list. This file holds those lists: one
 * per open provider connector, read the first time the catalog sees the
 * connector, and again each hour. A provider adds models slowly, and a list
 * read at each call would be a fetch per call.
 *
 * A row is keyed by owner and id, because two owners can use one id. A
 * connector that `providers()` no longer lists leaves at the next refresh, and
 * a fetch that fails keeps the list the connector had: a provider having a bad
 * minute must not empty a list that was right an hour ago. The failed fetch is
 * said once, and tried again at the next hour.
 *
 * Nothing here holds a key or a config. A row's `models()` was bound to its open
 * connector by the connectors channel, so the list is read from the resolved
 * config and the key never leaves that channel.
 */

import { reason, type ProviderConnector, type ProviderModel } from '@ahpd/sdk';
import type { ModelPrice } from './providers.js';

/** How long a list is kept before it is read again: an hour. */
export const REFETCH_MS = 60 * 60 * 1_000;

/** One connector's list, the connector it was read from, and when it was read or tried. */
interface Kept {
  connector: ProviderConnector;
  models: readonly ProviderModel[];
  /** When the last fetch ended, whether it answered or failed. */
  at: number;
}

/** One connector and the models it served at the last fetch. */
export interface ListedModels {
  /** The connector the list came from. */
  connector: ProviderConnector;
  /** The models it listed, in the order the provider sent them. */
  models: readonly ProviderModel[];
}

/** What the catalog reads, and where it says a problem. */
export interface CatalogOptions {
  /** The open provider connectors, as the connectors channel lists them. */
  providers(): readonly ProviderConnector[];
  /** Where a connector whose list could not be read is said. */
  onProblem?(line: string): void;
  /** How long a list is kept; an hour when absent. */
  everyMs?: number;
}

/** The lists of the open provider connectors, as of the last refresh. */
export interface ModelCatalog {
  /**
   * Read the list of every connector the catalog has not seen, or has not read
   * this hour, and drop the connectors that are no longer open.
   *
   * One refresh runs at a time: a second call while one is running answers
   * that same promise, so a list request never fetches a connector twice.
   */
  refresh(): Promise<void>;
  /** Every connector's list, in owner and id order. */
  listed(): readonly ListedModels[];
  /** One model a connector listed, by the provider's own id. */
  modelOf(connector: ProviderConnector, id: string): ProviderModel | undefined;
  /** What that model costs there, in the entry's units: dollars per million tokens. */
  priceOf(connector: ProviderConnector, id: string): ModelPrice | undefined;
  /** Stop the hourly refresh, as a shutdown does. */
  stop(): void;
}

/** A connector's place in the catalog: its owner and its id, which only together name one. */
export const keyOf = (connector: ProviderConnector): string => `${connector.owner}/${connector.id}`;

/** What comes before a fetched model's id: what the provider says, or the adapter's name. */
export const prefixOf = (connector: ProviderConnector): string => connector.provider.prefix ?? connector.adapter;

/**
 * Dollars per million tokens, from a price the provider writes per token.
 *
 * OpenRouter writes `"0.000003"`, and a figure small enough to be written in
 * exponent form keeps every digit it was given. Six places is a tenth of a cent
 * per million tokens, which is finer than any price a provider writes. Nothing
 * when the value is not a number, because a price nobody can read is no price.
 */
const perMillion = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined;
  const token = Number(value);
  if (!Number.isFinite(token)) return undefined;
  return Number((token * 1_000_000).toFixed(6));
};

/** What one listed model costs, or nothing when the provider prices neither side. */
const priceOfModel = (model: ProviderModel | undefined): ModelPrice | undefined => {
  if (model === undefined) return undefined;
  const input = perMillion(model.pricing?.prompt);
  const output = perMillion(model.pricing?.completion);
  if (input === undefined && output === undefined) return undefined;
  return { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) };
};

/**
 * The catalog over one host's provider connectors.
 *
 * The hourly timer does not hold the process open, so a daemon with a catalog
 * still exits when its work is done.
 */
export const modelCatalog = (options: CatalogOptions): ModelCatalog => {
  const everyMs = options.everyMs ?? REFETCH_MS;
  const rows = new Map<string, Kept>();
  let running: Promise<void> | undefined;

  /** Read one connector's list, keeping the list it had when the read fails. */
  const readOne = async (connector: ProviderConnector, before: readonly ProviderModel[]): Promise<void> => {
    let models = before;
    const read = connector.models;
    if (read !== undefined) {
      try { models = await read(); }
      catch (error) { options.onProblem?.(`${connector.id} lists no models: ${reason(error)}`); }
    }
    rows.set(keyOf(connector), { connector, models, at: Date.now() });
  };

  const refresh = (): Promise<void> => {
    running ??= (async (): Promise<void> => {
      const open = options.providers();
      const present = new Set(open.map(keyOf));
      for (const key of [...rows.keys()]) if (!present.has(key)) rows.delete(key);
      const now = Date.now();
      // One connector at a time, so a slow provider does not stagger the others.
      for (const connector of open) {
        const key = keyOf(connector);
        const row = rows.get(key);
        if (row === undefined) { await readOne(connector, []); continue; }
        if (now - row.at < everyMs) { rows.set(key, { ...row, connector }); continue; }
        await readOne(connector, row.models);
      }
    })().finally(() => { running = undefined; });
    return running;
  };

  const timer = setInterval(() => { void refresh(); }, everyMs);
  timer.unref();

  const find = (connector: ProviderConnector, id: string): ProviderModel | undefined =>
    rows.get(keyOf(connector))?.models.find((one) => one.id === id);

  return {
    refresh,
    listed: () => [...rows.values()]
      .sort((one, two) => keyOf(one.connector).localeCompare(keyOf(two.connector)))
      .map((row) => ({ connector: row.connector, models: row.models })),
    modelOf: find,
    priceOf: (connector, id) => priceOfModel(find(connector, id)),
    stop: () => { clearInterval(timer); },
  };
};

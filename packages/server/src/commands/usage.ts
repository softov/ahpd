/**
 * `ahpd usage [pool]`: what this host has been charged, per pool.
 *
 * The store and the periods are the ones the `usage:` scheme already serves, so
 * this command asks the same provider a client asks rather than holding a second
 * copy of the rule about who may read what. Served, the store is the daemon's
 * own and `usage.timezone` is the daemon's own configuration, so neither a
 * request nor a flag can name another one.
 */

import { join } from 'node:path';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { HttpError } from '@cofold/remote';
import { fileUsage, RpcError, usageProvider } from '@ahpd/sdk';
import type { Principal, Usage, UsageProvider } from '@ahpd/sdk';
import { configDir, loadConfig } from '../config.js';
import { flagFields, stop } from './options.js';
import type { ServedFacts } from './served.js';
import { bounded } from './user.js';

/**
 * The store and the zone this run reads.
 *
 * Served, both are the daemon's. On a line they come from the configuration
 * this process reads, the way `people` reads the users file: a verb that let a
 * flag name a folder would answer about a store nothing was charged to.
 */
const storeOf = (
  context: { input: Readonly<Record<string, unknown>>; error(text: string): void },
  served?: ServedFacts,
): { store: Usage; zone: string | undefined } => {
  if (served !== undefined) {
    if (served.usage === undefined) stop('This daemon has no usage store, so it has nothing to say it spent.');
    return { store: served.usage(), zone: served.options.usageTimezone };
  }
  const input = context.input;
  const from = loadConfig(typeof input['configFile'] === 'string' ? input['configFile'] : undefined).values;
  return {
    store: fileUsage({
      folder: join(configDir(), 'usage'),
      onProblem: (line) => { context.error(line); },
    }),
    zone: from.usage?.timezone,
  };
};

/** The provider over that store, which is where both the listing and the totals come from. */
const over = (store: Usage, zone: string | undefined, error: (line: string) => void): UsageProvider =>
  usageProvider({ usage: store, ...(zone === undefined ? {} : { timezone: zone }), onProblem: error });

/**
 * The provider's own refusal, said as this surface's.
 *
 * A pool that is not the caller's is refused by the scheme's rule, and the
 * sentence is the one the host says over the socket. Only the status is this
 * surface's to choose: `serve()` maps an `RpcError` to a 500, and the refusal is
 * a 403 whichever transport asked.
 */
const refusal = (error: unknown): never => {
  if (error instanceof RpcError && error.code === -32009) throw new HttpError(403, error.message);
  throw error;
};

/** What a total says: the measures it holds, and nothing for one it does not. */
const measures = (total: Record<string, number>): string => {
  const said = Object.entries(total).map(([name, value]) => `${name} ${String(value)}`);
  return said.length === 0 ? 'nothing' : said.join(' ');
};

/** One pool of the listing. */
export interface PoolRow {
  /** The pool as a record was charged to it. */
  pool: string;
}

/** One pool as it reads: the three periods, each a `UsageTotal`. */
export interface TotalsRow {
  pool: string;
  day: Record<string, number>;
  week: Record<string, number>;
  month: Record<string, number>;
}

/**
 * The listing and the single read, as two declarations.
 *
 * They are two rather than one because a route's `{param}` is required: one
 * command binding an optional pool would leave `GET /usage/{pool}` unreachable,
 * which `serve()` refuses at the mount. The words a person types - `usage`, and
 * `usage <pool>` - are unchanged.
 */
export const declareUsage = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  /*
   * No grant of its own, because the question a declaration cannot answer is
   * whether the pool is the caller's own: a person reads their own, their teams'
   * and their projects' pools, and another person's needs `usage:read`. The body
   * holds the caller instead, which is what `user primary` does for the same
   * reason.
   */
  const fields = {
    // Served, the store is the daemon's own, so no field could name another.
    ...(served === undefined ? flagFields : {}),
  };

  const list = registry.action({
    id: 'usage.list',
    summary: 'The pools this host was charged that the caller may see',
    description: 'Every pool a record was charged to that this caller may see, which is the usage: scheme\'s own root listing. What one of them spent is `ahpd usage <pool>`.',
    surfaces: { cli: { pattern: ['usage'] }, http: { method: 'GET', path: '/usage' } },
    // No key: this is the listing, and each row carries the `pool` the read
    // below takes.
    effect: 'read',
    resource: { kind: 'pool' },
    scopes: [],
    input: fields,
    run: async (context) => {
      // There is a caller, and holding nothing further is the whole of it: which
      // pools are theirs is the provider's question, not a declaration's.
      bounded(context, []);
      const { store, zone } = storeOf(context, served);
      const provider = over(store, zone, (line) => { context.error(line); });
      const actor = context.request?.actor as Principal | undefined;
      const rows: PoolRow[] = (await provider.list('usage://', actor).catch(refusal)).map((one) => ({ pool: one.name }));
      return output(rows, rows.length === 0 ? 'no pools\n' : `${rows.map((one) => `${one.pool}\n`).join('')}`);
    },
  });

  const show = registry.action({
    id: 'usage.show',
    summary: 'What one pool spent today, this week and this month',
    description: 'The three periods, cut in usage.timezone. The records behind them are read through the usage: scheme, at usage://<pool>/records.',
    surfaces: { cli: { pattern: ['usage', ':pool'] }, http: { method: 'GET', path: '/usage/{pool}' } },
    effect: 'read',
    resource: { kind: 'pool', key: 'pool' },
    scopes: [],
    input: {
      ...fields,
      pool: { type: 'string', description: 'Which pool to read, as a record was charged to it.' },
    },
    required: ['pool'],
    run: async (context) => {
      bounded(context, []);
      const { store, zone } = storeOf(context, served);
      const provider = over(store, zone, (line) => { context.error(line); });
      const actor = context.request?.actor as Principal | undefined;
      const pool = context.value<string>('pool');
      const read = await provider.read(`usage://${encodeURIComponent(pool)}`, undefined, actor).catch(refusal);
      const totals = JSON.parse(read.data) as TotalsRow;
      const text = `${totals.pool}\n`
        + `  today       ${measures(totals.day)}\n`
        + `  this week   ${measures(totals.week)}\n`
        + `  this month  ${measures(totals.month)}\n`;
      return output(totals, text);
    },
  });

  return [list, show];
};
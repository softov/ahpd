/**
 * What the host keeps about its work, and what a pool has been charged.
 *
 * Two halves and one port. `fileUsage` is the store: JSON lines in a folder,
 * with the totals of open periods in memory. `usageProvider` is the `usage:`
 * scheme the store is read through, so a client uses the resource path it
 * already has rather than a command of its own.
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { limitsOf, measureOf } from './charge.js';
import { refusalReason } from '../host.js';
import { periodOf, shown, zoneOf } from './periods.js';
import type { MinuteMeter } from './minute.js';
import { absentResource, asFile, EPOCH, splitResource, type At as Split } from '../resources/records.js';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { mayRead, membership } from './scopes.js';
import { currentOwner } from '../utils/values.js';
import type { PolicyLimits } from '../access/policy.js';
import type { Policies, Policy } from '../types/policies.js';
import type { Entry, Metadata, Read, ResourceProvider, SchemeDescription } from '../types/resources.js';
import type { PluginMethod } from '../types/plugin.js';
import type { Grant, Named, Principal } from '../types/users.js';
import type { Cost, Usage, UsageEntry, UsageGroup, UsageKey, UsageTotal } from '../types/usage.js';

/** An hour, which is what computer time is reported in. */
const HOUR_S = 3_600;

/** The measures a record hands to the minute meter: the ones it knows by the time it ends. */
const METERED = ['usd', 'tokens', 'hours'] as const;

type Metered = typeof METERED[number];

/**
 * The measure a pool key is counted in, read with `measureOf`.
 *
 * `policy:A3/tokens` and `policy:A3/tokens/user:alice` are counted in `tokens`,
 * and `policy:A3/calls` in `calls`. Only the first is a measure the meter keeps:
 * a call is counted when it is allowed, because a call counted at its record
 * lets a burst through.
 */
const meterKey = (pool: string): Metered | undefined => {
  if (!pool.includes('/')) return undefined;
  const measure = measureOf(pool);
  return METERED.find((one) => one === measure);
};

/** What one record costs, in the measures the port reports. */
interface Measured {
  usd: number;
  providerUsd: number;
  inputUsd: number;
  outputUsd: number;
  tokens: number;
  input: number;
  output: number;
  cache: number;
  calls: number;
  turns: number;
  hours: number;
}

const none = (): Measured => ({
  usd: 0, providerUsd: 0, inputUsd: 0, outputUsd: 0, tokens: 0, input: 0, output: 0, cache: 0, calls: 0, turns: 0, hours: 0,
});

/** Add one measure to another, in place. */
const addTo = (sum: Measured, what: Measured): void => {
  sum.usd += what.usd;
  sum.providerUsd += what.providerUsd;
  sum.inputUsd += what.inputUsd;
  sum.outputUsd += what.outputUsd;
  sum.tokens += what.tokens;
  sum.input += what.input;
  sum.output += what.output;
  sum.cache += what.cache;
  sum.calls += what.calls;
  sum.turns += what.turns;
  sum.hours += what.hours;
};

/** A sum as the port reports it: a measure nothing was charged in is absent rather than zero. */
const reported = (sum: Measured): UsageTotal => {
  const out: UsageTotal = {};
  if (sum.usd !== 0) out.usd = sum.usd;
  if (sum.providerUsd !== 0) out.providerUsd = sum.providerUsd;
  if (sum.inputUsd !== 0) out.inputUsd = sum.inputUsd;
  if (sum.outputUsd !== 0) out.outputUsd = sum.outputUsd;
  if (sum.tokens !== 0) out.tokens = sum.tokens;
  if (sum.input !== 0) out.input = sum.input;
  if (sum.output !== 0) out.output = sum.output;
  if (sum.cache !== 0) out.cache = sum.cache;
  if (sum.calls !== 0) out.calls = sum.calls;
  if (sum.turns !== 0) out.turns = sum.turns;
  if (sum.hours !== 0) out.hours = sum.hours;
  return out;
};

/** A number the record meant, or zero: a count nothing was told is not a count. */
const counted = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Whether a cost is denominated in the dollars a total sums. */
const inUsd = (cost: Cost | undefined): boolean =>
  cost !== undefined && typeof cost.currency === 'string' && cost.currency.toLowerCase() === 'usd';

/** One instant of a day, which is what the totals are kept per. */
const DAY = /^\d{4}-\d{2}-\d{2}/u;

/** The file a record of this kind and month belongs in. The month is in the name, not in a line. */
const FILE = /^(\d{4}-\d{2})-(model|computer)\.jsonl$/u;

/** How many records one read answers at most, so a folder with a year of them is still a page. */
const KEPT = 200;

/** One record as the files hold it, with the day it was charged on. */
interface Placed {
  entry: UsageEntry;
  day: string;
}

export interface FileUsageOptions {
  /**
   * The folder the files go in, one per month and kind.
   *
   * A folder rather than a path, because the month and the kind are in the file
   * names and a caller naming a folder says where usage belongs without having
   * to invent the naming. `run.ts` gives the daemon's own data folder, beside
   * the sessions and the automations.
   */
  folder: string;
  /**
   * The IANA zone the totals are kept in, as `America/Sao_Paulo` writes it.
   *
   * Absent is the system's own zone. A record is kept under the local day it
   * happened on, so a period summed over that zone holds the records that
   * happened inside it and no hours of the period before. `run.ts` gives the
   * same zone the `usage:` scheme cuts its periods in.
   */
  timezone?: string;
  /**
   * The meter a record feeds, so a `minute` limit reads what this minute used.
   *
   * Absent, no total finer than a day is kept, and a `minute` limit reads zero.
   * The daemon builds one meter and gives it here and to every charge walk, so
   * the store and the walk count the same minutes. Only `tokens`, `usd` and
   * `hours` are added: a call is counted when it is allowed, not when its
   * record is written.
   */
  meter?: MinuteMeter;
  /** Somewhere to say that a record could not be kept or a line could not be read. */
  onProblem?(message: string): void;
}

/**
 * Usage in JSON lines, one file per month and kind, and the totals in memory.
 *
 * Append-only, because a record is written once and is never edited: a second
 * line for the same call would be a different record, and the day's totals are
 * the sum rather than the last word. The month and kind are in the file name,
 * and each line still carries its `kind` so a line read alone says what it is.
 *
 * **Totals per pool per day, rebuilt at construction.** A limit is checked
 * before a call and debited as usage arrives, so the answer has to be a running
 * one rather than a read of the month's file. A day is the granularity, which is
 * exact for the ranges a limit asks about and counts a partly covered day
 * whole. A day is the local day in `usage.timezone`, so a period summed over
 * that zone holds the records that happened inside it. A large install moves the
 * totals into a database plugin, which answers the same calls from the same
 * records.
 *
 * **The pools and the records behind the totals read the files.** The totals
 * are charged in memory because a limit asks them mid-turn, but a report wants
 * what was charged and to what, and the lines are the whole of that. Neither read goes through the queue
 * below: it is what `record` is serialised against, and a line is already whole
 * on disk because one append writes it.
 *
 * **One queue behind `record`.** The port is written for several writers, and
 * two lines appended at once can interleave into one line that reads back as
 * neither record. Every append is therefore chained behind the one before it,
 * and the chain is kept on its settled tail so a write that failed does not
 * leave every later record waiting on a rejection.
 */
export function fileUsage(options: FileUsageOptions): Usage {
  const folder = options.folder;
  const told = (message: string): void => { options.onProblem?.(message); };
  // Resolved once, where the store is built, so every line it keeps and every
  // range it sums is cut in one zone and a bad one is said once.
  const zone = zoneOf(options.timezone, told);

  /** What each pool has been charged on each day, as `pool` then `YYYY-MM-DD`. */
  const held = new Map<string, Map<string, Measured>>();

  /** The day an instant falls on in the store's zone, which is the day it is kept under. */
  const todayIn = (at: Date): string => shown(zone, at).toISOString().slice(0, 10);

  /**
   * The zoned day a date or instant falls on, or nothing when it is not one.
   *
   * A bare date already names a day in the zone a range is read over and is
   * taken as written; an instant names a moment, which is that moment's wall
   * clock in the store's zone. Treating a date as midnight UTC and shifting it
   * would put a client's `2026-09-29` on the day before in every zone west of
   * Greenwich.
   */
  const dayIn = (at: string): string | undefined => {
    if (!DAY.test(at)) return undefined;
    if (at.length === 10) return at;
    const when = new Date(at);
    return Number.isNaN(when.getTime()) ? undefined : todayIn(when);
  };

  /**
   * The day a record falls on, or nothing when it names no instant.
   *
   * A record is kept because of when it happened: that is what puts it in a
   * month and what a total is summed by. The day is the wall clock in the
   * store's zone, so a period summed over it holds the records that happened
   * inside the period and no hours of the period before. One that names no day
   * is reported and kept nowhere, which is the only answer that is not a charge
   * in the wrong place.
   */
  const dayOf = (entry: UsageEntry): string | undefined =>
    typeof entry.at === 'string' ? dayIn(entry.at) : undefined;

  /** What this record is charged, in the measures a total reports. */
  const measured = (entry: UsageEntry): Measured => {
    if (entry.kind === 'model') {
      /*
       * Every token the provider handled, the cache included: those are tokens
       * it billed, and a measure that left them out would not match the cost
       * beside it. The three counts are kept apart as well, so a report can say
       * what was sent and what came back.
       */
      const input = counted(entry.model.input);
      const output = counted(entry.model.output);
      const cache = counted(entry.model.cache?.read) + counted(entry.model.cache?.write);
      const cost = entry.cost;
      /*
       * A record written before there were two costs has only `cost`. One the
       * harness reported was the provider's own figure, so it is that too; one
       * worked out from a price list was this host's charge alone.
       */
      const provider = entry.providerCost ?? (cost?.from === 'harness' ? cost : undefined);
      return {
        usd: inUsd(cost) ? counted(cost?.amount) : 0,
        providerUsd: inUsd(provider) ? counted(provider?.amount) : 0,
        // Only the records that split their cost have a side to add.
        inputUsd: inUsd(cost) ? counted(cost?.input) : 0,
        outputUsd: inUsd(cost) ? counted(cost?.output) : 0,
        tokens: input + output + cache,
        input,
        output,
        cache,
        calls: 1,
        // A turn is the one record that opened it, however many records follow.
        turns: entry.opens === true ? 1 : 0,
        hours: 0,
      };
    }
    const span = counted(entry.seconds) / HOUR_S;
    return {
      usd: 0, providerUsd: 0, inputUsd: 0, outputUsd: 0, tokens: 0, input: 0, output: 0, cache: 0, calls: 0,
      turns: 0, hours: span > 0 ? span : 0,
    };
  };

  /** The pools one record is charged to, and nothing it does not name with a string. */
  const poolsOf = (entry: UsageEntry): string[] =>
    Array.isArray(entry.pools) ? entry.pools.filter((one): one is string => typeof one === 'string') : [];

  /**
   * Add one record's amount to the meter, for each pool key that names a
   * measure it counts.
   *
   * The meter is fed here rather than at `charge`, which is also the reading of
   * the folder at construction: a total kept for the last two minutes from a
   * previous run is a minute this daemon did not count.
   */
  const metered = (entry: UsageEntry): void => {
    const meter = options.meter;
    if (meter === undefined || typeof entry.at !== 'string') return;
    const at = new Date(entry.at);
    if (Number.isNaN(at.getTime())) return;
    const what = measured(entry);
    for (const pool of poolsOf(entry)) {
      const measure = meterKey(pool);
      if (measure !== undefined) meter.add(pool, what[measure], at);
    }
  };

  /** Add one record to every pool it names. */
  const charge = (entry: UsageEntry, day: string): void => {
    const pools = poolsOf(entry);
    const what = measured(entry);
    for (const pool of pools) {
      const days = held.get(pool) ?? new Map<string, Measured>();
      const charged = days.get(day) ?? none();
      addTo(charged, what);
      days.set(day, charged);
      held.set(pool, days);
    }
  };

  /** The queue every append is chained behind, kept on its settled tail. */
  let queue: Promise<void> = Promise.resolve();
  const serialise = <T>(work: () => T): Promise<T> => {
    const run = queue.then(work);
    queue = run.then(() => {}, () => {});
    return run;
  };

  try { mkdirSync(folder, { recursive: true }); }
  catch (error) { told(`Could not make ${folder} for usage: ${error instanceof Error ? error.message : String(error)}`); }

  /** Every usage file in the folder, by month and kind, oldest month first. */
  const months = (): string[] => {
    let names: string[];
    try { names = readdirSync(folder); }
    catch { return []; }
    return names.filter((name) => FILE.test(name)).sort();
  };

  /**
   * One file's records, with the lines that are not records said out loud.
   *
   * The one reading of a line there is, and `pools` and `records` go through
   * this rather than reading the folder a second time with another idea of what
   * a line is: a line one of them skips is a line the other would have shown a
   * client. A file that is not JSON, is JSON that is not a record, or names no
   * day, is skipped and reported - one torn line is worth saying out loud and is
   * not worth losing the month's other entries over.
   */
  const entriesIn = (name: string): Placed[] => {
    let text: string;
    try { text = readFileSync(join(folder, name), 'utf8'); }
    catch (error) { told(`Could not read usage file ${name}: ${error instanceof Error ? error.message : String(error)}`); return []; }
    const placed: Placed[] = [];
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trim() === '') continue;
      let entry: UsageEntry;
      try { entry = JSON.parse(line) as UsageEntry; }
      catch { told(`Skipping line ${String(index + 1)} of usage file ${name}: it is not JSON.`); continue; }
      if (typeof entry !== 'object' || entry === null || !Array.isArray(entry.pools)
        || (entry.kind !== 'model' && entry.kind !== 'computer')
        || (entry.kind === 'model' && (typeof entry.model !== 'object' || entry.model === null))) {
        told(`Skipping line ${String(index + 1)} of usage file ${name}: it is not a usage record.`);
        continue;
      }
      const day = dayOf(entry);
      if (day === undefined) {
        told(`Skipping line ${String(index + 1)} of usage file ${name}: it names no day.`);
        continue;
      }
      // An owner or a pool saved under a first-party plugin's old name is read as its id.
      const pools = entry.pools.map((pool) => (typeof pool === 'string' ? currentOwner(pool) : pool));
      const owner = typeof entry.owner === 'string' ? { owner: currentOwner(entry.owner) as typeof entry.owner } : {};
      placed.push({ entry: { ...entry, ...owner, pools }, day });
    }
    return placed;
  };

  /*
   * Every month's file, read once here.
   *
   * A folder that is not there yet is a first run rather than a failure. This is
   * the same shape as the session store's load, which reads once at
   * construction because a daemon reads one small file at startup and never
   * again - and what it reads is `entriesIn`, the reading `pools` and `records`
   * ask for as well.
   */
  const load = (): void => {
    for (const name of months()) for (const one of entriesIn(name)) charge(one.entry, one.day);
  };

  load();

  return {
    record: (entry) => serialise(() => {
      const day = dayOf(entry);
      if (day === undefined) {
        told(`Not keeping a usage record with no readable date: ${String(entry.at)}`);
        return;
      }
      /*
       * The file is named by the record's UTC month and not by the day it is
       * charged under: the day moves with the store's zone, and the files on
       * disk do not.
       */
      const file = join(folder, `${new Date(entry.at).toISOString().slice(0, 7)}-${entry.kind}.jsonl`);
      try { appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 }); }
      catch (error) { told(`Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`); }
      /*
       * Charged whatever the write did, because a total that forgets a record
       * the file holds is a limit that does not fire. A store another process
       * can write is not one this store's memory can account for, which is why
       * a shared store is a plugin answering the same calls rather than this one
       * with a lock.
       */
      charge(entry, day);
      metered(entry);
    }),
    total: async (pool, from, until) => {
      const days = held.get(pool);
      const sum = none();
      if (days !== undefined) {
        /*
         * Days as they are written sort as they are read, so the range is two
         * comparisons. Both ends are days rather than instants, which is the
         * granularity the totals are kept at.
         */
        const first = dayIn(from) ?? '';
        const last = dayIn(until) ?? '';
        for (const [day, charged] of days) {
          if (day < first || day > last) continue;
          addTo(sum, charged);
        }
      }
      return reported(sum);
    },
    pools: async () => {
      const seen = new Set<string>();
      for (const name of months()) {
        for (const one of entriesIn(name)) for (const pool of poolsOf(one.entry)) seen.add(pool);
      }
      return [...seen].sort();
    },
    records: async (pool, from, until) => {
      /*
       * The same two day comparisons `total` makes, on the same defaults: the
       * first day of the month in the store's zone, and its day now. A partly
       * covered day counts whole here as it does there, which is what makes the
       * records behind a period's total the records that total summed.
       */
      const now = new Date();
      const today = todayIn(now);
      const first = from === undefined ? `${today.slice(0, 7)}-01` : dayIn(from) ?? '';
      const last = until === undefined ? today : dayIn(until) ?? '';
      const found: UsageEntry[] = [];
      // The newest month first and each month's lines reversed, which is the
      // order the records were written in. A month holds a file per kind, so
      // this is what the answer is sorted on: two lines written in the same
      // month under different kinds are two files apart, and only the instants
      // say which came first.
      for (const name of [...months()].reverse()) {
        for (const one of entriesIn(name).reverse()) {
          if (one.day < first || one.day > last) continue;
          if (!poolsOf(one.entry).includes(pool)) continue;
          found.push(one.entry);
        }
      }
      found.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return found.slice(0, KEPT);
    },
    groups: async (by, from, until, keep) => {
      /*
       * Each record of the range read once, from the lines rather than the
       * totals in memory: a total is kept per pool, and a record charged to
       * three pools is in three of them, so no sum of pool totals counts it
       * once.
       */
      const first = dayIn(from) ?? '';
      const last = dayIn(until) ?? '';
      const rows = new Map<string, { keys: UsageGroup['keys']; sum: Measured }>();
      for (const name of months()) {
        for (const one of entriesIn(name)) {
          if (one.day < first || one.day > last) continue;
          if (!keep(poolsOf(one.entry))) continue;
          const keys = keysOf(one.entry, by);
          const id = JSON.stringify(by.map((key) => keys[key] ?? ''));
          const row = rows.get(id) ?? { keys, sum: none() };
          addTo(row.sum, measured(one.entry));
          rows.set(id, row);
        }
      }
      // Sorted by the key values, and a key the records had none of before any value.
      return [...rows.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, row]) => ({ keys: row.keys, total: reported(row.sum) }));
    },
  };
}

/**
 * The pool key a record is summed under for each key asked for.
 *
 * `user` is the owner, `team` is `team:<team>` and `project` is
 * `project:<team>:<project>`, the spellings `meter.ts` charges the record's
 * pools under. A key the record has none of is left out.
 */
const keysOf = (entry: UsageEntry, by: readonly UsageKey[]): UsageGroup['keys'] => {
  const keys: UsageGroup['keys'] = {};
  const team = typeof entry.team === 'string' && entry.team !== '' ? entry.team : undefined;
  const project = typeof entry.project === 'string' && entry.project !== '' ? entry.project : undefined;
  for (const key of by) {
    if (key === 'user' && typeof entry.owner === 'string') keys.user = entry.owner;
    if (key === 'team' && team !== undefined) keys.team = `team:${team}`;
    if (key === 'project' && team !== undefined && project !== undefined) keys.project = `project:${team}:${project}`;
  }
  return keys;
};

/*
 * The `usage:` scheme.
 *
 * Leaves under a pool, a root listing and two reads of the root, through the
 * resource calls a client already uses: `usage://` lists the charged pools the
 * reader may read, a pool reads its kind, name, day, week and month, `range`
 * reads a total between two days, `records` reads what was charged,
 * `usage://groups` sums the records by user, team and project, and
 * `usage://limits` answers each policy whose scope holds the reader. There is
 * no manifest and nothing is made here, which is why `describe` has no body for
 * a create form to draw.
 *
 * The store answers every question below; the provider is the shape the answer
 * arrives in, and the reader is what decides which pools it arrives for.
 */

/**
 * What this provider implements.
 *
 * Narrower than `ResourceProvider`, whose members are all but `read` optional:
 * this one has all of them but the write half, which usage has none of.
 */
export interface UsageProvider extends ResourceProvider {
  list(uri: string, reader?: Principal): Promise<Entry[]>;
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  read(uri: string, wanted?: string, reader?: Principal): Promise<Read>;
  describe(): SchemeDescription;
  authorize(uri: string, reader: Principal | undefined): Promise<boolean>;
  /** Each read's answer as a value, which `read` gives as JSON text. */
  answers: UsageAnswers;
}

/** A pool, by its key, kind and the name a person reads it by. */
export interface UsagePool {
  pool: string;
  kind: string;
  name: string;
}

/** A pool's day, week and month, as `usage://<pool>` answers them. */
export interface UsagePeriods extends UsagePool {
  day: UsageTotal;
  week: UsageTotal;
  month: UsageTotal;
}

/** One row of `usage://groups`: the pool of each key, its name, and what it was charged. */
export interface UsageNamedGroup {
  keys: UsageGroup['keys'];
  names: Partial<Record<UsageKey, string>>;
  total: UsageTotal;
}

/**
 * The answers behind the `usage:` reads, each from typed arguments.
 *
 * `from` and `until` are a date, as 2026-10-01, or an ISO 8601 instant; absent,
 * they are the first day of the month in the provider's zone, and now. None of
 * these asks whether a reader may read a pool, except `pools` and `groups`,
 * which count only what the reader may read; `readable` is that question.
 */
export interface UsageAnswers {
  /** The pools something was charged to that this reader may read. */
  pools(reader: Principal | undefined): Promise<UsagePool[]>;
  /** Whether this reader may read this pool. */
  readable(reader: Principal | undefined, pool: string): boolean;
  /** A pool's day, week and month, as `usage://<pool>`. */
  periods(pool: string): Promise<UsagePeriods>;
  /** A pool's total over a range, as `usage://<pool>/range`. */
  range(pool: string, from?: string, until?: string): Promise<UsageTotal>;
  /** The records charged to a pool over a range, as `usage://<pool>/records`. */
  records(pool: string, from?: string, until?: string): Promise<UsageEntry[]>;
  /** The records this reader may read, summed by these keys, as `usage://groups`. */
  groups(by: readonly string[], from: string | undefined, until: string | undefined, reader: Principal | undefined): Promise<UsageNamedGroup[]>;
  /** Each active row whose scope holds the reader, with its limits, as `usage://limits`. */
  limits(reader: Principal | undefined): Promise<PolicyLimits[]>;
}

/** What the provider was built around. */
export interface UsageProviderOptions {
  /** The store to read, which is the only thing that knows what a pool holds. */
  usage: Usage;
  /**
   * The IANA zone the periods are cut in, as `America/Sao_Paulo` writes it.
   *
   * Absent is the system's own zone. A day here begins at local midnight rather
   * than at UTC midnight, so a person whose week starts on their Monday is not
   * handed a week that started the evening before.
   */
  timezone?: string;
  /**
   * The titles a pool is named with: the teams and projects the people
   * directory holds, which a `Users` port answers.
   *
   * Absent, a pool is named by its ids.
   */
  titles?: {
    teams(): Promise<Named[]>;
    projects(): Promise<Named[]>;
  };
  /**
   * The policies whose limits `usage://limits` answers.
   *
   * Absent, the leaf is not served: a host with no policies has no limit to
   * read, and an absent scheme is a better answer than an empty one.
   */
  policies?: Policies;
  /**
   * Whether a person reads the limits whose scope holds them.
   *
   * On by default. Off, `usage://limits` is refused, and an operator holding
   * `policy:read` still reads every row through `policy://<id>/limits`.
   */
  ownLimits?: boolean;
  /**
   * What each key used in this minute, which a `minute` limit in this read
   * answers.
   *
   * The store keeps no total finer than a day, so the read needs the daemon's
   * meter to answer the same figure the walk checks against. Absent, a `minute`
   * limit reads zero.
   */
  meter?: MinuteMeter;
  /** Somewhere to say that the zone or the titles could not be read. */
  onProblem?(message: string): void;
}

/** A URI, split into the pool it names and the leaf under it. */
interface At {
  /** The pool, decoded, empty at the root. */
  pool: string;
  /** `day`, `week`, `month`, `range` or `records`, empty for the pool itself. */
  leaf: string;
  /** What the query asked for. */
  asked: URLSearchParams;
}

/**
 * The leaves a pool reads: the three periods, a total over any range, and the
 * records behind them.
 */
const LEAVES = ['day', 'week', 'month', 'range', 'records'] as const;

/**
 * The read at the scheme's root that sums records by key.
 *
 * Not a pool, because a pool key holds a `:` and this does not.
 */
const GROUPS = 'groups';

/**
 * The read at the scheme's root that answers the limits a person may see.
 *
 * Not a pool either, for the same reason: a pool key holds a `:`, and no
 * record is charged to a key named for this read.
 */
const LIMITS = 'limits';

/** The keys a grouped read may sum by. */
const KEYS: readonly UsageKey[] = ['user', 'team', 'project'];

/**
 * Where a `usage:` URI points, or nothing when it is another scheme's.
 *
 * The pool is one encoded path segment because a pool name holds colons:
 * `usage://project%3Abackend%3Asearch` is the pool `project:backend:search` and
 * not an authority called `project`, which is the reading the plan settled on.
 * A URI of another scheme and a pool that does not decode are both nothing
 * here, and `at` is what turns either into a refusal.
 */
const split = (uri: string): At | undefined => {
  let held: Split;
  try { held = splitResource(uri, 'usage'); }
  catch { return undefined; }
  try {
    return {
      // A first-party plugin's old name reads as its id, as a saved line does.
      pool: currentOwner(decodeURIComponent(held.id)),
      leaf: decodeURIComponent(held.leaf),
      asked: new URLSearchParams(held.query),
    };
  }
  catch { return undefined; }
};

const at = (uri: string): At => {
  const held = split(uri);
  if (held === undefined) throw new RpcError(INVALID_PARAMS, `${uri} is not a usage: URI`);
  return held;
};

export function usageProvider(options: UsageProviderOptions): UsageProvider {
  const store = options.usage;
  const zone = zoneOf(options.timezone, (message) => { options.onProblem?.(message); });

  /**
   * Whether this reader may see this pool.
   *
   * A reader behind no read at all is the root connection or a host with no
   * users directory, and sees everything; so does a reader holding
   * `usage:read`. The rest see what `mayRead` answers: their own pool, their
   * teams' and their projects'.
   */
  const refused = (reader: Principal | undefined, pool: string): boolean =>
    reader !== undefined && pool !== ''
    && !reader.can('usage:read')
    && !mayRead(reader, pool);

  /**
   * Said as the host would have said it.
   *
   * The gate has already let the read through by the time this runs, so this is
   * the last refusal rather than the first, and it is the host's own sentence:
   * `<id> may not usage:read here`.
   */
  const notYours = (reader: Principal | undefined, pool: string): void => {
    if (refused(reader, pool)) throw new RpcError(-32009, refusalReason((reader as Principal).id, 'usage:read'));
  };

  /**
   * The pools something was charged to that this reader may read.
   *
   * The same rows for root and for a member, for the same work: a pool nothing
   * was charged to is listed for neither.
   */
  const visible = async (reader: Principal | undefined): Promise<string[]> =>
    (await store.pools()).filter((pool) => !refused(reader, pool));

  /** Whether a record charged to these pools is one this reader may count. */
  const keeper = (reader: Principal | undefined) => (pools: readonly string[]): boolean =>
    pools.some((pool) => !refused(reader, pool));

  /** The titles of the teams and projects, by id, or none when they could not be read. */
  const titled = async (): Promise<{ teams: Map<string, string>; projects: Map<string, string> }> => {
    const byId = (named: Named[]): Map<string, string> =>
      new Map(named.flatMap((one) => (typeof one.title === 'string' && one.title !== '' ? [[one.id, one.title] as const] : [])));
    if (options.titles === undefined) return { teams: new Map(), projects: new Map() };
    try {
      const [teams, projects] = await Promise.all([options.titles.teams(), options.titles.projects()]);
      return { teams: byId(teams), projects: byId(projects) };
    } catch (error) {
      options.onProblem?.(`Could not read the titles usage pools are named with: ${error instanceof Error ? error.message : String(error)}`);
      return { teams: new Map(), projects: new Map() };
    }
  };

  /**
   * A pool's kind and the name a person reads it by.
   *
   * The kind is the key's prefix. The name is the user's id, the team's title,
   * `<team title> / <project title>`, or the host of a `root:` pool, each title
   * falling back to its id.
   */
  const named = (pool: string, titles: { teams: Map<string, string>; projects: Map<string, string> }): { kind: string; name: string } => {
    const colon = pool.indexOf(':');
    const kind = colon === -1 ? '' : pool.slice(0, colon);
    const rest = colon === -1 ? pool : pool.slice(colon + 1);
    if (kind === 'team') return { kind, name: titles.teams.get(rest) ?? rest };
    if (kind === 'project') {
      const one = membership(rest);
      if (one?.project === undefined) return { kind, name: rest };
      return { kind, name: `${titles.teams.get(one.team) ?? one.team} / ${titles.projects.get(one.project) ?? one.project}` };
    }
    return { kind, name: rest };
  };

  /**
   * The range asked for, on the defaults `records` has always had: the first
   * day of the month in `zone`, and now.
   *
   * A bound that is not a date is refused rather than read as no bound, which
   * would answer every record or none.
   */
  const bounds = (from: string | undefined, until: string | undefined, now: Date): [string, string] => {
    const local = shown(zone, now);
    const month = `${String(local.getUTCFullYear())}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
    const bound = (which: 'from' | 'until', value: string | undefined, fallback: string): string => {
      if (value === undefined) return fallback;
      if (!DAY.test(value) || Number.isNaN(Date.parse(value))) {
        throw new RpcError(INVALID_PARAMS, `${which} must be a date, as 2026-10-01, or an ISO 8601 instant: ${value}`);
      }
      return value;
    };
    return [bound('from', from, `${month}-01`), bound('until', until, now.toISOString())];
  };

  /** The keys a grouped read sums by, refused when one is not a key. */
  const keysFrom = (written: readonly string[]): UsageKey[] => {
    const keys: UsageKey[] = [];
    for (const one of written) {
      const key = KEYS.find((known) => known === one);
      if (key === undefined) throw new RpcError(INVALID_PARAMS, `by takes ${KEYS.join(', ')}, not ${one}`);
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  };

  /** The keys a query's `by` names, comma-separated. */
  const keysAsked = (asked: URLSearchParams): UsageKey[] =>
    keysFrom((asked.get('by') ?? '').split(',').map((one) => one.trim()).filter((one) => one !== ''));

  /** One row per set of key values, each named. */
  const groups = async (written: readonly string[], from: string | undefined, until: string | undefined, reader: Principal | undefined): Promise<UsageNamedGroup[]> => {
    const by = keysFrom(written);
    const range = bounds(from, until, new Date());
    const rows = await store.groups(by, ...range, keeper(reader));
    const titles = await titled();
    return rows.map((row) => {
      const names: Partial<Record<UsageKey, string>> = {};
      for (const key of by) {
        const pool = row.keys[key];
        if (pool !== undefined) names[key] = named(pool, titles).name;
      }
      return { keys: row.keys, names, total: row.total };
    });
  };

  /** The bytes behind `usage://groups`. */
  const groupsBody = async (held: At, reader: Principal | undefined): Promise<string> =>
    JSON.stringify(await groups(keysAsked(held.asked), held.asked.get('from') ?? undefined, held.asked.get('until') ?? undefined, reader), null, 2);

  /** Whether a row is inside its window at this instant, as `decide` reads its `from` and `until`. */
  const activeAt = (row: Policy, moment: string): boolean =>
    (row.from === undefined || moment >= row.from) && (row.until === undefined || moment < row.until);

  /** Whether the reader's own scope holds a row: `all`, the reader, a team or a project of theirs. */
  const holds = (row: Policy, reader: Principal): boolean =>
    row.scope === 'all' || mayRead(reader, row.scope);

  /**
   * Each active row whose scope holds the reader, with its limits.
   *
   * The reader is the person an `each` limit answers, so a person reads their
   * own figure and no other member's. A `minute` limit answers the meter's
   * figure, which is the daemon's own, so the read and the walk agree. A host
   * with no person, which is the root connection or a host with no users
   * directory, has no scope a row can hold, so it reads none. A host with
   * `policies.ownLimits` off refuses the read.
   */
  const limits = async (reader: Principal | undefined): Promise<PolicyLimits[]> => {
    if (options.ownLimits === false) {
      throw new RpcError(-32008, 'usage://limits is not served while policies.ownLimits is off');
    }
    const policies = options.policies;
    if (policies === undefined) throw absentResource('usage', 'usage://limits');
    if (reader === undefined) return [];
    const now = new Date();
    const moment = now.toISOString();
    const held = (await policies.list()).filter((row) => activeAt(row, moment) && holds(row, reader));
    return Promise.all(held.map(async (row) => ({
      id: row.id,
      kind: row.kind,
      scope: row.scope,
      limits: await limitsOf(row, store, zone, now, reader, options.meter),
    })));
  };

  /**
   * The three periods, as the range each covers in `zone`.
   *
   * `until` is `now` and so the half-open day is a partly covered one, which
   * `total` counts whole: the day behind this hour's usage is still in it.
   */
  const spansOf = (now: Date): { day: [string, string]; week: [string, string]; month: [string, string] } => {
    const span = (period: 'day' | 'week' | 'month'): [string, string] =>
      [periodOf(zone, period, now).from, now.toISOString()];
    return { day: span('day'), week: span('week'), month: span('month') };
  };

  /** A pool's day, week and month. */
  const periods = async (pool: string): Promise<UsagePeriods> => {
    const spans = spansOf(new Date());
    return {
      pool,
      ...named(pool, await titled()),
      day: await store.total(pool, ...spans.day),
      week: await store.total(pool, ...spans.week),
      month: await store.total(pool, ...spans.month),
    };
  };

  /** A pool's total over a range. */
  const range = async (pool: string, from?: string, until?: string): Promise<UsageTotal> =>
    store.total(pool, ...bounds(from, until, new Date()));

  /**
   * The records charged to a pool over a range.
   *
   * The same default the store would have applied, in the zone the periods are
   * cut in rather than in UTC: a client listing this month's records gets the
   * ones behind this month's total.
   */
  const records = async (pool: string, from?: string, until?: string): Promise<UsageEntry[]> =>
    store.records(pool, ...bounds(from, until, new Date()));

  const answers: UsageAnswers = {
    pools: async (reader) => {
      const titles = await titled();
      return (await visible(reader)).map((pool) => ({ pool, ...named(pool, titles) }));
    },
    readable: (reader, pool) => !refused(reader, pool),
    periods,
    range,
    records,
    groups,
    limits,
  };

  /** The bytes behind one URI, which `read` hands over and `resolve` measures. */
  const body = async (held: At): Promise<string> => {
    const from = held.asked.get('from') ?? undefined;
    const until = held.asked.get('until') ?? undefined;
    if (held.leaf === '') return JSON.stringify(await periods(held.pool), null, 2);
    if (held.leaf === 'records') return JSON.stringify(await records(held.pool, from, until), null, 2);
    if (held.leaf === 'range') return JSON.stringify(await range(held.pool, from, until), null, 2);
    if (held.leaf === 'day' || held.leaf === 'week' || held.leaf === 'month') {
      const [start, end] = spansOf(new Date())[held.leaf];
      return JSON.stringify(await store.total(held.pool, start, end), null, 2);
    }
    throw absentResource('usage', `usage://${encodeURIComponent(held.pool)}/${held.leaf}`);
  };

  return {
    answers,
    describe: (): SchemeDescription => ({
      title: 'Usage',
      description: 'What this host has been charged, per pool.',
    }),

    /*
     * The gate's own question, asked before the grant is required.
     *
     * True for the root's own pools, so a signed-in person reads what is theirs
     * without a grant naming the scheme. The scheme's root is always allowed: a
     * listing is the answer that says which pools there are, and this one lists
     * only the reader's.
     */
    authorize: async (uri, reader) => {
      if (reader === undefined) return true;
      const held = split(uri);
      if (held === undefined || held.pool === '') return true;
      // The grouped read counts only the records the reader may read.
      if (held.pool === GROUPS && held.leaf === '') return true;
      // The limits read answers only the rows whose scope holds the reader.
      if (held.pool === LIMITS && held.leaf === '') return true;
      return !refused(reader, held.pool);
    },

    list: async (uri, reader) => {
      const held = at(uri);
      if (held.leaf !== '') throw absentResource('usage', uri);
      if (held.pool === '') {
        return (await visible(reader)).map((one) => ({ name: one, type: 'directory' as const }));
      }
      if (held.pool === GROUPS) throw absentResource('usage', uri);
      notYours(reader, held.pool);
      return LEAVES.map((name) => ({ name, type: 'file' as const }));
    },

    resolve: async (uri) => {
      const held = at(uri);
      if (held.pool === GROUPS && held.leaf === '') {
        return {
          uri,
          type: 'file',
          size: Buffer.byteLength(await groupsBody(held, undefined), 'utf8'),
          mtime: EPOCH,
          ctime: EPOCH,
        };
      }
      if (held.pool === LIMITS && held.leaf === '') {
        return {
          uri,
          type: 'file',
          size: Buffer.byteLength(JSON.stringify(await limits(undefined), null, 2), 'utf8'),
          mtime: EPOCH,
          ctime: EPOCH,
        };
      }
      if (held.leaf === '') {
        return { uri, type: 'directory', mtime: EPOCH, ctime: EPOCH };
      }
      if (!LEAVES.some((one) => one === held.leaf)) throw absentResource('usage', uri);
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(await body(held), 'utf8'),
        mtime: EPOCH,
        ctime: EPOCH,
      };
    },

    read: async (uri, _wanted, reader) => {
      const held = at(uri);
      if (held.pool === '') {
        throw new RpcError(-32008, `${uri} is the usage directory; read usage://<pool>`);
      }
      if (held.pool === GROUPS && held.leaf === '') {
        return asFile(await groupsBody(held, reader));
      }
      if (held.pool === LIMITS && held.leaf === '') {
        return asFile(JSON.stringify(await limits(reader), null, 2));
      }
      notYours(reader, held.pool);
      return asFile(await body(held));
    },
  };
}

/** A string param, absent as undefined, or a refusal naming the command and the param. */
const textParam = (command: string, params: Record<string, unknown>, name: string): string | undefined => {
  const value = params[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new RpcError(INVALID_PARAMS, `${command} takes ${name} as a string`);
  return value;
};

/** The pool a command names, a first-party plugin's old name read as its id, or a refusal saying it needs one. */
const poolParam = (command: string, params: Record<string, unknown>): string => {
  const pool = textParam(command, params, 'pool');
  if (pool === undefined || pool === '') throw new RpcError(INVALID_PARAMS, `${command} needs pool, a pool key such as user:ana`);
  return currentOwner(pool);
};

/**
 * The five usage commands, by name, each answering what its `usage:` read
 * answers, as a value.
 *
 * | Command | Params | Answers, as |
 * | --- | --- | --- |
 * | `x-ahpd/usage/pools` | - | the listing of `usage://`, as `[{ pool, kind, name }]` |
 * | `x-ahpd/usage/totals` | `pool` | `usage://<pool>` |
 * | `x-ahpd/usage/range` | `pool`, `from?`, `until?` | `usage://<pool>/range` |
 * | `x-ahpd/usage/records` | `pool`, `from?`, `until?` | `usage://<pool>/records` |
 * | `x-ahpd/usage/groups` | `by?`, `from?`, `until?` | `usage://groups` |
 *
 * Each needs `usage:read`, and lets in a reader without it by the scheme's own
 * rules: `pools` and `groups` answer only what the reader may read, and the
 * other three answer a pool the reader may read.
 */
export const usageMethods = (provider: UsageProvider): Record<string, PluginMethod> => {
  const answers = provider.answers;
  const GRANT: Grant = 'usage:read';

  /** A command over one pool, which a reader may send for a pool they may read. */
  const onePool = (command: string, title: string, description: string, answer: (pool: string, params: Record<string, unknown>) => Promise<unknown>): PluginMethod => ({
    grant: GRANT,
    describe: () => ({ title, description }),
    authorize: async (params, reader) => {
      const pool = params.pool;
      return typeof pool === 'string' && pool !== '' && answers.readable(reader, currentOwner(pool));
    },
    handle: async (params, reader) => {
      const pool = poolParam(command, params);
      if (!answers.readable(reader, pool)) throw new RpcError(-32009, refusalReason((reader as Principal).id, GRANT));
      return answer(pool, params);
    },
  });

  const totals = 'x-ahpd/usage/totals';
  const range = 'x-ahpd/usage/range';
  const records = 'x-ahpd/usage/records';
  const groups = 'x-ahpd/usage/groups';
  return {
    'x-ahpd/usage/pools': {
      grant: GRANT,
      describe: () => ({ title: 'Usage pools', description: 'The pools something was charged to that you may read.' }),
      authorize: async () => true,
      handle: async (_params, reader) => answers.pools(reader),
    },
    [totals]: onePool(totals, 'Usage totals', 'A pool\'s day, week and month.', async (pool) => answers.periods(pool)),
    [range]: onePool(range, 'Usage over a range', 'A pool\'s total between from and until.', async (pool, params) =>
      answers.range(pool, textParam(range, params, 'from'), textParam(range, params, 'until'))),
    [records]: onePool(records, 'Usage records', 'The records charged to a pool between from and until.', async (pool, params) =>
      answers.records(pool, textParam(records, params, 'from'), textParam(records, params, 'until'))),
    [groups]: {
      grant: GRANT,
      describe: () => ({ title: 'Usage by group', description: 'The records you may read, summed by user, team and project.' }),
      authorize: async () => true,
      handle: async (params, reader) => {
        const by = params.by;
        if (by !== undefined && (!Array.isArray(by) || by.some((one) => typeof one !== 'string'))) {
          throw new RpcError(INVALID_PARAMS, `${groups} takes by as a list of user, team and project`);
        }
        return answers.groups((by ?? []) as string[], textParam(groups, params, 'from'), textParam(groups, params, 'until'), reader);
      },
    },
  };
};

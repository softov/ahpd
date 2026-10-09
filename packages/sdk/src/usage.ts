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
import { refusalReason } from './host.js';
import { absentResource, asFile, EPOCH, splitResource, type At as Split } from './records.js';
import { RpcError } from './rpc.js';
import { mayRead, membership } from './scopes.js';
import type { Entry, Metadata, Read, ResourceProvider, SchemeDescription } from './types/resources.js';
import type { Named, Principal } from './types/users.js';
import type { Cost, Usage, UsageEntry, UsageGroup, UsageKey, UsageTotal } from './types/usage.js';

/** An hour, which is what computer time is reported in. */
const HOUR_S = 3_600;

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
  hours: number;
}

const none = (): Measured => ({
  usd: 0, providerUsd: 0, inputUsd: 0, outputUsd: 0, tokens: 0, input: 0, output: 0, cache: 0, calls: 0, hours: 0,
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
  /** Somewhere to say that a record could not be kept or a line could not be read. */
  onProblem?(message: string): void;
}

/**
 * Usage in JSON lines, one file per month and kind, and the totals in memory.
 *
 * Append-only, because a record is written once and is never edited: a second
 * line for the same call would be a different record, and the day's totals are
 * the sum rather than the last word. The month and kind are in the file name,
 * and each line still carries its `kind` so a line read alone says what it is -
 * decision `usage-and-computer-time-are-two-records-behind-one-port`.
 *
 * **Totals per pool per day, rebuilt at construction.** A limit is checked
 * before a call and debited as usage arrives, so the answer has to be a running
 * one rather than a read of the month's file - decision
 * `the-usage-store-answers-live-totals`. A day is the granularity, which is
 * exact for the ranges a limit asks about and counts a partly covered day
 * whole. A large install moves the totals into a database plugin, which answers
 * the same calls from the same records.
 *
 * **The pools and the records behind the totals read the files.** The totals
 * are charged in memory because a limit asks them mid-turn, but a report wants
 * what was charged and to what, and the lines are the whole of that - decision
 * `usage-is-read-through-a-usage-scheme`. Neither read goes through the queue
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

  /** What each pool has been charged on each day, as `pool` then `YYYY-MM-DD`. */
  const held = new Map<string, Map<string, Measured>>();

  /**
   * The day a record falls on, or nothing when it names no instant.
   *
   * A record is kept because of when it happened: that is what puts it in a
   * month and what a total is summed by. One that names no day is reported and
   * kept nowhere, which is the only answer that is not a charge in the wrong
   * place.
   */
  const dayOf = (entry: UsageEntry): string | undefined => {
    const at = typeof entry.at === 'string' ? entry.at : '';
    return DAY.test(at) ? at.slice(0, 10) : undefined;
  };

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
        hours: 0,
      };
    }
    const span = counted(entry.seconds) / HOUR_S;
    return {
      usd: 0, providerUsd: 0, inputUsd: 0, outputUsd: 0, tokens: 0, input: 0, output: 0, cache: 0, calls: 0,
      hours: span > 0 ? span : 0,
    };
  };

  /** The pools one record is charged to, and nothing it does not name with a string. */
  const poolsOf = (entry: UsageEntry): string[] =>
    Array.isArray(entry.pools) ? entry.pools.filter((one): one is string => typeof one === 'string') : [];

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
      placed.push({ entry, day });
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

  /** The day an instant falls on, in UTC, which is the day a line is written under. */
  const today = (at: Date): string => at.toISOString().slice(0, 10);

  return {
    record: (entry) => serialise(() => {
      const day = dayOf(entry);
      if (day === undefined) {
        told(`Not keeping a usage record with no readable date: ${String(entry.at)}`);
        return;
      }
      const file = join(folder, `${day.slice(0, 7)}-${entry.kind}.jsonl`);
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
        const first = DAY.test(from) ? from.slice(0, 10) : '';
        const last = DAY.test(until) ? until.slice(0, 10) : '';
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
       * month's first day and now. A partly covered day counts whole here as it
       * does there, which is what makes the records behind a period's total the
       * records that total summed.
       */
      const now = new Date();
      const first = from === undefined ? `${today(now).slice(0, 7)}-01` : DAY.test(from) ? from.slice(0, 10) : '';
      const last = until === undefined ? today(now) : DAY.test(until) ? until.slice(0, 10) : '';
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
      const first = DAY.test(from) ? from.slice(0, 10) : '';
      const last = DAY.test(until) ? until.slice(0, 10) : '';
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
 * Leaves under a pool, a root listing and one grouped read, through the
 * resource calls a client already uses: `usage://` lists the charged pools the
 * reader may read, a pool reads its kind, name, day, week and month, `range`
 * reads a total between two days, `records` reads what was charged, and
 * `usage://groups` sums the records by user, team and project. There is no
 * manifest and nothing is made here, which is why `describe` has no body for a
 * create form to draw.
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
      pool: decodeURIComponent(held.id),
      leaf: decodeURIComponent(held.leaf),
      asked: new URLSearchParams(held.query),
    };
  }
  catch { return undefined; }
};

const at = (uri: string): At => {
  const held = split(uri);
  if (held === undefined) throw new RpcError(-32602, `${uri} is not a usage: URI`);
  return held;
};

/**
 * One instant as the wall clock in `zone` reads it.
 *
 * A `Date` whose UTC fields are that wall time, so the arithmetic below is
 * ordinary UTC arithmetic on a clock that is not UTC: `Intl` is the only zoned
 * clock this repository holds, and it answers in words rather than in numbers,
 * so the parts are put back together by hand.
 */
const shown = (zone: string, at: Date): Date => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const field = (what: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((one) => one.type === what)?.value);
  return new Date(Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second')));
};

/** How far `zone` is from UTC at that instant, in milliseconds east of it. */
const offsetAt = (zone: string, at: Date): number => shown(zone, at).getTime() - at.getTime();

/**
 * The instant a local calendar day begins.
 *
 * Twice, because a zone that changes its offset at midnight would otherwise put
 * the answer on the wrong side of its own change: the first guess asks what the
 * offset was at local midnight read as UTC, and the second asks again at the
 * instant that gave.
 */
const startOfDay = (zone: string, local: Date): Date => {
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const guess = midnight - offsetAt(zone, new Date(midnight));
  return new Date(midnight - offsetAt(zone, new Date(guess)));
};

/** The zone the periods are cut in, and what is said about one that cannot be read. */
const zoneOf = (wanted: string | undefined, told: (message: string) => void): string => {
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (wanted === undefined || wanted.trim() === '') return here;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: wanted }).format(new Date());
    return wanted;
  } catch {
    told(`usage.timezone ${wanted} is not a zone this host can read, so usage is cut in ${here}.`);
    return here;
  }
};

export function usageProvider(options: UsageProviderOptions): UsageProvider {
  const store = options.usage;
  const zone = zoneOf(options.timezone, (message) => { options.onProblem?.(message); });

  /** The local day `back` days before the local day `from` falls on. */
  const earlier = (from: Date, back: number): Date =>
    new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - back));

  /** The Monday of the local week `local` falls in, which is the week already under way. */
  const mondayOf = (local: Date): Date => earlier(local, (local.getUTCDay() + 6) % 7);

  /** The first of the local month `local` falls in. */
  const firstOf = (local: Date): Date =>
    new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1));

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
   * The pools something was charged to that this reader may read - decision
   * `usage-lists-the-charged-pools-a-reader-may-read`.
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
   * The range a query asks for, on the defaults `records` has always had: the
   * first day of the month in `zone`, and now.
   *
   * A bound that is not a date is refused rather than read as no bound, which
   * would answer every record or none.
   */
  const rangeOf = (asked: URLSearchParams, now: Date): [string, string] => {
    const local = shown(zone, now);
    const month = `${String(local.getUTCFullYear())}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
    const bound = (which: 'from' | 'until', fallback: string): string => {
      const value = asked.get(which);
      if (value === null) return fallback;
      if (!DAY.test(value) || Number.isNaN(Date.parse(value))) {
        throw new RpcError(-32602, `${which} must be a date, as 2026-10-01, or an ISO 8601 instant: ${value}`);
      }
      return value;
    };
    return [bound('from', `${month}-01`), bound('until', now.toISOString())];
  };

  /** The keys a grouped read sums by, refused when one is not a key. */
  const keysAsked = (asked: URLSearchParams): UsageKey[] => {
    const written = (asked.get('by') ?? '').split(',').map((one) => one.trim()).filter((one) => one !== '');
    const keys: UsageKey[] = [];
    for (const one of written) {
      const key = KEYS.find((known) => known === one);
      if (key === undefined) throw new RpcError(-32602, `by takes ${KEYS.join(', ')}, not ${one}`);
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  };

  /** The bytes behind `usage://groups`: one row per set of key values, each named. */
  const groupsBody = async (held: At, reader: Principal | undefined): Promise<string> => {
    const by = keysAsked(held.asked);
    const [from, until] = rangeOf(held.asked, new Date());
    const rows = await store.groups(by, from, until, keeper(reader));
    const titles = await titled();
    return JSON.stringify(rows.map((row) => {
      const names: Partial<Record<UsageKey, string>> = {};
      for (const key of by) {
        const pool = row.keys[key];
        if (pool !== undefined) names[key] = named(pool, titles).name;
      }
      return { keys: row.keys, names, total: row.total };
    }), null, 2);
  };

  /**
   * The three periods, as the range each covers in `zone`.
   *
   * `until` is `now` and so the half-open day is a partly covered one, which
   * `total` counts whole: the day behind this hour's usage is still in it.
   */
  const spansOf = (now: Date): { day: [string, string]; week: [string, string]; month: [string, string] } => {
    const local = shown(zone, now);
    const span = (from: Date): [string, string] => [startOfDay(zone, from).toISOString(), now.toISOString()];
    return { day: span(local), week: span(mondayOf(local)), month: span(firstOf(local)) };
  };

  /** The bytes behind one URI, which `read` hands over and `resolve` measures. */
  const body = async (held: At): Promise<string> => {
    const now = new Date();
    if (held.leaf === '') {
      const spans = spansOf(now);
      return JSON.stringify({
        pool: held.pool,
        ...named(held.pool, await titled()),
        day: await store.total(held.pool, ...spans.day),
        week: await store.total(held.pool, ...spans.week),
        month: await store.total(held.pool, ...spans.month),
      }, null, 2);
    }
    if (held.leaf === 'records') {
      /*
       * The same default the store would have applied, in the zone the periods
       * are cut in rather than in UTC: a client listing this month's records
       * gets the ones behind this month's total.
       */
      return JSON.stringify(await store.records(held.pool, ...rangeOf(held.asked, now)), null, 2);
    }
    if (held.leaf === 'range') {
      return JSON.stringify(await store.total(held.pool, ...rangeOf(held.asked, now)), null, 2);
    }
    if (held.leaf === 'day' || held.leaf === 'week' || held.leaf === 'month') {
      const [from, until] = spansOf(now)[held.leaf];
      return JSON.stringify(await store.total(held.pool, from, until), null, 2);
    }
    throw absentResource('usage', `usage://${encodeURIComponent(held.pool)}/${held.leaf}`);
  };

  return {
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
      notYours(reader, held.pool);
      return asFile(await body(held));
    },
  };
}

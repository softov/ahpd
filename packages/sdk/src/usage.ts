/** The `Usage` implementation that keeps it in files, and in this process's memory. */

import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Usage, UsageEntry, UsageTotal } from './types/usage.js';

/** An hour, which is what computer time is reported in. */
const HOUR_S = 3_600;

/** What one record costs, in the four measures the port reports. */
interface Measured {
  usd: number;
  tokens: number;
  calls: number;
  hours: number;
}

const none = (): Measured => ({ usd: 0, tokens: 0, calls: 0, hours: 0 });

/** A number the record meant, or zero: a count nothing was told is not a count. */
const counted = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** One instant of a day, which is what the totals are kept per. */
const DAY = /^\d{4}-\d{2}-\d{2}/u;

/** The file a record of this kind and month belongs in. The month is in the name, not in a line. */
const FILE = /^(\d{4}-\d{2})-(model|computer)\.jsonl$/u;

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
 * the same two calls from the same records.
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
       * beside it.
       */
      return {
        usd: typeof entry.cost?.currency === 'string' && entry.cost.currency.toLowerCase() === 'usd'
          ? counted(entry.cost.amount)
          : 0,
        tokens: counted(entry.model.input) + counted(entry.model.output)
          + counted(entry.model.cache?.read) + counted(entry.model.cache?.write),
        calls: 1,
        hours: 0,
      };
    }
    const span = counted(entry.seconds) / HOUR_S;
    return { usd: 0, tokens: 0, calls: 0, hours: span > 0 ? span : 0 };
  };

  /** Add one record to every pool it names. */
  const charge = (entry: UsageEntry, day: string): void => {
    const pools = Array.isArray(entry.pools) ? entry.pools.filter((one): one is string => typeof one === 'string') : [];
    const what = measured(entry);
    for (const pool of pools) {
      const days = held.get(pool) ?? new Map<string, Measured>();
      const charged = days.get(day) ?? none();
      charged.usd += what.usd;
      charged.tokens += what.tokens;
      charged.calls += what.calls;
      charged.hours += what.hours;
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

  /*
   * Every month's file, read once here.
   *
   * A folder that is not there yet is a first run rather than a failure. A file
   * whose name is not one of these is not this store's and is left alone, and a
   * line that is not JSON, or is JSON that is not a record, is skipped and
   * reported: one torn line is worth saying out loud and is not worth losing
   * the month's other entries over. This is the same shape as the session
   * store's load, which reads once at construction because a daemon reads one
   * small file at startup and never again.
   */
  const load = (): void => {
    let names: string[];
    try { names = readdirSync(folder); }
    catch { return; }
    for (const name of [...names].sort()) {
      if (!FILE.test(name)) continue;
      let text: string;
      try { text = readFileSync(join(folder, name), 'utf8'); }
      catch (error) { told(`Could not read usage file ${name}: ${error instanceof Error ? error.message : String(error)}`); continue; }
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
        charge(entry, day);
      }
    }
  };

  load();

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
       * a shared store is a plugin answering the same two calls rather than
       * this one with a lock.
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
          sum.usd += charged.usd;
          sum.tokens += charged.tokens;
          sum.calls += charged.calls;
          sum.hours += charged.hours;
        }
      }
      // A measure nothing was charged in is absent rather than zero.
      const out: UsageTotal = {};
      if (sum.usd !== 0) out.usd = sum.usd;
      if (sum.tokens !== 0) out.tokens = sum.tokens;
      if (sum.calls !== 0) out.calls = sum.calls;
      if (sum.hours !== 0) out.hours = sum.hours;
      return out;
    },
  };
}

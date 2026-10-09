/** Automations that fire on their own: a clock, and a file they survive in. */

import { disableConditionsOf, memoryAutomations } from './automations.js';
import { readJson, writeJsonAtomic } from './jsonfile.js';
import { nextOccurrence, parseCron, type Cron } from './cron.js';
import type { Automation, AutomationEntry, AutomationStore } from './types/automations.js';
import type { Bag } from './types/common.js';
import { bag, ownerOf } from './values.js';

/** How this store is built, and what a test replaces. */
export interface ScheduledOptions {
  /**
   * Where definitions are kept.
   *
   * Named by the caller rather than defaulted to somewhere under a home
   * directory: this is a library, and a library that decides on its own where
   * to write in somebody's home is one that has made a decision for the
   * program using it. The daemon passes the file beside its configuration.
   */
  file: string;
  /** The clock. A test supplies its own so a schedule can be reached without waiting for it. */
  now?(): Date;
  /**
   * How a timer is armed.
   *
   * Handed in for the same reason the clock is: a test that had to wait for a
   * real `setTimeout` would be a test that takes until nine in the morning.
   */
  timer?(fire: () => void, ms: number): { cancel(): void };
  /** Somewhere to say that a definition could not be read. */
  onProblem?(message: string): void;
}

/** What is persisted. Versioned, so a later shape can be recognised rather than guessed at. */
interface Saved {
  version: 1;
  automations: {
    resource: string;
    definition: Bag;
    /** Whose work it is, as the decision's typed reference, when it has one. */
    owner?: string;
    /**
     * How many scheduled runs the allowance in force has paid for.
     *
     * Written down because the protocol says it is not reconstructed from the
     * runs, and this store keeps no run history to reconstruct it from anyway.
     * A row without it - every row written before this - reads as none used.
     */
    runCount?: number;
    createdAt: string;
    modifiedAt: string;
    /** The occurrence this was waiting for when it was written. What catch-up reads. */
    nextRunAt?: string;
  }[];
}

/** `setTimeout` will not wait longer than this, so a longer wait is done in instalments. */
const MAX_DELAY = 2_147_483_647;

/** One schedule an automation carries, ready to be asked when it next fires. */
interface Schedule {
  triggerId: string;
  cron: Cron;
  timeZone: string;
  /** Whether a missed occurrence is caught up. `runOnce` is the protocol's default. */
  catchUp: boolean;
}

/**
 * A host that fires its own automations.
 *
 * The other implementation of `AutomationStore`, and the one the port was
 * written for: `memoryAutomations` holds the definitions and the run history,
 * and everything added here is the clock and the file. Composed rather than
 * copied, so there is still one answer to what a run is.
 *
 * **It does not start sessions.** The clock decides it is time and says so
 * through `onDue`; the host, which is the only thing that knows what a session
 * is, calls `run`. That is the same division the port already describes, and
 * it is why an automation can fire with nobody connected.
 *
 * **Definitions survive a restart and run history does not.** A run names the
 * sessions it started, and this daemon's sessions are subprocesses that go
 * when it does - so a persisted history would be a list of links to things
 * that are not there. What is worth keeping across a restart is what somebody
 * wrote down, which is the definition and when it next fires.
 */
export function scheduledAutomations(options: ScheduledOptions): AutomationStore {
  const inner = memoryAutomations();
  const file = options.file;
  const now = options.now ?? ((): Date => new Date());
  const arm = options.timer ?? ((fire, ms): { cancel(): void } => {
    const held = setTimeout(fire, ms);
    // A daemon should not be held open by the next automation, and should not
    // be kept alive by one either.
    held.unref?.();
    return { cancel: () => { clearTimeout(held); } };
  });
  const told = (message: string): void => { options.onProblem?.(message); };

  /** When each automation next fires, by resource. Absent means nothing will fire it. */
  const nextAt = new Map<string, Date>();
  /** Written timestamps, kept here so they survive a reload rather than becoming the load time. */
  const stamps = new Map<string, { createdAt: string; modifiedAt: string }>();
  const due: ((event: { automation: string; origin: Bag }) => void)[] = [];
  const changed: ((event: { automation?: string; run?: string; removed?: string }) => void)[] = [];
  let timer: { cancel(): void } | undefined;
  /** Closed: the clock is let go of, and nothing is fired or written again. */
  let closed = false;

  /**
   * The schedules on one definition.
   *
   * An expression that will not parse is skipped and reported rather than
   * thrown: the automation is still a real thing somebody wrote, and refusing
   * to list it would lose the definition along with the typo. It fires
   * nothing, which is the same thing this host says by leaving `nextRunAt` off
   * an automation it will not fire.
   */
  const schedulesOf = (automation: Automation): Schedule[] => {
    const triggers = Array.isArray(automation.definition.triggers) ? automation.definition.triggers : [];
    const out: Schedule[] = [];
    for (const raw of triggers) {
      const trigger = bag(raw);
      if (trigger.kind !== 'schedule') continue;
      const schedule = bag(trigger.schedule);
      const expression = typeof schedule.expression === 'string' ? schedule.expression : '';
      const timeZone = typeof schedule.timeZone === 'string' && schedule.timeZone !== ''
        ? schedule.timeZone
        : 'UTC';
      try {
        out.push({
          triggerId: String(trigger.id ?? ''),
          cron: parseCron(expression),
          timeZone,
          catchUp: trigger.misfirePolicy !== 'skip',
        });
      }
      catch (error) {
        told(`${automation.resource}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return out;
  };

  /** The soonest any of an automation's schedules comes round, after that instant. */
  const soonest = (automation: Automation, after: Date): { at: Date; schedule: Schedule } | undefined => {
    if (automation.definition.enabled === false) return undefined;
    let best: { at: Date; schedule: Schedule } | undefined;
    for (const schedule of schedulesOf(automation)) {
      let at: Date | undefined;
      try { at = nextOccurrence(schedule.cron, after, schedule.timeZone); }
      catch (error) {
        // An unknown time zone, which `Intl` refuses only when asked to use it.
        told(`${automation.resource}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (at && (!best || at < best.at)) best = { at, schedule };
    }
    return best;
  };

  /** Everything this store knows, with what it added. */
  const dressed = (automation: AutomationEntry): AutomationEntry => {
    const at = nextAt.get(automation.resource);
    const stamp = stamps.get(automation.resource);
    return {
      ...automation,
      ...(stamp ?? {}),
      ...(at ? { nextRunAt: at.toISOString() } : {}),
    };
  };

  const save = (): void => {
    if (closed) return;
    const held: Saved = {
      version: 1,
      automations: inner.list().map((one) => {
        const at = nextAt.get(one.resource);
        // The inner store answers the entry a client reads, which carries the
        // owner in `_meta` rather than under its own name.
        const owner = ownerOf(one._meta?.['ahpd.owner']);
        return {
          resource: one.resource,
          definition: one.definition,
          ...(owner === undefined ? {} : { owner }),
          // Absent while the definition names no allowance, which is what the
          // entry carries too - a count written for an automation that has none
          // is a number nothing will ever read.
          ...(one.runCount === undefined ? {} : { runCount: one.runCount }),
          ...(stamps.get(one.resource) ?? { createdAt: one.createdAt, modifiedAt: one.modifiedAt }),
          ...(at ? { nextRunAt: at.toISOString() } : {}),
        };
      }),
    };
    try {
      // Owner-only, as the daemon's own records are: this names whose work an
      // automation is, and that is not everybody's business on a host with
      // more than one person on it.
      writeJsonAtomic(file, held);
    }
    catch (error) {
      told(`Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Whether an automation's own date has gone by, so it schedules itself no more.
   *
   * Read rather than re-checked, exactly as the memory store reads it: a
   * definition that reached this store was refused at the write if its
   * conditions would not read, and one written before the host checked anything
   * is read for whatever it holds.
   */
  const expired = (definition: Bag, at: Date): boolean => {
    const stopsAfter = disableConditionsOf(definition.disableConditions).stopsAfter;
    return stopsAfter !== undefined && stopsAfter <= at.getTime();
  };

  /** Let go of the timer, so whatever is armed next is the only one. */
  const disarm = (): void => {
    timer?.cancel();
    timer = undefined;
  };

  /** Work out when everything next fires, and set one timer for the first of them. */
  const rearm = (): void => {
    disarm();
    if (closed) return;
    const at = now();
    /*
     * An automation whose date has gone by is switched off here rather than
     * left to fire - which is the other half of what `soonest` says by
     * answering nothing for it.
     *
     * Switching one off is a write, and a write is announced, so this comes
     * back through `onChanged` and this function runs again - with that
     * automation already disabled. Each iteration therefore re-reads what it is
     * about to switch off rather than trusting the list it is walking, and the
     * clock is armed from the state the pass leaves behind.
     */
    for (const automation of inner.list()) {
      const held = inner.get(automation.resource);
      if (held && held.definition.enabled !== false && expired(held.definition, at)) {
        inner.update(automation.resource, { enabled: false });
      }
    }
    let first: Date | undefined;
    for (const automation of inner.list()) {
      const found = soonest(automation, at);
      if (found) {
        nextAt.set(automation.resource, found.at);
        if (!first || found.at < first) first = found.at;
      }
      else nextAt.delete(automation.resource);
    }
    // Let go once more, for the same reason: a switch-off above may have armed
    // one through the rearm its own announcement triggered, and two timers
    // racing for the same clock is one firing an occurrence nobody is due.
    disarm();
    if (!first) return;
    // One timer for the earliest, not one per automation: the second earliest
    // is recomputed when the first fires, and a hundred automations should not
    // be a hundred timers.
    const wait = Math.max(0, first.getTime() - at.getTime());
    timer = arm(() => { fire(); }, Math.min(wait, MAX_DELAY));
  };

  /** Say what is due, then look again. */
  const fire = (): void => {
    if (closed) return;
    const at = now();
    for (const automation of inner.list()) {
      const when = nextAt.get(automation.resource);
      if (!when || when > at) continue;
      const schedule = soonest(automation, new Date(when.getTime() - 1));
      const origin: Bag = {
        kind: 'trigger',
        triggerId: schedule?.schedule.triggerId ?? '',
        scheduledFor: when.toISOString(),
      };
      for (const listener of due) listener({ automation: automation.resource, origin });
    }
    rearm();
  };

  /**
   * What was missed while this daemon was not running.
   *
   * `runOnce` is the protocol's default and its whole meaning: at most one
   * catch-up run however many occurrences went by, so a machine that was off
   * for a week comes back to one run and not to two hundred.
   */
  const catchUp = (loaded: { resource: string; nextRunAt?: string }[]): void => {
    const at = now();
    for (const one of loaded) {
      if (one.nextRunAt === undefined) continue;
      const missed = new Date(one.nextRunAt);
      if (!(missed < at)) continue;
      const automation = inner.get(one.resource);
      if (!automation || automation.definition.enabled === false) continue;
      // A date that has gone by while this daemon was not running is a
      // condition met, not an occurrence missed: caught up, it would be the one
      // run the automation asked never to have. Switched off and left there,
      // which `rearm` has already done by the time catch-up is asked for.
      if (expired(automation.definition, at)) continue;
      const schedule = soonest(automation, new Date(missed.getTime() - 1));
      if (!schedule?.schedule.catchUp) continue;
      const origin: Bag = {
        kind: 'trigger',
        triggerId: schedule.schedule.triggerId,
        scheduledFor: missed.toISOString(),
        catchUp: true,
      };
      for (const listener of due) listener({ automation: one.resource, origin });
    }
  };

  /** Read what was written, if anything was. */
  const load = (): { resource: string; nextRunAt?: string }[] => {
    const read = readJson(file);
    // Nothing to read is nothing to catch up on, and nothing is said about it:
    // a daemon's first start, and a file that could not be opened, are both a
    // store with no automations in it.
    if (!read.ok && read.kind !== 'not-json') return [];
    if (!read.ok) {
      told(`Could not read ${file}: ${read.error instanceof Error ? read.error.message : String(read.error)}`);
      return [];
    }
    const held = read.value as Saved;
    if (held.version !== 1 || !Array.isArray(held.automations)) {
      told(`${file} is not something this version understands, and was left alone`);
      return [];
    }
    const back: { resource: string; nextRunAt?: string }[] = [];
    for (const one of held.automations) {
      if (typeof one.resource !== 'string') continue;
      // What an allowance has paid for survives with the definition, because
      // the protocol says it is not reconstructed from the runs.
      const runCount = typeof one.runCount === 'number' ? one.runCount : undefined;
      inner.create(one.resource, bag(one.definition), ownerOf(one.owner), runCount);
      stamps.set(one.resource, {
        createdAt: String(one.createdAt ?? now().toISOString()),
        modifiedAt: String(one.modifiedAt ?? now().toISOString()),
      });
      back.push({
        resource: one.resource,
        ...(typeof one.nextRunAt === 'string' ? { nextRunAt: one.nextRunAt } : {}),
      });
    }
    return back;
  };

  // What was on the clock when this daemon last wrote itself down. Read before
  // `rearm`, which replaces it with what is on the clock now.
  const wasWaiting = load();
  rearm();

  /*
   * Everything the inner store announces, announced again once the clock has
   * caught up.
   *
   * The ordering matters and cost a wrong answer on the wire: the inner store
   * says "this changed" from *inside* its own `update`, and whoever is
   * listening immediately reads the entry back. Rearming after that call
   * returned meant the entry went out carrying the previous `nextRunAt` - so
   * switching an automation off announced it as still firing at nine.
   */
  inner.onChanged?.((event) => {
    if (event.automation !== undefined || event.removed !== undefined) {
      rearm();
      save();
    }
    for (const listener of changed) listener(event);
  });

  return {
    ...inner,
    list: () => inner.list().map(dressed),
    get: (resource) => {
      const found = inner.get(resource);
      return found && dressed(found);
    },

    /**
     * The event triggers this host understands, which are what the store
     * underneath lists.
     *
     * Schedule triggers are protocol-defined and never appear here - a client
     * may always write one - and manual is not a trigger at all: an empty
     * trigger list is what the protocol says manual-only means. Everything
     * else is the store's answer, and this one is the store a daemon is built
     * over, so a client asking the daemon gets the same form it would get from
     * memory.
     */
    triggers: (options) => inner.triggers(options),

    create: (resource, definition, owner) => {
      const made = inner.create(resource, definition, owner);
      stamps.set(resource, { createdAt: made.createdAt, modifiedAt: made.modifiedAt });
      // `onChanged` above has already rearmed and written; the stamp is set
      // before this returns so what it wrote carries the right one.
      save();
      return dressed(inner.get(resource) ?? made);
    },

    update: (resource, changes) => {
      const after = inner.update(resource, changes);
      if (!after) return undefined;
      const stamp = stamps.get(resource);
      if (stamp) stamps.set(resource, { ...stamp, modifiedAt: after.modifiedAt });
      save();
      return dressed(inner.get(resource) ?? after);
    },

    remove: (resource) => {
      const gone = inner.remove(resource);
      if (!gone) return false;
      stamps.delete(resource);
      nextAt.delete(resource);
      save();
      return true;
    },

    /** Subscribed through, so the clock is caught up before anybody reads back. */
    onChanged: (observer) => { changed.push(observer); },

    onDue: (observer) => {
      due.push(observer);
      // Whatever was missed, told to whoever just asked - which is the host,
      // at startup, and is the only moment a catch-up can be reported to
      // anybody.
      catchUp(wasWaiting);
    },

    close: () => { closed = true; disarm(); },
  };
}

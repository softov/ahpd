/** Automations that fire on their own: a clock, and a file they survive in. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { memoryAutomations } from './automations.js';
import { automationsPath } from './config.js';
import { nextOccurrence, parseCron, type Cron } from './cron.js';
import type { Automation, AutomationStore } from './types/automations.js';
import type { Bag } from './types/common.js';

/** How this store is built, and what a test replaces. */
export interface ScheduledOptions {
  /** Where definitions are kept. Defaults to the file beside the configuration. */
  file?: string;
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

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

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
export function scheduledAutomations(options: ScheduledOptions = {}): AutomationStore {
  const inner = memoryAutomations();
  const file = options.file ?? automationsPath();
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
  const dressed = (automation: Automation): Automation => {
    const at = nextAt.get(automation.resource);
    const stamp = stamps.get(automation.resource);
    return {
      ...automation,
      ...(stamp ?? {}),
      ...(at ? { nextRunAt: at.toISOString() } : {}),
    };
  };

  const save = (): void => {
    const held: Saved = {
      version: 1,
      automations: inner.list().map((one) => {
        const at = nextAt.get(one.resource);
        return {
          resource: one.resource,
          definition: one.definition,
          ...(stamps.get(one.resource) ?? { createdAt: one.createdAt, modifiedAt: one.modifiedAt }),
          ...(at ? { nextRunAt: at.toISOString() } : {}),
        };
      }),
    };
    try {
      mkdirSync(dirname(file), { recursive: true });
      // Written beside and moved into place, so a daemon killed mid-write
      // leaves the last good file rather than half of this one.
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(held, null, 2)}\n`);
      renameSync(temporary, file);
    }
    catch (error) {
      told(`Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /** Work out when everything next fires, and set one timer for the first of them. */
  const rearm = (): void => {
    timer?.cancel();
    timer = undefined;
    const at = now();
    let first: Date | undefined;
    for (const automation of inner.list()) {
      const found = soonest(automation, at);
      if (found) {
        nextAt.set(automation.resource, found.at);
        if (!first || found.at < first) first = found.at;
      }
      else nextAt.delete(automation.resource);
    }
    if (!first) return;
    // One timer for the earliest, not one per automation: the second earliest
    // is recomputed when the first fires, and a hundred automations should not
    // be a hundred timers.
    const wait = Math.max(0, first.getTime() - at.getTime());
    timer = arm(() => { fire(); }, Math.min(wait, MAX_DELAY));
  };

  /** Say what is due, then look again. */
  const fire = (): void => {
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
    let text: string;
    try { text = readFileSync(file, 'utf8'); }
    catch { return []; }
    let held: Saved;
    try { held = JSON.parse(text) as Saved; }
    catch (error) {
      told(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    if (held.version !== 1 || !Array.isArray(held.automations)) {
      told(`${file} is not something this version understands, and was left alone`);
      return [];
    }
    const back: { resource: string; nextRunAt?: string }[] = [];
    for (const one of held.automations) {
      if (typeof one.resource !== 'string') continue;
      inner.create(one.resource, bag(one.definition));
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
     * The event triggers this host understands, which are none.
     *
     * Schedule triggers are protocol-defined and never appear here - a client
     * may always write one - and manual is not a trigger at all: an empty
     * trigger list is what the protocol says manual-only means. So an empty
     * answer is the true one for a host whose only automatic trigger is a
     * clock.
     */
    triggers: () => [],

    create: (resource, definition) => {
      const made = inner.create(resource, definition);
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

    close: () => { timer?.cancel(); timer = undefined; },
  };
}

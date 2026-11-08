/**
 * Automations that fire on their own: a clock, and the files they survive in.
 *
 * Each automation is one Markdown file a person reads and edits, and what
 * changes on every run is kept apart from it, in a state file of the daemon's
 * own.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch as watchPath, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';
import {
  bag,
  checkReferences,
  disableConditionsOf,
  memoryAutomations,
  nextOccurrence,
  ownerOf,
  parseCron,
  readJson,
  reason,
  writeJsonAtomic,
} from '@ahpd/sdk';
import type {
  Automation,
  AutomationEntry,
  AutomationStore,
  AutomationsOptions,
  Bag,
  CapturedPlugin,
  Cron,
  StoredRecord,
} from '@ahpd/sdk';
import { readRecordFile, recordFile } from './records.js';

/** How this store is built, and what a test replaces. */
export interface ScheduledOptions {
  /**
   * Where definitions are kept: one `.md` file per automation, named after its resource.
   *
   * Named by the caller rather than defaulted to somewhere under a home
   * directory. The daemon passes the folder beside its configuration.
   */
  dir: string;
  /**
   * Where the run state of every automation is kept.
   *
   * One file for all of them, and not the files above: a run rewrites this on
   * every occurrence, and a file a person edits must not be rewritten by a
   * clock. Named by the caller, as `dir` is.
   */
  state: string;
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
  /**
   * What a client's save is checked against beyond the store's own rules.
   *
   * The plugin trigger types, and the connectors an `x-ahpd-connector` field
   * may name. Read here rather than handed to the store underneath, because a
   * definition restored from a file is not checked: the connectors and the
   * plugins are loaded after this store is built, and a file is the host's own
   * record rather than a client's claim.
   */
  store?: AutomationsOptions;
}

/** The store `scheduledAutomations` makes: the port, and whether automations can run on it. */
export interface ScheduledStore extends AutomationStore {
  /**
   * False while the state file is there and cannot be read: nothing is loaded,
   * armed, watched or written, and every write is refused with
   * `AUTOMATIONS_UNAVAILABLE`, until the file is recovered and the store is
   * opened again.
   */
  readonly available: boolean;
}

/**
 * What the state file holds. Versioned, so a later shape can be recognised
 * rather than guessed at.
 *
 * Only what a run changes, and never a thing a person wrote: the definition,
 * its owner and when it was made are in the `.md` file. So a row here is keyed
 * by the automation it belongs to, and one whose file is gone is dropped at
 * the next save.
 */
interface RunState {
  version: 1;
  automations: {
    resource: string;
    /**
     * How many scheduled runs the allowance in force has paid for.
     *
     * Written down because the protocol says it is not reconstructed from the
     * runs, and this store keeps no run history to reconstruct it from anyway.
     * A row without it - every row written before this - reads as none used.
     */
    runCount?: number;
    /**
     * The copies of the client plugins the template names, as the host made
     * them.
     *
     * Written down because a restart does not bring the client back: the copy
     * is on this disk already, and an automation that came back without it
     * would be one whose every run the host then refuses for a plugin it
     * cannot capture.
     */
    customizations?: CapturedPlugin[];
    modifiedAt: string;
    /** The occurrence this was waiting for when it was written. What catch-up reads. */
    nextRunAt?: string;
  }[];
}

/** One row of the state file, as the store reads it back. */
type StateRow = RunState['automations'][number];

/** What one `.md` file held, as the store reads it. */
interface Held {
  definition: Bag;
  owner?: string;
  createdAt: string;
}

/**
 * The scheme every automation's resource carries, which is all the protocol
 * asks of the resource a client chooses beside that it names no other
 * automation.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-automation/actions.ts#L62-L67
 */
const SCHEME = 'ahp-automation:';

/** What the resource of an automation with a plain id starts with: the id is what comes after it. */
const PREFIX = 'ahp-automation:/';

/**
 * What every write is told while the run state cannot be read, VS Code's
 * sentence.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L809-L814
 */
export const AUTOMATIONS_UNAVAILABLE = 'Automation storage is unavailable and must be recovered before automations can run.';

/** The field the body of a file is read from and written to. */
const BODY = 'message.text';

/** `setTimeout` will not wait longer than this, so a longer wait is done in instalments. */
const MAX_DELAY = 2_147_483_647;

/** How long a file's watch events are gathered before it is read, in milliseconds. */
const WINDOW = 50;

/** One schedule an automation carries, ready to be asked when it next fires. */
interface Schedule {
  triggerId: string;
  cron: Cron;
  timeZone: string;
  /** Whether a missed occurrence is caught up. `runOnce` is the protocol's default. */
  catchUp: boolean;
}

/*
 * The two files, and the handful of answers about them that both the store and
 * the conversion of an older daemon's file need.
 *
 * Kept out here rather than inside `scheduledAutomations` because the
 * conversion writes files the store then reads, and a conversion that built
 * them its own way would be a second answer to what an automation's file is.
 */

/**
 * Whether this is a plain id: lowercase letters, digits and dashes, one to
 * sixty-four of them, starting with a letter or a digit, so a UUID is one.
 */
const isAutomationId = (id: string): boolean => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);

/**
 * The name of the file a resource is kept in, without its `.md`, or nothing
 * for a resource of another scheme.
 *
 * `ahp-automation:/<id>` with a plain id is that id, the name a person reads,
 * edits and copies. Every other resource the protocol allows is its whole URI
 * as unpadded url-safe base64, the way VS Code puts a URI into one path
 * segment: a name nothing can climb out of, and one that starts `YWhw`, in
 * upper case, where a plain id cannot.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/canvasUri.ts#L12-L18
 */
const stemOf = (resource: string): string | undefined => {
  if (!resource.startsWith(SCHEME)) return undefined;
  const id = resource.slice(PREFIX.length);
  return resource.startsWith(PREFIX) && isAutomationId(id) ? id : Buffer.from(resource, 'utf8').toString('base64url');
};

/**
 * The resource the name of a file holds, or nothing when it holds none.
 *
 * Read back only where the name is the one `stemOf` writes for what it decodes
 * to, so no other spelling of the same bytes is a second file for one
 * automation.
 */
const resourceIn = (stem: string): string | undefined => {
  if (isAutomationId(stem)) return `${PREFIX}${stem}`;
  const resource = Buffer.from(stem, 'base64url').toString('utf8');
  return stemOf(resource) === stem ? resource : undefined;
};

/** The file one automation is kept in, by the name `stemOf` gives it. */
const fileIn = (dir: string, stem: string): string => join(dir, `${stem}.md`);

/** The text of a file, or nothing when it is not there. */
const textAt = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  }
  catch {
    return undefined;
  }
};

/** One file written whole at mode `0600`: a temporary beside it, then renamed over it. */
const wrote = (file: string, text: string): void => {
  const temporary = `${file}.${String(process.pid)}.tmp`;
  // Removed first, because `mode` applies only when a file is created.
  rmSync(temporary, { force: true });
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, file);
};

/** The `.md` files in a folder that hold an automation: each name without its `.md`, and the resource it holds. */
const filesIn = (dir: string): { stem: string; resource: string }[] => readdirSync(dir, { withFileTypes: true })
  .filter((one) => one.isFile() && one.name.endsWith('.md'))
  .flatMap((one) => {
    const stem = one.name.slice(0, -'.md'.length);
    const resource = resourceIn(stem);
    return resource === undefined ? [] : [{ stem, resource }];
  });

/** What an automation's file holds beside its definition. */
export interface AutomationFileStamps {
  /** Whose work it is. */
  owner?: string;
  /** When it was made, as an ISO 8601 time. */
  createdAt?: string;
}

/**
 * One automation as the text of its file.
 *
 * The definition, whose work it is and when it was made go in the YAML
 * frontmatter; the message the automation sends is the body below it, which is
 * the one long text a person writes. Whatever else the message carried - an
 * origin, an attachment - stays in the frontmatter, so nothing a client wrote
 * is lost by the file. An owner or a time not given is not written, which is
 * the file `ahpd automation export` writes.
 */
export const automationFile = (definition: Bag, stamps: AutomationFileStamps = {}): string => {
  /*
   * The one field `StoredRecord` insists on is the one this file writes as its
   * name instead: an automation's id is the file it is in, so a copy under a
   * new name is a new automation rather than a second copy of one.
   *
   * A key held as `undefined` is one the file stopped naming - see `reread` -
   * and is left out rather than written as an empty line the person who
   * deleted it would find again.
   */
  const fields = {} as StoredRecord;
  for (const [key, value] of Object.entries(definition)) {
    if (value !== undefined) (fields as Record<string, unknown>)[key] = value;
  }
  const message = bag(fields.message);
  const text = typeof message.text === 'string' ? message.text : '';
  const rest = { ...message };
  delete rest.text;
  // Left off rather than written empty: a message that is only its text is the
  // body below, and `message: {}` says nothing a reader came for.
  if (Object.keys(rest).length === 0) delete fields.message;
  else fields.message = rest;
  fields[BODY] = text;
  if (stamps.owner !== undefined) fields.owner = stamps.owner;
  if (stamps.createdAt !== undefined) fields.createdAt = stamps.createdAt;
  return recordFile(fields, BODY);
};

/**
 * One automation from the text of its file: the definition, and whose work it
 * is and when it was made when the file says.
 *
 * Everything the file carries that is not the definition is taken out: the
 * message text below the frontmatter, the owner, and the time. An id somebody
 * wrote is dropped rather than read, because the file name is the id - so a
 * copy under a new name is a new automation whatever the frontmatter it was
 * copied from still says. Throws with what is wrong, for the caller to report.
 */
export const readAutomationFile = (text: string): { definition: Bag } & AutomationFileStamps => {
  const { [BODY]: body, owner, createdAt, id: named, ...definition } = readRecordFile(text, BODY);
  return {
    definition: {
      ...definition,
      message: { ...bag(definition.message), text: typeof body === 'string' ? body : '' },
    },
    ...(typeof owner === 'string' ? { owner } : {}),
    ...(typeof createdAt === 'string' ? { createdAt } : {}),
  };
};

/** One automation as the text of the file the store keeps it in. */
const textOf = (held: Held): string => automationFile(held.definition, held);

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
export function scheduledAutomations(options: ScheduledOptions): ScheduledStore {
  // The plugin types only: a reference is checked in `create`/`update` below,
  // where a client's save is told apart from a file this store restored.
  const inner = memoryAutomations(options.store?.pluginTypes === undefined
    ? {}
    : { pluginTypes: options.store.pluginTypes });
  /** The types a reference may be marked on, read at each client save. */
  const types = (): ReturnType<AutomationStore['triggers']> => [
    ...inner.triggers({}), ...(options.store?.pluginTypes?.() ?? []),
  ];
  const dir = options.dir;
  const state = options.state;
  const now = options.now ?? ((): Date => new Date());
  const arm = options.timer ?? ((fire, ms): { cancel(): void } => {
    const held = setTimeout(fire, ms);
    // A daemon should not be held open by the next automation, and should not
    // be kept alive by one either.
    held.unref?.();
    return { cancel: () => { clearTimeout(held); } };
  });
  const told = (message: string): void => { options.onProblem?.(message); };

  /** When each automation next fires, by resource, AHP's `nextRunAt`. Absent means nothing will fire it. */
  const nextRunAt = new Map<string, Date>();
  /** Written timestamps, kept here so they survive a reload rather than becoming the load time. */
  const stamps = new Map<string, { createdAt: string; modifiedAt: string }>();
  /**
   * What this store last computed for each automation's file, by the file's name.
   *
   * A save writes a file only when this changes, so an automation nobody
   * touched is not rewritten - and a write that does happen is this store's,
   * which the watch on the folder has to leave alone.
   */
  const said = new Map<string, string>();
  /**
   * The text each file held when this store last read or wrote it, by the file's name.
   *
   * What the watch compares against: an event for a file holding this is an
   * event this store caused, and reading it again would be reading back what
   * it just wrote.
   */
  const known = new Map<string, string>();
  const due: ((event: { automation: string; origin: Bag }) => void)[] = [];
  const changed: ((event: { automation?: string; run?: string; removed?: string }) => void)[] = [];
  let timer: { cancel(): void } | undefined;
  /** Closed: the clock is let go of, and nothing is fired or written again. */
  let closed = false;

  /** The file one automation is kept in. */
  const fileOf = (stem: string): string => fileIn(dir, stem);

  /** One file read as an automation, or nothing when it is reported instead. */
  const heldIn = (stem: string, text: string): Held | undefined => {
    const file = fileOf(stem);
    let read: ReturnType<typeof readAutomationFile>;
    try {
      read = readAutomationFile(text);
    }
    catch (error) {
      told(`${file} cannot be read: ${reason(error)}`);
      return undefined;
    }
    return {
      definition: read.definition,
      ...(read.owner === undefined ? {} : { owner: read.owner }),
      createdAt: read.createdAt ?? now().toISOString(),
    };
  };

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
    const at = nextRunAt.get(automation.resource);
    const stamp = stamps.get(automation.resource);
    return {
      ...automation,
      ...(stamp ?? {}),
      ...(at ? { nextRunAt: at.toISOString() } : {}),
    };
  };

  /**
   * Write what changed: the file of each automation whose definition moved,
   * and the state of all of them.
   *
   * One file per changed definition rather than every file every time, because
   * these are files a person edits: rewriting the ten nobody touched is ten
   * watch events, ten chances to overwrite an edit made in between, and ten
   * files whose mtime says something happened when nothing did.
   */
  const save = (): void => {
    if (closed) return;
    const held: RunState = { version: 1, automations: [] };
    const live = new Set<string>();
    for (const one of inner.list()) {
      const stem = stemOf(one.resource);
      if (stem === undefined) continue;
      live.add(stem);
      // The inner store answers the entry a client reads, which carries the
      // owner in `_meta` rather than under its own name.
      const owner = ownerOf(one._meta?.['ahpd.owner']);
      const stamp = stamps.get(one.resource) ?? { createdAt: one.createdAt, modifiedAt: one.modifiedAt };
      const text = textOf({
        definition: one.definition,
        ...(owner === undefined ? {} : { owner }),
        createdAt: stamp.createdAt,
      });
      if (said.get(stem) !== text) {
        try {
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          wrote(fileOf(stem), text);
          said.set(stem, text);
          known.set(stem, text);
        }
        catch (error) {
          told(`Could not write ${fileOf(stem)}: ${reason(error)}`);
        }
      }
      const at = nextRunAt.get(one.resource);
      held.automations.push({
        resource: one.resource,
        // Absent while the definition names no allowance, which is what the
        // entry carries too - a count written for an automation that has none
        // is a number nothing will ever read.
        ...(one.runCount === undefined ? {} : { runCount: one.runCount }),
        ...(one.customizations === undefined ? {} : { customizations: one.customizations }),
        modifiedAt: stamp.modifiedAt,
        ...(at ? { nextRunAt: at.toISOString() } : {}),
      });
    }
    // The file of one that is gone goes with it, and so does its state row -
    // which is this list, and the row was simply not added to it.
    for (const stem of [...said.keys()]) {
      if (live.has(stem)) continue;
      said.delete(stem);
      known.delete(stem);
      rmSync(fileOf(stem), { force: true });
    }
    try {
      // Owner-only, as the daemon's own records are: this names whose work an
      // automation is, and that is not everybody's business on a host with
      // more than one person on it.
      writeJsonAtomic(state, held);
    }
    catch (error) {
      told(`Could not write ${state}: ${reason(error)}`);
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
        nextRunAt.set(automation.resource, found.at);
        if (!first || found.at < first) first = found.at;
      }
      else nextRunAt.delete(automation.resource);
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

  /**
   * Say what is due, then look again.
   *
   * Every automation due at this instant is taken before any of them is
   * announced. A listener runs the automation it was told about, and a run
   * writes the store - which reaches `onChanged`, rearms the clock from now,
   * and moves every other automation to its next occurrence. Read one at a
   * time, the second automation due at this same instant was read after the
   * first one's run had already pushed it past the clock, and was passed over:
   * two automations on one schedule, and only one of them ever fired.
   *
   * An occurrence reached a minute or more after it was due, a machine that
   * slept or a timer that ran late, is a catch-up, as VS Code's scheduler
   * marks one: its run says `catchUp`, and a trigger whose misfire policy is
   * `skip` does not run it. The rearm after it moves it on either way.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L915-L938
   */
  const fire = (): void => {
    if (closed) return;
    const at = now();
    const ready: { automation: string; when: Date; origin: Bag }[] = [];
    for (const automation of inner.list()) {
      const when = nextRunAt.get(automation.resource);
      if (!when || when > at) continue;
      const schedule = soonest(automation, new Date(when.getTime() - 1));
      const late = at.getTime() - when.getTime() >= 60_000;
      if (late && schedule?.schedule.catchUp === false) continue;
      ready.push({
        automation: automation.resource,
        when,
        origin: {
          kind: 'trigger',
          triggerId: schedule?.schedule.triggerId ?? '',
          scheduledFor: when.toISOString(),
          ...(late ? { catchUp: true } : {}),
        },
      });
    }
    for (const one of ready) {
      for (const listener of due) listener({ automation: one.automation, origin: one.origin });
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

  /**
   * The run state of every automation, by resource, or nothing while the file
   * cannot be used.
   *
   * No file is a daemon's first start: a store with no run state in it, and
   * nothing to say. A file that is there and cannot be read, or that holds what
   * this version does not understand, is the only record of what each
   * allowance has paid for and what each automation is waiting on. So it is
   * said, and automations stay unavailable until it is recovered, as VS Code's
   * do over storage that does not load: nothing runs on state that could not
   * be read, and nothing is written over the file.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L764-L778
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStorageService.ts#L123-L143
   */
  const stateOf = (): Map<string, StateRow> | undefined => {
    const out = new Map<string, StateRow>();
    const read = readJson(state);
    if (!read.ok && read.kind === 'missing') return out;
    if (!read.ok) {
      told(`Could not read ${state}: ${reason(read.error)}. Automation state and execution remain unavailable.`);
      return undefined;
    }
    const held = bag(read.value) as Partial<RunState>;
    if (held.version !== 1 || !Array.isArray(held.automations)) {
      told(`${state} is not something this version understands, and was left alone. Automation execution remains unavailable until it is recovered.`);
      return undefined;
    }
    for (const one of held.automations) {
      if (typeof one?.resource === 'string') out.set(one.resource, one);
    }
    return out;
  };

  /**
   * Read what was written: the folder, joined with the run state.
   *
   * A file with no row in the state file is an automation with no run state,
   * which is what a copy of another automation's file is - it has used none of
   * an allowance, and nothing is waiting for it.
   */
  const load = (rows: Map<string, StateRow>): { resource: string; nextRunAt?: string }[] => {
    const back: { resource: string; nextRunAt?: string }[] = [];
    // No folder is a daemon that has never been given an automation, which is
    // no automations rather than a problem.
    if (!existsSync(dir)) return back;
    let files: { stem: string; resource: string }[];
    try {
      files = filesIn(dir);
    }
    catch (error) {
      told(`Could not read ${dir}: ${reason(error)}`);
      return back;
    }
    for (const { stem, resource } of files) {
      const file = fileOf(stem);
      const text = textAt(file);
      if (text === undefined) continue;
      const held = heldIn(stem, text);
      if (held === undefined) continue;
      const row = rows.get(resource);
      // What an allowance has paid for survives with the definition, because
      // the protocol says it is not reconstructed from the runs.
      const runCount = typeof row?.runCount === 'number' ? row.runCount : undefined;
      // Read for what a copy has to be, and nothing more: this is the host's
      // own file, but a copy without an id or a URI is one no session could be
      // handed, and one of those in the file is not a reason to lose the
      // definition it sits beside.
      const customizations = Array.isArray(row?.customizations)
        ? row.customizations.filter((copy) => typeof copy?.id === 'string' && typeof copy.uri === 'string')
        : undefined;
      try {
        inner.create(resource, held.definition, ownerOf(held.owner), runCount, customizations);
      }
      catch (error) {
        // A definition this host refuses, which the file of a person may name.
        // Reported and skipped rather than thrown: one file nothing can run is
        // not a reason for a daemon to start with no automations at all.
        told(`${file} was not loaded: ${reason(error)}`);
        continue;
      }
      stamps.set(resource, {
        createdAt: held.createdAt,
        modifiedAt: typeof row?.modifiedAt === 'string' ? row.modifiedAt : now().toISOString(),
      });
      said.set(stem, textOf(held));
      known.set(stem, text);
      back.push({
        resource,
        ...(typeof row?.nextRunAt === 'string' ? { nextRunAt: row.nextRunAt } : {}),
      });
    }
    return back;
  };

  const rows = stateOf();
  const available = rows !== undefined;
  // What was on the clock when this daemon last wrote itself down. Read before
  // `rearm`, which replaces it with what is on the clock now.
  const wasWaiting = rows === undefined ? [] : load(rows);
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

  /**
   * One file read again, once the events of one save have settled.
   *
   * A file that is gone takes its automation with it, a file holding what this
   * store wrote last is no change, and a file the host refuses is reported with
   * the definition this store already had left where it was.
   *
   * Everything it changes goes through the inner store, which is what announces
   * the change: the clock is armed again and every listener hears about it on
   * the same path a client's own write takes.
   */
  const reread = (stem: string, resource: string): void => {
    const file = fileOf(stem);
    const text = textAt(file);
    if (text === undefined) {
      known.delete(stem);
      inner.remove(resource);
      return;
    }
    // What this store last wrote or read. An event for a file holding it is an
    // event this store caused, and reading it again would be reading back what
    // it just wrote.
    if (known.get(stem) === text) return;
    known.set(stem, text);
    const held = heldIn(stem, text);
    if (held === undefined) return;
    const before = inner.get(resource);
    /*
     * When the file says it was made, and now for when it last moved: the same
     * pair a client's write leaves.
     *
     * Set before the change rather than after it, because the change writes the
     * file - and a write that happened first would carry the timestamp this
     * store would have invented for an automation it had never seen, rather
     * than the one the file a person wrote actually holds.
     */
    const stamp = stamps.get(resource);
    stamps.set(resource, { createdAt: held.createdAt, modifiedAt: now().toISOString() });
    try {
      if (before === undefined) {
        inner.create(resource, held.definition, ownerOf(held.owner));
      }
      else {
        /*
         * The file's definition exactly, rather than a patch of it.
         *
         * `update` leaves an absent key alone, which is what a client's patch
         * means - and not what a file means: a person who deletes a line is
         * saying the automation no longer has that field, so a key the old
         * definition had and the file no longer names is cleared with it.
         */
        const changes: Bag = {};
        for (const key of new Set([...Object.keys(before.definition), ...Object.keys(held.definition)])) {
          changes[key] = held.definition[key];
        }
        inner.update(resource, changes);
      }
    }
    catch (error) {
      // A definition a person may write and this host will not run. Reported and
      // skipped, with the definition the store already had left in place - and
      // the stamp with it, since an automation that did not move did not move.
      if (stamp === undefined) stamps.delete(resource);
      else stamps.set(resource, stamp);
      told(`${file} was not loaded: ${reason(error)}`);
      return;
    }
  };

  /*
   * The folder, watched so an edit made while this daemon runs is one it acts
   * on at once.
   *
   * One file read again after its events settle rather than on each of them: a
   * save is several events - a temporary written, a rename - and reading
   * between them is reading a file nobody has finished writing.
   *
   * The folder is made first, because a daemon that has never been given an
   * automation still has to notice the first one somebody drops in. A store
   * whose state file could not be read watches nothing, because an edit read
   * then would be an automation loaded, run and written over that file.
   */
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let watching: FSWatcher | undefined;
  if (available) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      watching = watchPath(dir, (_event, changed) => {
        // A temporary file, another name, or no name at all is not an automation.
        if (changed === null || changed === undefined) return;
        const named = String(changed);
        if (!named.endsWith('.md')) return;
        const stem = named.slice(0, -'.md'.length);
        const resource = resourceIn(stem);
        if (resource === undefined) return;
        clearTimeout(pending.get(stem));
        const timer = setTimeout(() => {
          pending.delete(stem);
          reread(stem, resource);
        }, WINDOW);
        // A watch should not be what keeps a daemon up.
        timer.unref();
        pending.set(stem, timer);
      });
      watching.on('error', (error) => { told(`${dir} is no longer watched: ${reason(error)}`); });
      watching.unref();
    }
    catch (error) {
      told(`${dir} cannot be watched, so an edit there is read at the next start: ${reason(error)}`);
    }
  }

  /** VS Code's refusal of every write while the run state could not be read. */
  const usable = (): void => {
    if (!available) throw new Error(AUTOMATIONS_UNAVAILABLE);
  };

  return {
    ...inner,
    available,
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

    create: (resource, definition, owner, runCount, customizations) => {
      usable();
      // VS Code's refusal of a resource in another scheme, before the store
      // underneath is asked: every automation here is a file named after its
      // resource.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L1513-L1517
      const stem = stemOf(resource);
      if (stem === undefined) throw new Error(`Automation resource must use the ahp-automation scheme: ${resource}`);
      // A file already at that name is one this write would replace: another
      // automation's, on a file system that folds case, or a file a person
      // wrote that this host could not load.
      if (inner.get(resource) === undefined && existsSync(fileOf(stem))) {
        throw new Error(`Automation file already exists: ${fileOf(stem)}`);
      }
      checkReferences(definition, owner, types(), options.store?.connectors, options.store?.agents, options.store?.hasUsers);
      const made = inner.create(resource, definition, owner, runCount, customizations);
      stamps.set(resource, { createdAt: made.createdAt, modifiedAt: made.modifiedAt });
      // `onChanged` above has already rearmed and written; the stamp is set
      // before this returns so what it wrote carries the right one.
      save();
      return dressed(inner.get(resource) ?? made);
    },

    update: (resource, changes, customizations) => {
      usable();
      // A patch never moves the owner, so a trigger or a session template it
      // writes is judged against the automation's own owner rather than the
      // editor's.
      if (changes.triggers !== undefined || changes.session !== undefined) {
        const held = inner.get(resource);
        const owner = ownerOf((held?._meta as Bag | undefined)?.['ahpd.owner']);
        if (changes.triggers !== undefined) checkReferences(changes, owner, types(), options.store?.connectors, options.store?.agents, options.store?.hasUsers);
        if (changes.session !== undefined) {
          checkReferences({ session: changes.session }, owner, types(), options.store?.connectors, options.store?.agents, options.store?.hasUsers);
        }
      }
      const after = inner.update(resource, changes, customizations);
      if (!after) return undefined;
      const stamp = stamps.get(resource);
      if (stamp) stamps.set(resource, { ...stamp, modifiedAt: after.modifiedAt });
      save();
      return dressed(inner.get(resource) ?? after);
    },

    remove: (resource) => {
      usable();
      const gone = inner.remove(resource);
      if (!gone) return false;
      stamps.delete(resource);
      nextRunAt.delete(resource);
      save();
      return true;
    },

    run: async (resource, origin, start) => {
      usable();
      return inner.run(resource, origin, start);
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

    close: () => {
      closed = true;
      disarm();
      watching?.close();
      watching = undefined;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}

/** How the one file an earlier daemon kept every automation in is converted. */
export interface AutomationMigrationOptions {
  /** The one file a daemon before this layout left behind, `<configDir>/automations.json`. */
  file: string;
  /** The folder the conversion writes one `.md` file per automation into. */
  dir: string;
  /** The one file the run state of all of them goes in. */
  state: string;
  /** Somewhere to say that it could not be read or written. */
  onProblem?(message: string): void;
}

/** What the one file held, before an automation was a Markdown file. */
interface Whole {
  version: 1;
  automations: {
    resource: string;
    definition: Bag;
    owner?: string;
    runCount?: number;
    customizations?: CapturedPlugin[];
    createdAt: string;
    modifiedAt: string;
    nextRunAt?: string;
  }[];
}

/**
 * Split a file of automations written as one file into a file per automation,
 * once.
 *
 * A daemon that carried every automation it ever saw has them all in one file,
 * and the store this version opens reads a folder. So the rows become that
 * folder's files, the run state of all of them becomes the state file, and the
 * old file is renamed out of the way - which is what says it has been read: a
 * daemon that finds the folder already holding an automation leaves both alone,
 * and so does one that finds no file.
 *
 * Every row's definition, owner and run state are carried as they were
 * written. A config a later version would refuse is a person's setting, and is
 * read back as the store reads any other stored value.
 *
 * A file this version cannot read is left exactly as it is and named in a
 * warning: it is the only copy of what somebody scheduled, and guessing at it
 * is worse than leaving it for a daemon that can read it.
 */
export function migrateAutomations(options: AutomationMigrationOptions): void {
  const said = (message: string): void => { options.onProblem?.(message); };
  // An automation already in the folder means the split has happened, whatever
  // became of the file. The folder itself may be there and empty - a daemon
  // that started, wrote nothing and stopped leaves one - so it is the files
  // that answer this rather than the folder.
  try {
    if (filesIn(options.dir).length > 0) return;
  }
  catch {
    // No folder at all, which is a daemon that has never kept an automation.
  }
  const read = readJson(options.file);
  // Not there, which is what a first run looks like.
  if (!read.ok && read.kind === 'missing') return;
  if (!read.ok) {
    said(`Could not read ${options.file}: ${reason(read.error)}`);
    return;
  }
  const whole = read.value as Partial<Whole>;
  if (whole.version !== 1 || !Array.isArray(whole.automations)) {
    said(`${options.file} is not an automation store this version can read, and was left alone`);
    return;
  }
  const rows: StateRow[] = [];
  try {
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
    for (const row of whole.automations) {
      const stem = typeof row?.resource === 'string' ? stemOf(row.resource) : undefined;
      // A row nothing could name a file after is left behind with a word about
      // it: the file is the automation here, so one whose resource is not an
      // automation's is one this version has nowhere to keep.
      if (stem === undefined) {
        said(`${options.file}: ${String(row?.resource ?? 'a row')} is not an automation this version can keep, and was left behind`);
        continue;
      }
      const definition = bag(row.definition);
      const owner = typeof row.owner === 'string' ? row.owner : undefined;
      const createdAt = typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString();
      wrote(fileIn(options.dir, stem), textOf({
        definition,
        ...(owner === undefined ? {} : { owner }),
        createdAt,
      }));
      rows.push({
        resource: row.resource,
        // Absent while the row named no allowance, as the store writes it: a
        // count for an automation that has none is a number nothing reads.
        ...(typeof row.runCount === 'number' ? { runCount: row.runCount } : {}),
        ...(Array.isArray(row.customizations) ? { customizations: row.customizations } : {}),
        modifiedAt: typeof row.modifiedAt === 'string' ? row.modifiedAt : createdAt,
        ...(typeof row.nextRunAt === 'string' ? { nextRunAt: row.nextRunAt } : {}),
      });
    }
    writeJsonAtomic(options.state, { version: 1, automations: rows });
    // Renamed rather than deleted, and only once every row is a file: a daemon
    // that is killed halfway has to find something to start from again.
    renameSync(options.file, `${options.file}.migrated`);
  }
  catch (error) {
    said(`Could not convert ${options.file}: ${reason(error)}`);
  }
}

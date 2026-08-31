/** Automations: a session started by a trigger rather than by a person. */

import type { Bag } from './common.js';

/**
 * One automation, as the catalogue channel carries it.
 *
 * The definition is the client's - it wrote it and can patch it - and
 * everything around it is the store's: when it will next fire, what it has
 * done, and which of the three verbs may be used on it now.
 */
export interface Automation {
  /** `ahp-automation:/<id>`. The channel a run is reported against names it. */
  resource: string;
  /** What the client asked for. Opaque here except for `enabled` and `title`. */
  definition: Bag;
  /** ISO 8601, when a schedule says it will fire next. Absent for one nothing will fire. */
  nextRunAt?: string;
  /** Newest first. A summary per run, not the runs themselves. */
  runs: Bag[];
  /** More runs than were sent, if there are. */
  runsNextCursor?: string;
  /** Which of `update`, `remove`, `run` this store will accept for it now. */
  operations: ('update' | 'remove' | 'run')[];
  createdAt: string;
  modifiedAt: string;
}

/** One run of one automation. */
export interface AutomationRun {
  /** `ahp-automation-run:/<id>`, which is also a channel a client may watch. */
  resource: string;
  /** The automation it is a run of. */
  automation: string;
  /** Why it started: somebody pressed it, or a trigger fired. */
  origin: Bag;
  /** `pending`, `running`, `completed`, `failed`, `cancelled`, and when each happened. */
  lifecycle: Bag;
  /** The sessions it started. Usually one. */
  sessions: string[];
  /** The one a client should open when it opens the run. */
  primarySession?: string;
}

/** How a store asks the host to start a session, since only the host can. */
export interface StartSession {
  /** The provider named in the automation's session template, or the default. */
  provider?: string;
  /** Where it should work. */
  workingDirectory?: string;
  /** Config values for the new session. */
  config?: Record<string, string>;
  /** The first message, which is what the automation is *for*. */
  text: string;
}

/**
 * Where a host's automations come from.
 *
 * A port, like the filesystem and the shell, and for a reason of its own: an
 * automation that fires on a schedule needs something holding a clock, and a
 * host embedded in an editor already has one while a daemon on a box may
 * deliberately have none. A host given no store advertises no automations
 * channel and answers `-32601` for all three commands - which is a true answer
 * rather than an empty screen.
 *
 * Nothing here schedules. `run` is called when a person presses Run or when
 * whatever *is* holding a clock decides it is time; deciding it is time is the
 * store's business and this interface does not describe it.
 */
export interface AutomationStore {
  /** Every automation, for the catalogue channel's snapshot. */
  list(): Automation[];
  /** One, by resource URI. Undefined for one this store has never heard of. */
  get(resource: string): Automation | undefined;

  /**
   * The kinds of trigger this store understands.
   *
   * Asked before any automation exists, because it is what a client needs to
   * draw the form: a store that schedules nothing answers with the event
   * triggers it has and no schedule, and a client then offers no cron box.
   * Empty is a real answer.
   */
  triggers(options: { provider?: string; workingDirectories?: string[] }): Bag[];

  /** Write one the client has just described. */
  create(resource: string, definition: Bag): Automation;
  /** Patch one. Absent keys are left alone, which is what a patch means. */
  update(resource: string, changes: Bag): Automation | undefined;
  /** Forget one, and everything it ever did. */
  remove(resource: string): boolean;

  /**
   * Start a run.
   *
   * `start` is handed in rather than reached for: only the host can create a
   * session, and a store that could would be a second thing that knows what a
   * session is. It answers the session URI, and the store records it.
   */
  run(
    resource: string,
    origin: Bag,
    start: (options: StartSession) => Promise<string>,
  ): Promise<AutomationRun | undefined>;

  /** One run's own state, for the channel a client watches it on. */
  runOf(resource: string): AutomationRun | undefined;
  /** A page of an automation's runs, newest first. */
  runs(resource: string, cursor?: string): { items: Bag[]; nextCursor?: string };

  /**
   * Called when something in here moved, so the host can say so.
   *
   * The store owns the clock and the host owns the channels, so this is the
   * only way an automation that fired on its own reaches anybody.
   */
  onChanged?(observer: (event: { automation?: string; run?: string; removed?: string }) => void): void;
}

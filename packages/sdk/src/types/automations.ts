/** Automations: a session started by a trigger rather than by a person. */

import type { AutomationOperation, AutomationTriggerDefinition, SessionOriginKind } from '@microsoft/agent-host-protocol';

import type { Bag } from './common.js';
import type { Owner } from './usage.js';

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
  /**
   * Who made it - decision `work-is-owned-by-a-typed-reference`.
   *
   * Set once, by the connection that created it, and never patched: an
   * automation somebody else may run or switch off is still their work. Absent
   * where nobody was behind it, which is every automation written before this
   * and every one made on a host with no users directory.
   *
   * The store's own field, and the gates read it here. A client never sees it
   * under this name: the protocol declares `_meta` on an automation entry and
   * no `owner`, so what goes out is `_meta['ahpd.owner']` - see
   * {@link AutomationEntry}.
   */
  owner?: Owner;
  /** ISO 8601, when a schedule says it will fire next. Absent for one nothing will fire. */
  nextRunAt?: string;
  /** Newest first. A summary per run, not the runs themselves. */
  runs: Bag[];
  /** More runs than were sent, if there are. */
  runsNextCursor?: string;
  /** Which of `update`, `remove`, `run` this store will accept for it now. */
  operations: `${AutomationOperation}`[];
  createdAt: string;
  modifiedAt: string;
}

/**
 * One automation as a client receives it.
 *
 * The stored record less `owner`, and the reason it is a type of its own: the
 * protocol's `AutomationEntry` declares `_meta` and no `owner`, so an owner
 * that rode out under its own name would be a field no client can read. It goes
 * as `_meta['ahpd.owner']`, and a type that will not hold `owner` is what keeps
 * it off the wire.
 */
export interface AutomationEntry extends Omit<Automation, 'owner'> {
  /** `ahpd.owner`, when the automation is somebody's work. */
  _meta?: Record<string, unknown>;
}

/** One run of one automation. */
export interface AutomationRun {
  /** `ahp-automation-run:/<id>`, which is also a channel a client may watch. */
  resource: string;
  /** The automation it is a run of. */
  automation: string;
  /**
   * Whose work this run is, which is the automation's owner.
   *
   * Not whoever pressed the button: the protocol's manual origin carries no
   * room for who asked, and a run pressed by a colleague is still the
   * automation maker's work. Absent where the automation names no owner.
   *
   * Stored, never sent under this name: the run state carries it as
   * `_meta['ahpd.owner']`, as an automation entry does.
   */
  owner?: Owner;
  /** Why it started: somebody pressed it, or a trigger fired. */
  origin: Bag;
  /** `pending`, `running`, `completed`, `failed`, `cancelled`, and when each happened. */
  lifecycle: Bag;
  /** The sessions it started. Usually one. */
  sessions: string[];
  /** The one a client should open when it opens the run. */
  primarySession?: string;
  /**
   * What the host has noted about it while it ran.
   *
   * Sent to a client as `_meta`, beside `ahpd.owner`: the protocol declares
   * `_meta` on a run's state and on its summary both, and this is where a fact
   * the host decided about the run goes - how many events arrived while it was
   * going and were dropped, most of all.
   */
  notes?: Record<string, unknown>;
}

/**
 * One run as a client receives it, on the run's own channel.
 *
 * The stored record less `owner`, for the reason {@link AutomationEntry} gives:
 * the protocol's `AutomationRunState` declares `_meta` and no `owner`.
 */
export interface AutomationRunState extends Omit<AutomationRun, 'owner'> {
  /** `ahpd.owner`, when the run is somebody's work. */
  _meta?: Record<string, unknown>;
}

/** How a store asks the host to start a session, since only the host can. */
export interface StartSession {
  /** The provider named in the automation's session template, or the default. */
  provider?: string;
  /** Where it should work. */
  workingDirectory?: string;
  /** Config values for the new session. */
  config?: Record<string, unknown>;
  /** The model the session template names, as the protocol's `ModelSelection`. */
  model?: unknown;
  /** The first message, which is what the automation is *for*. */
  text: string;
  /**
   * Whose work this session is, which is the automation's owner.
   *
   * Carried on the way in rather than looked up, because the host is what
   * opens a session and a store that fetched the owner to do it would be a
   * second thing holding the clock. Absent for an automation that names none.
   */
  owner?: Owner;
  /**
   * The run this session will belong to.
   *
   * Passed down rather than looked up, because it becomes the session's own
   * `origin` and a catalogue is where it is read: a session that started at
   * nine with nobody at the keyboard is otherwise a row with no account of
   * itself, sitting among rows somebody typed.
   */
  origin?: { kind: `${SessionOriginKind}`; automation: string; run: string };
}

/** How a run's execution ended, for a store to record. */
export interface RunEnding {
  status: 'completed' | 'failed' | 'cancelled';
  /** Why it failed, when it did. */
  error?: { message: string };
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
 * Deciding it is time is the store's business. `run` is called when a person
 * presses Run or when a store holding a clock says one is due through
 * `onDue` - so what a schedule means, and when it comes round, is behind this
 * interface and not in front of it.
 */
export interface AutomationStore {
  /** Every automation, for the catalogue channel's snapshot. */
  list(): AutomationEntry[];
  /** One, by resource URI. Undefined for one this store has never heard of. */
  get(resource: string): AutomationEntry | undefined;

  /**
   * The *event* triggers this store understands.
   *
   * Only event triggers: a schedule trigger is protocol-defined, is never
   * listed here, and may always be written - what a client learns from a host
   * that will not fire one is the absent `nextRunAt`, not an absence here.
   * Manual is not a trigger either; an empty trigger list on a definition is
   * what manual-only means. So empty is a real answer, and the one every store
   * gave before this host learned to wake on a session.
   *
   * Each definition is the protocol's own, schema and all, because a client
   * draws the automation form from it: a type listed here is a type this host
   * will fire.
   */
  triggers(options: { provider?: string; workingDirectories?: string[] }): AutomationTriggerDefinition[];

  /**
   * Write one the client has just described.
   *
   * `owner` is whose it is, from the connection that asked for it. Only
   * `create` takes it: an automation's owner is fixed by the person who made
   * it, and `update` patches a definition rather than moving the work to
   * whoever edited it last.
   */
  create(resource: string, definition: Bag, owner?: Owner): AutomationEntry;
  /** Patch one. Absent keys are left alone, which is what a patch means. */
  update(resource: string, changes: Bag): AutomationEntry | undefined;
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

  /**
   * Say a run's execution ended, so it stops reading as `running`.
   *
   * The host is the only thing that sees a turn finish and this store is the
   * only thing that owns the run, so the ending is handed over rather than
   * derived from state the store cannot see. A run that is already terminal is
   * left alone and this answers false: a late event from a session the run no
   * longer holds must not reopen a finished run.
   */
  settle?(run: string, ending: RunEnding): boolean;

  /**
   * Note something about a run, so the run itself carries it.
   *
   * The host is what decides how an event that arrives while a run is going is
   * answered, and the run is where the answer belongs: a client watching it
   * reads the count there rather than being told separately. Absent keys are
   * left alone. Optional like the rest, so a store that keeps its runs
   * immutable simply leaves it out.
   */
  note?(run: string, notes: Record<string, unknown>): boolean;

  /** One run's own state, for the channel a client watches it on. */
  runOf(resource: string): AutomationRun | undefined;
  /**
   * Bring one more page of an automation's runs into view.
   *
   * It answers whether the cursor was one this store issued, and nothing a
   * client reads: `FetchAutomationRunsResult` is empty, and the page itself
   * arrives on the catalogue as an `automation/set` carrying the automation's
   * entry with the longer `runs` and the next `runsNextCursor`.
   *
   * The cursor is the entry's own `runsNextCursor`. An omitted cursor means
   * the page already in view; anything else is answered false rather than
   * advancing, because a page of new runs for a question about old ones is a
   * client that pages for ever without noticing.
   */
  runs(resource: string, cursor?: string): boolean;

  /**
   * Let go of a session a run was holding.
   *
   * Called when the session is disposed: a run keeps a list of URIs and a
   * host that removed the session without saying so would leave a run
   * pointing at a channel nobody can open. Removing the primary clears it,
   * which is what the protocol says. Answers whether the set actually moved,
   * so a URI a run never had is a no-op rather than an announcement.
   *
   * Optional, like everything else a store may not do: a store that keeps its
   * runs immutable simply leaves it out.
   */
  unlink?(run: string, session: string): boolean;

  /**
   * Called when something in here moved, so the host can say so.
   *
   * The store owns the clock and the host owns the channels, so this is the
   * only way an automation that fired on its own reaches anybody.
   */
  onChanged?(observer: (event: { automation?: string; run?: string; removed?: string }) => void): void;

  /**
   * Called when this store's clock says one is due.
   *
   * The counterpart of `run`, and the reason that method takes `start` rather
   * than holding it: a store that fires on its own still cannot create a
   * session, so it says *which* automation is due and with what origin, and
   * the host - the only thing that knows what a session is - calls `run`. A
   * store with no clock never calls this, and a host that never wired it is a
   * host where nothing fires by itself.
   *
   * The origin is the store's because only it knows which trigger came round,
   * which occurrence it was, and whether it is catching one up.
   */
  onDue?(observer: (event: { automation: string; origin: Bag }) => void): void;

  /**
   * Let go of the clock and of the file: nothing fires and nothing is written
   * after, so a daemon shutting down is not held open by one and a successor
   * reading the same file is its only writer.
   */
  close?(): void;
}

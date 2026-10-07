/**
 * What a session does, and what an automation watches for.
 *
 * A `SessionEvent` is one thing a session did, said in the host's own words
 * rather than the protocol's: a turn ended, a tool call failed, a message
 * waited behind a running turn, a child finished. The rule engine reads that
 * stream and decides which of them wakes an automation.
 *
 * The stream is the host's, not a backend's. A backend says what a turn did,
 * and the host is the only thing that sees every chat of every session and
 * knows which of them belongs to which - so an event names the session and
 * carries what a rule may filter and count on.
 */

/** The kinds of thing a session does that a rule may wake on. */
export type SessionEventKind =
  | 'turnCompleted'
  | 'turnFailed'
  | 'turnCancelled'
  | 'toolCalled'
  | 'toolFailed'
  | 'messageQueued'
  | 'idle'
  | 'childFinished';

/** A tool call as a rule sees it: what was called, and a hash of what it was called with. */
export interface SessionToolCall {
  /** The backend's own name for the tool, as the call announced it. */
  name: string;
  /**
   * A hash of the call's input.
   *
   * A hash rather than the input, because a rule asks whether two calls are
   * the same call - "this tool, this input, three times" - and the input of an
   * ordinary call is a file's worth of text nobody wants held for every call
   * of every session.
   */
  inputHash: string;
}

/**
 * What anything the host says about a session says, whatever it is.
 *
 * The host settles these before it says anything, so a rule may filter on them
 * without asking anybody: which session, when, and the four facts the host has
 * to hand - who owns it, what it runs on, what its work is charged to, where it
 * works, and whether a run made it rather than a person.
 */
export interface SessionAbout {
  /** The session this is about, as the host publishes it. */
  session: string;
  /** When it happened, ISO 8601. */
  at: string;
  /** Who owns the session, where this host recorded an owner. */
  owner?: string;
  /** The harness the session runs on, where one was recorded. */
  provider?: string;
  /** The project the session's work is charged to, where one was decided. */
  project?: string;
  /** Where the session works, as the catalogue publishes it. */
  folders: string[];
  /** Whether an automation started it, rather than a person. */
  automated: boolean;
}

/**
 * One thing a session did.
 *
 * `session` is the session the event is about, which for a child that
 * finished is the session that is told rather than the one that ended;
 * `child` names the one that ended. The rest is what a rule filters, counts
 * and checks on, and what a woken run's message is filled from.
 */
export interface SessionEvent extends SessionAbout {
  kind: SessionEventKind;
  /** What was called, on `toolCalled` and `toolFailed`. */
  tool?: SessionToolCall;
  /** How many tool calls the running turn of this chat has run so far. */
  turnToolCalls?: number;
  /** Whether a turn is running in this chat. */
  running?: boolean;
  /** How many messages wait behind the running turn. */
  queued?: number;
  /** The worker chat or child session that ended, on `childFinished`. */
  child?: string;
}

/**
 * A turn that started.
 *
 * Nothing emits an event during a turn that is working quietly, so a rule
 * about a turn that has run too long cannot be woken by one. The host says the
 * start instead, and the engine times it from there: this is not one of the
 * kinds a rule may be written on, and it never reaches `onMatch`.
 */
export type SessionTurn = SessionAbout;

/**
 * One rule: an event, and the conditions around it.
 *
 * Every rule watches one event kind, and the three other parts are optional.
 * `filter` narrows which sessions the rule looks at, `count` says how many
 * times the event has to happen, `then` says what has to follow it, and `when`
 * checks the state of the session as the event arrives.
 */
export interface SessionRule {
  /** The event this rule watches for. */
  on: SessionEventKind;
  /** Which sessions it looks at. Every one of these is optional, and an absent one takes everything. */
  filter?: {
    sessions?: string[];
    providers?: string[];
    owners?: string[];
    projects?: string[];
    folders?: string[];
    /** Whether the session is one an automation started, rather than a person. */
    automated?: boolean;
  };
  /** How many events, and how they are counted. */
  count?: {
    n: number;
    /** Only a run of them with nothing else in between. */
    consecutive?: boolean;
    /** Only this many of them, as a duration such as `5m`. */
    within?: string;
    /** Only ones whose tool and input match the first. */
    sameInput?: boolean;
  };
  /** What has to happen after the event for the rule to hold. */
  then?:
    | { kind: 'event'; event: SessionEventKind; within: string }
    | { kind: 'idle'; for: string }
    | { kind: 'absent'; event: SessionEventKind; for: string };
  /** What the session has to look like as the event arrives. */
  when?: {
    running?: boolean;
    queuedAtLeast?: number;
    toolCallsAtLeast?: number;
    turnLongerThan?: string;
  };
}

/**
 * What an automation says about waking, kept in `_meta.ahpd` on its definition.
 *
 * The protocol has a trigger with a type, an event and a config and no field
 * for the rest of this, so these ride beside it.
 */
export interface AutomationWake {
  /** Whether each run gets a session of its own or the next turn in one chat. */
  session?: 'new' | 'pinned';
  /** What an event does while the automation's last run is still running. */
  overlap?: 'queue' | 'steer' | 'parallel' | 'skip';
  /** The chat a pinned automation runs in, written by the host once it has one. */
  pinnedSession?: string;
}

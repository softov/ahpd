/** What a session does, matched against what an automation watches for. */

import type { SessionAbout, SessionEvent, SessionEventKind, SessionRule, SessionTurn } from './types/triggers.js';

/**
 * The rule engine.
 *
 * One rule per automation, and one state per automation and session: the
 * events that matched, and the follow-up a rule is waiting for. Nothing here
 * starts a run, holds a session or knows what an automation is beyond the name
 * it was added under - a match is handed to `onMatch` and what happens next is
 * the host's.
 *
 * **The clock is handed in.** A rule may wait for quiet or for a follow-up
 * that never comes, and a test that had to sit through three minutes of quiet
 * would be a test nobody runs. So `now` and `setTimer` are given, both the way
 * the schedule store gives its own.
 *
 * **The state is in memory, and a restart loses it.** A count halfway to three
 * and a quiet period half waited are both gone when the process goes, which
 * costs the wake that was in flight and nothing else - the rules themselves
 * are on the automations, where they survive.
 *
 * **The host settles what a rule filters on.** An event carries the session,
 * its owner, its provider, its project, where it works and whether a run made
 * it, and every one of those is filled in before the event reaches here - so a
 * rule names facts rather than asking anybody for them.
 *
 * **A turn that goes quiet is timed here.** Nothing emits an event while a
 * turn runs without saying anything, so a rule about a turn that has gone
 * quiet cannot be woken by one. The host says the turn started instead, the
 * engine holds when the session last said anything, and arms its own timer -
 * the one wait in a rule that no event completes. What that timer waits for is
 * the quiet rather than the turn: a turn that keeps talking is one that is not
 * stuck, so the wait runs from the last thing it said.
 */
export interface RuleEngine {
  /** Watch one rule under an automation's name, replacing any rule already there. */
  add(automation: string, rule: SessionRule): void;
  /** Stop watching, and drop whatever the rule was waiting for. */
  remove(automation: string): void;
  /** One thing a session did, offered to every rule. */
  feed(event: SessionEvent): void;
  /** A turn started, which is what a rule about a turn's length is timed from. */
  started(turn: SessionTurn): void;
  /**
   * The session did something the wire carries no event for.
   *
   * A turn's words stream as deltas and a tool call begins, takes its input and
   * streams a message of its own - none of which is anything a rule may be
   * written on, and all of which is a turn that is working. This is what keeps a
   * rule about a turn that has gone quiet from firing on one that is doing
   * plenty.
   */
  moved(session: string): void;
  /** A session is gone: nothing is waiting for it any more. */
  end(session: string): void;
  /** Drop every wait. */
  close(): void;
}

/** What a rule matched, and what a run is told about it. */
export interface RuleMatch {
  /** The name the rule was added under, which is the automation's resource. */
  automation: string;
  session: string;
  /** The event kind the rule watched for. */
  on: SessionEventKind;
  /**
   * The last event, which for a wait is the one that started it and for a turn
   * that ran long is the turn itself - which carries no kind, because it did
   * not have to happen for the rule to hold.
   */
  event: SessionEvent | SessionTurn;
  /** How many events the rule counted. */
  count: number;
  /** When the rule matched, ISO 8601. */
  at: string;
}

export interface RuleEngineOptions {
  /** The clock. A test supplies its own. */
  now?(): Date;
  /** How a wait is armed. A test supplies its own. */
  setTimer?(fire: () => void, ms: number): { cancel(): void };
  /** What to do about a match. Called once per match, in the order they happen. */
  onMatch?(match: RuleMatch): void;
}

/** Durations as the plan writes them: seconds, minutes, hours. */
const DURATION = /^(\d+)(s|m|h)$/;
const UNIT = { s: 1000, m: 60_000, h: 3_600_000 };

/**
 * How long a duration such as `30s`, `5m` or `2h` is, or nothing when it does
 * not read as one.
 *
 * Exported because the store checks the same strings when it takes a rule, and
 * a config that one of them reads and the other does not is a rule that is
 * accepted and never fires.
 */
export function durationMs(value: string): number | undefined {
  const found = DURATION.exec(value.trim());
  if (found === null) return undefined;
  return Number(found[1]) * UNIT[found[2] as keyof typeof UNIT];
}

/** One rule's state for one session. */
interface Watch {
  /** When the counted events happened, oldest first, in milliseconds. */
  hits: number[];
  /** The tool and input the counted run is of, where the rule wants them matched. */
  signature?: string | undefined;
  /** What the rule is waiting for, how to stop waiting, and what it counted. */
  pending?: { cancel(): void; count: number } | undefined;
  /** How to stop the timer armed for the turn running in this session. */
  turn?: { cancel(): void } | undefined;
}

/** The kinds that end a turn, which are the kinds nothing is measured from after. */
const ENDING = new Set<SessionEventKind>(['turnCompleted', 'turnFailed', 'turnCancelled']);

export function createRuleEngine(options: RuleEngineOptions = {}): RuleEngine {
  const now = options.now ?? ((): Date => new Date());
  const setTimer = options.setTimer ?? ((fire, ms): { cancel(): void } => {
    const held = setTimeout(fire, ms);
    // A rule waiting three minutes should not be the thing that keeps a
    // daemon up.
    held.unref?.();
    return { cancel: () => { clearTimeout(held); } };
  });

  const rules = new Map<string, SessionRule>();
  const watches = new Map<string, Map<string, Watch>>();
  /**
   * The turn running in each session: the turn itself, when it started and
   * when the session last said anything, both in milliseconds.
   *
   * The two stamps answer different questions and only one of them is a rule's:
   * a length is measured from the start, and the quiet a rule about a stuck
   * turn waits out runs from the last thing that was said.
   */
  const turns = new Map<string, { turn: SessionTurn; start: number; last: number }>();

  const held = (automation: string, session: string): Watch => {
    let bySession = watches.get(automation);
    if (bySession === undefined) {
      bySession = new Map();
      watches.set(automation, bySession);
    }
    let watch = bySession.get(session);
    if (watch === undefined) {
      watch = { hits: [] };
      bySession.set(session, watch);
    }
    return watch;
  };

  const stop = (watch: Watch): void => {
    watch.pending?.cancel();
    watch.pending = undefined;
    watch.turn?.cancel();
    watch.turn = undefined;
    watch.hits = [];
    watch.signature = undefined;
  };

  /** Say a rule matched. An event that drove the match is when it happened. */
  const matched = (
    automation: string,
    rule: SessionRule,
    event: SessionEvent | SessionTurn,
    count: number,
    at: string,
  ): void => {
    options.onMatch?.({ automation, session: event.session, on: rule.on, event, count, at });
  };

  /**
   * Whether a rule looks at the session something is about at all.
   *
   * Read against anything the host says about a session rather than an event
   * alone, because a turn starting is one of those things and the filter is the
   * same answer for both.
   */
  const filtered = (rule: SessionRule, about: SessionAbout): boolean => {
    const filter = rule.filter;
    if (filter === undefined) return true;
    if (filter.sessions !== undefined && !filter.sessions.includes(about.session)) return false;
    if (filter.providers !== undefined
      && (about.provider === undefined || !filter.providers.includes(about.provider))) return false;
    if (filter.owners !== undefined
      && (about.owner === undefined || !filter.owners.includes(about.owner))) return false;
    if (filter.projects !== undefined
      && (about.project === undefined || !filter.projects.includes(about.project))) return false;
    // A session works in a set of directories, so a rule names one of them.
    if (filter.folders !== undefined && !filter.folders.some((one) => about.folders.includes(one))) return false;
    if (filter.automated !== undefined && about.automated !== filter.automated) return false;
    return true;
  };

  /**
   * Whether the turn running in a session has run at least what a rule asks, by
   * the time something happened.
   *
   * A session with no turn running is not one whose turn has run long: the turn
   * that ended is over, and nothing is measured from its start. This is the
   * turn's own length, which is not the quiet the timer above waits out: an
   * event arriving in a long turn is asked about the turn, not about how long
   * it has been since one arrived.
   */
  const ranLong = (rule: SessionRule, session: string, at: number): boolean => {
    const want = rule.when?.turnLongerThan;
    const running = turns.get(session);
    if (want === undefined || running === undefined) return false;
    const ms = durationMs(want);
    return ms !== undefined && at - running.start >= ms;
  };

  /**
   * Whether one event is one of the events a rule counts.
   *
   * The filter and the state check are the whole of it: `on` is asked by the
   * caller, which has already read it.
   */
  const counts = (rule: SessionRule, event: SessionEvent, at: number): boolean => {
    if (!filtered(rule, event)) return false;
    const when = rule.when;
    if (when !== undefined) {
      if (when.running !== undefined && event.running !== when.running) return false;
      if (when.queuedAtLeast !== undefined && (event.queued ?? 0) < when.queuedAtLeast) return false;
      if (when.toolCallsAtLeast !== undefined && (event.turnToolCalls ?? 0) < when.toolCallsAtLeast) return false;
      if (when.turnLongerThan !== undefined && !ranLong(rule, event.session, at)) return false;
    }
    return true;
  };

  /**
   * Whether a rule waits for a turn to go quiet rather than for an event.
   *
   * It watches a turn ending, names a length, and asks nothing of a count or a
   * follow-up - so its own timer is the only thing that can fire it, because
   * the turn it is about is one that has not ended. A rule watching anything
   * else is waiting for that event, and one with a count or a follow-up is
   * waiting for what it asked for.
   */
  const onTurn = (rule: SessionRule): boolean =>
    rule.when?.turnLongerThan !== undefined && rule.count === undefined && rule.then === undefined
    && ENDING.has(rule.on);

  /**
   * The session did something, at this moment.
   *
   * What a rule about a turn that has gone quiet waits out starts here rather
   * than at the turn's start, so a turn that calls a tool every minute never
   * goes quiet however long it runs.
   */
  const active = (session: string, at: number): void => {
    const running = turns.get(session);
    if (running !== undefined) running.last = at;
  };

  /**
   * Arm, for one rule and one session, the timer that fires when the session's
   * turn has said nothing for as long as the rule allows.
   *
   * The wait is what is left of the quiet rather than the whole of it: a rule
   * added an hour into a silent turn is due at once, because the turn it is
   * about has already been quiet its length. And a turn that says something
   * while the wait is running is not a turn that is stuck, so the timer that
   * fires first arms itself again rather than matching - which is what keeps a
   * turn saying something every minute from being waited on twice over.
   */
  const armTurn = (automation: string, rule: SessionRule, session: string): void => {
    const was = watches.get(automation)?.get(session);
    was?.turn?.cancel();
    if (was !== undefined) was.turn = undefined;
    const running = turns.get(session);
    const want = rule.when?.turnLongerThan;
    if (!onTurn(rule) || running === undefined || want === undefined) return;
    const ms = durationMs(want);
    if (ms === undefined) return;
    const watch = held(automation, session);
    const since = running.last;
    const armed = setTimer(() => {
      if ((turns.get(session)?.last ?? since) > since) {
        armTurn(automation, rule, session);
        return;
      }
      watch.turn = undefined;
      // The turn has been quiet the rule's length without ending, which is the
      // whole of what the rule asked for: it matches once, now, and the turn is
      // what the run is told about.
      matched(automation, rule, running.turn, 1, now().toISOString());
    }, Math.max(0, ms - (now().getTime() - since)));
    watch.turn = { cancel: () => { armed.cancel(); } };
  };

  /**
   * A turn ended: nothing is measured from it any more.
   *
   * A rule about a turn that ran long has had its say by then, so the event
   * that ends the turn is offered to the rules with no turn behind it - which
   * is what keeps one long turn from waking a second run as it finishes.
   */
  const turnOver = (session: string): void => {
    turns.delete(session);
    for (const bySession of watches.values()) {
      const watch = bySession.get(session);
      if (watch === undefined) continue;
      watch.turn?.cancel();
      watch.turn = undefined;
    }
  };

  /**
   * What one event does to one rule.
   *
   * A wait comes first: an event either completes it, breaks it, or is one the
   * wait does not care about. A broken wait goes back to counting, and the
   * event that broke it is then offered to the count in the ordinary way - so
   * a rule that waited for an event it also counts starts its count again from
   * that event rather than from the one before it.
   */
  const feedOne = (automation: string, rule: SessionRule, event: SessionEvent, at: number): void => {
    const watch = watches.get(automation)?.get(event.session);
    const isCounted = event.kind === rule.on && counts(rule, event, at);

    const pending = watch?.pending;
    const then = rule.then;
    if (pending !== undefined && watch !== undefined && then !== undefined) {
      const wanted = then.kind === 'event' && then.event === event.kind;
      /*
       * `idle` is broken by anything at all, `absent` only by the event it
       * waits to not see, and a wait for a named event is broken by nothing.
       *
       * With one thing that breaks nothing: the host says `idle` the moment a
       * turn ends and nothing waits behind it - which is the very moment the
       * turn's own ending armed a wait for quiet - so a wait for quiet that
       * the quiet itself broke would never hold for anybody.
       */
      const broke = then.kind === 'event' ? false
        : then.kind === 'absent' ? then.event === event.kind
          : event.kind !== 'idle';
      if (wanted) {
        const count = pending.count;
        stop(watch);
        matched(automation, rule, event, count, event.at);
        // The event that completed the wait is not also a fresh count of it.
        return;
      }
      if (broke) stop(watch);
    }

    if (!isCounted) {
      // A run of events is over when the session does anything else.
      if (rule.count?.consecutive === true && watch !== undefined) {
        watch.hits = [];
        watch.signature = undefined;
      }
      if (watch !== undefined && watch.hits.length === 0 && watch.pending === undefined && watch.turn === undefined)
        watches.get(automation)?.delete(event.session);
      return;
    }

    const run = held(automation, event.session);
    const window = rule.count?.within;
    const within = window === undefined ? undefined : durationMs(window);
    // A window nothing can read is one this engine cannot honour, and a rule
    // it cannot honour is one it does not fire.
    if (window !== undefined && within === undefined) return;

    const signature = rule.count?.sameInput === true
      ? `${event.tool?.name ?? ''}\u0000${event.tool?.inputHash ?? ''}`
      : undefined;
    if (signature !== undefined && run.signature !== undefined && run.signature !== signature) run.hits = [];
    if (signature !== undefined) run.signature = signature;
    if (within !== undefined) run.hits = run.hits.filter((hit) => at - hit <= within);
    run.hits.push(at);

    const n = rule.count?.n ?? 1;
    if (run.hits.length < n) return;
    const count = run.hits.length;
    run.hits = [];

    const wait = rule.then;
    if (wait === undefined) {
      matched(automation, rule, event, count, event.at);
      return;
    }

    const ms = durationMs(wait.kind === 'event' ? wait.within : wait.for);
    // The same refusal as the window: a wait with no readable length is one
    // this engine will not pretend to keep.
    if (ms === undefined) return;
    const armed = setTimer(() => {
      run.pending = undefined;
      // The wait held. An event that broke it would have cancelled this, so
      // only a wait for quiet or for an absence matches here - a wait for a
      // named event that ran out of time is one that did not come.
      if (wait.kind !== 'event') matched(automation, rule, event, count, now().toISOString());
    }, ms);
    run.pending = { cancel: () => { armed.cancel(); }, count };
  };

  return {
    add(automation, rule) {
      // Replacing a rule drops what it was waiting for: the rule that armed a
      // wait is not the rule that would complete it.
      const bySession = watches.get(automation);
      if (bySession !== undefined) for (const watch of bySession.values()) stop(watch);
      watches.delete(automation);
      rules.set(automation, rule);
      // A rule written while a turn is already running is timed from that
      // turn's start, because the turn is what it is about.
      for (const running of turns.values()) {
        if (filtered(rule, running.turn)) armTurn(automation, rule, running.turn.session);
      }
    },

    remove(automation) {
      const bySession = watches.get(automation);
      if (bySession !== undefined) for (const watch of bySession.values()) stop(watch);
      watches.delete(automation);
      rules.delete(automation);
    },

    feed(event) {
      const stamp = Date.parse(event.at);
      const at = Number.isNaN(stamp) ? now().getTime() : stamp;
      if (ENDING.has(event.kind)) turnOver(event.session);
      // Anything else the session does is the session moving, which is what a
      // rule about a turn that has gone quiet is waiting for it not to do.
      else active(event.session, at);
      for (const [automation, rule] of rules) feedOne(automation, rule, event, at);
    },

    started(turn) {
      const stamp = Date.parse(turn.at);
      const start = Number.isNaN(stamp) ? now().getTime() : stamp;
      turns.set(turn.session, { turn, start, last: start });
      // Every rule that would fire on this session's turn going quiet is armed
      // from this start, whether it was watching already or the turn outlasted
      // it.
      for (const [automation, rule] of rules) {
        if (!onTurn(rule) || !filtered(rule, turn)) continue;
        armTurn(automation, rule, turn.session);
      }
    },

    moved(session) {
      active(session, now().getTime());
    },

    end(session) {
      turnOver(session);
      for (const bySession of watches.values()) {
        const watch = bySession.get(session);
        if (watch === undefined) continue;
        stop(watch);
        bySession.delete(session);
      }
    },

    close() {
      for (const bySession of watches.values()) for (const watch of bySession.values()) stop(watch);
      watches.clear();
      turns.clear();
      rules.clear();
    },
  };
}

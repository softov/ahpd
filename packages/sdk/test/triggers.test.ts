import { expect, it } from 'vitest';
import { createRuleEngine, durationMs, type RuleMatch } from '../src/triggers.js';
import type { SessionEvent, SessionEventKind, SessionRule, SessionTurn } from '../src/types/triggers.js';

/*
 * The rule engine, with a clock the test owns.
 *
 * Every wait in a rule is a real wait, so the clock and the timers are handed
 * in and the tests move time rather than sleeping. What is checked is the
 * matching: which event counts, when a count is forgotten, and what a match is
 * told about the event that made it.
 */

const START = Date.parse('2026-10-07T09:00:00.000Z');
const ONE = 'echo:/one';
const TWO = 'echo:/two';

/** An event that happened this many seconds after the clock's start. */
const at = (seconds: number): string => new Date(START + seconds * 1000).toISOString();

const event = (kind: SessionEventKind, over: Partial<SessionEvent> = {}): SessionEvent =>
  ({ kind, session: ONE, at: at(0), folders: [], automated: false, ...over });

/** A turn that started, as the host tells the engine about one. */
const turn = (seconds = 0, over: Partial<SessionTurn> = {}): SessionTurn =>
  ({ session: ONE, at: at(seconds), folders: [], automated: false, ...over });

const tool = (name: string, inputHash: string): { name: string; inputHash: string } => ({ name, inputHash });

/** The event a match came from, where it came from one: a turn that ran long is not an event. */
const eventOf = (match: RuleMatch | undefined): SessionEvent | undefined =>
  match !== undefined && 'kind' in match.event ? match.event : undefined;

/** A clock the test moves, and the timers armed against it. */
function fakeClock() {
  let held = START;
  const armed: { at: number; fire: () => void; cancelled: boolean }[] = [];
  return {
    now: (): Date => new Date(held),
    setTimer: (fire: () => void, ms: number): { cancel(): void } => {
      const one = { at: held + ms, fire, cancelled: false };
      armed.push(one);
      return { cancel: () => { one.cancelled = true; } };
    },
    /** Move time on, firing whatever came due on the way. */
    advance(ms: number): void {
      held += ms;
      for (const one of [...armed]) {
        if (one.cancelled || one.at > held) continue;
        one.cancelled = true;
        one.fire();
      }
    },
    /** How many timers are still waiting. */
    waiting: (): number => armed.filter((one) => !one.cancelled).length,
  };
}

function area() {
  const clock = fakeClock();
  const matches: RuleMatch[] = [];
  const made = createRuleEngine({ ...clock, onMatch: (match) => matches.push(match) });
  return { made, matches, ...clock };
}

it('matches one event with no count', () => {
  const { made, matches } = area();
  made.add('nine-am', { on: 'turnFailed' });
  made.feed(event('turnCompleted'));
  expect(matches).toEqual([]);
  made.feed(event('turnFailed', { owner: 'user:softov', provider: 'claude' }));
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({
    automation: 'nine-am', session: ONE, on: 'turnFailed', count: 1, at: at(0),
  });
  // The count is cleared by the match, so the next one is a single event again
  // rather than the second of a pair.
  made.feed(event('turnFailed'));
  expect(matches.map((one) => one.count)).toEqual([1, 1]);
});

it('matches only the sessions a rule filters to', () => {
  const { made, matches } = area();
  made.add('mine', {
    on: 'turnFailed',
    filter: { sessions: [ONE], owners: ['user:softov'], projects: ['brb'] },
  });
  made.feed(event('turnFailed', { session: TWO, owner: 'user:softov', project: 'brb' }));
  made.feed(event('turnFailed', { owner: 'user:other', project: 'brb' }));
  made.feed(event('turnFailed', { owner: 'user:softov', project: 'other' }));
  expect(matches).toEqual([]);
  made.feed(event('turnFailed', { owner: 'user:softov', project: 'brb' }));
  expect(matches).toHaveLength(1);
});

it('matches three tool failures in a row, and not three with a success between', () => {
  const { made, matches } = area();
  made.add('triage', { on: 'toolFailed', count: { n: 3, consecutive: true } });
  made.feed(event('toolFailed'));
  made.feed(event('toolFailed'));
  expect(matches).toEqual([]);
  made.feed(event('toolFailed'));
  expect(matches.map((one) => one.count)).toEqual([3]);

  // A turn doing anything else is the run of failures being over, so the
  // count starts again rather than carrying on.
  made.feed(event('toolFailed'));
  made.feed(event('toolCalled'));
  made.feed(event('toolFailed'));
  made.feed(event('toolFailed'));
  made.feed(event('turnCompleted'));
  made.feed(event('toolFailed'));
  made.feed(event('toolFailed'));
  expect(matches).toHaveLength(1);
  made.feed(event('toolFailed'));
  expect(matches).toHaveLength(2);
});

it('matches three calls of the same tool with the same input', () => {
  const { made, matches } = area();
  made.add('stuck', { on: 'toolCalled', count: { n: 3, sameInput: true } });
  const call = (name: string, hash: string, second = 0): SessionEvent =>
    event('toolCalled', { tool: tool(name, hash), at: at(second) });
  made.feed(call('Read', 'a'));
  made.feed(call('Read', 'a'));
  expect(matches).toEqual([]);
  made.feed(call('Read', 'a'));
  expect(matches.map((one) => one.count)).toEqual([3]);

  // The same input is the same call only where it is the same tool, and a
  // different call in between is the run starting over.
  made.feed(call('Read', 'a'));
  made.feed(call('Bash', 'b'));
  made.feed(call('Bash', 'b'));
  expect(matches).toHaveLength(1);
  made.feed(call('Bash', 'b'));
  expect(matches).toHaveLength(2);
});

it('forgets counts older than the window', () => {
  const { made, matches } = area();
  made.add('flaky', { on: 'toolFailed', count: { n: 3, within: '1m' } });
  made.feed(event('toolFailed', { at: at(0) }));
  made.feed(event('toolFailed', { at: at(30) }));
  // A minute after the first, that one is outside the window and the count is
  // what happened inside it.
  made.feed(event('toolFailed', { at: at(120) }));
  expect(matches).toEqual([]);
  made.feed(event('toolFailed', { at: at(130) }));
  made.feed(event('toolFailed', { at: at(140) }));
  expect(matches.map((one) => one.count)).toEqual([3]);
});

it('matches a failed turn followed by three minutes of quiet', () => {
  const { made, matches, advance, waiting } = area();
  made.add('idle-after-failure', { on: 'turnFailed', then: { kind: 'idle', for: '3m' } });
  made.feed(event('turnFailed'));
  expect(matches).toEqual([]);
  expect(waiting()).toBe(1);
  advance(180_000);
  expect(matches).toHaveLength(1);
  // The last event is the one that started the wait, and the match is stamped
  // when the wait held rather than when the event happened.
  expect(matches[0]).toMatchObject({ on: 'turnFailed', count: 1, at: at(180) });
  expect(eventOf(matches[0])?.kind).toBe('turnFailed');
});

it('holds a wait for quiet through the idle the host says right after the failure', () => {
  const { made, matches, advance } = area();
  made.add('idle-after-failure', { on: 'turnFailed', then: { kind: 'idle', for: '3m' } });
  /*
   * Both in the same breath, the way the host says them: the turn failed and,
   * with nothing queued behind it, the session is idle from that moment. The
   * host says `idle` because the turn ended - which is the very event the wait
   * was armed by - so a wait for quiet that the quiet itself broke would never
   * hold for anybody.
   */
  made.feed(event('turnFailed'));
  made.feed(event('idle', { at: at(0) }));
  expect(matches).toEqual([]);
  advance(180_000);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ on: 'turnFailed', count: 1, at: at(180) });
  expect(eventOf(matches[0])?.kind).toBe('turnFailed');
});

it('measures the quiet of a turn from the last thing it did', () => {
  const { made, matches, advance } = area();
  made.add('silent', { on: 'turnCompleted', when: { turnLongerThan: '10m' } });
  made.started(turn(0));
  advance(540_000);
  // Nine minutes of a turn that is doing something is not nine minutes of a
  // turn that has gone quiet: the tool call starts the wait again.
  made.feed(event('toolCalled', { at: at(540), tool: tool('Read', 'a'), running: true }));
  advance(60_000);
  expect(matches).toEqual([]);
  advance(540_000);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.at).toBe(at(1140));

  // The turn itself is still measured from its start, which is what the run is
  // told about: a turn that has been running twenty minutes ran twenty minutes.
  expect(matches[0]?.event.at).toBe(at(0));
});

it('measures the quiet from what a turn says as well as from what it does', () => {
  const { made, matches, advance } = area();
  made.add('silent', { on: 'turnCompleted', when: { turnLongerThan: '10m' } });
  made.started(turn(0));
  advance(540_000);
  // A turn streaming an answer says nothing an event carries - there is no
  // event for a word - and it is not a turn that is stuck either.
  made.moved(ONE);
  advance(60_000);
  expect(matches).toEqual([]);
  advance(540_000);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.at).toBe(at(1140));
});

it('drops every wait when the engine closes', () => {
  const { made, matches, advance, waiting } = area();
  made.add('idle-after-failure', { on: 'turnFailed', then: { kind: 'idle', for: '3m' } });
  made.feed(event('turnFailed'));
  made.add('silent', { on: 'turnCompleted', when: { turnLongerThan: '10m' } });
  made.started(turn(0));
  expect(waiting()).toBe(2);
  made.close();
  // A daemon that is going away has nothing left to act on, so the timers are
  // cancelled rather than left to fire into it.
  expect(waiting()).toBe(0);
  advance(600_000);
  expect(matches).toEqual([]);
});

it('does not match when a turn starts inside the quiet period', () => {
  const { made, matches, advance } = area();
  made.add('idle-after-failure', { on: 'turnFailed', then: { kind: 'idle', for: '3m' } });
  made.feed(event('turnFailed'));
  advance(60_000);
  // The first sign of the session doing something again, which is the quiet
  // being over.
  made.feed(event('toolCalled', { tool: tool('Read', 'a'), at: at(60) }));
  advance(180_000);
  expect(matches).toEqual([]);

  // And the rule is still a rule: the next failed turn starts a new wait.
  made.feed(event('turnFailed', { at: at(240) }));
  advance(180_000);
  expect(matches).toHaveLength(1);
});

it('matches a finished turn when no turnCompleted follows within two minutes', () => {
  const { made, matches, advance } = area();
  made.add('turn-and-done', { on: 'turnCompleted', then: { kind: 'absent', event: 'turnCompleted', for: '2m' } });
  made.feed(event('turnCompleted'));
  // Other events are not the one this waits to not see, so they are not what
  // breaks it.
  made.feed(event('toolCalled', { tool: tool('Read', 'a'), at: at(30) }));
  made.feed(event('idle', { at: at(31) }));
  advance(120_000);
  expect(matches).toHaveLength(1);

  // A second finished turn inside the wait is what the rule was watching for,
  // and it starts the wait again.
  made.feed(event('turnCompleted', { at: at(200) }));
  made.feed(event('turnCompleted', { at: at(260) }));
  advance(120_000);
  expect(matches).toHaveLength(2);
});

it('matches a queued message while running with three tool calls in the turn', () => {
  const { made, matches } = area();
  made.add('waiting-while-busy', {
    on: 'messageQueued',
    when: { running: true, toolCallsAtLeast: 3 },
  });
  made.feed(event('messageQueued', { running: true, queued: 1, turnToolCalls: 2 }));
  made.feed(event('messageQueued', { running: false, queued: 1, turnToolCalls: 5 }));
  expect(matches).toEqual([]);
  made.feed(event('messageQueued', { running: true, queued: 1, turnToolCalls: 3 }));
  expect(matches).toHaveLength(1);
  expect(eventOf(matches[0])?.turnToolCalls).toBe(3);
});

it('matches a session by its folders and by whether a run made it', () => {
  const { made, matches } = area();
  made.add('ours', { on: 'turnFailed', filter: { folders: ['file:///work/api'], automated: false } });
  made.feed(event('turnFailed', { folders: ['file:///work/web'], automated: false }));
  made.feed(event('turnFailed', { folders: ['file:///work/api'], automated: true }));
  expect(matches).toEqual([]);
  made.feed(event('turnFailed', { folders: ['file:///work/api'], automated: false }));
  expect(matches).toHaveLength(1);
});

it('matches a turn that has run longer than the rule allows', () => {
  const { made, matches, advance } = area();
  made.add('silent', { on: 'turnCompleted', when: { turnLongerThan: '10m' } });
  made.started(turn(0));
  advance(540_000);
  // Nothing emits an event during a silent turn, so the engine's own timer is
  // what fires it - and the match is stamped when the turn ran long.
  expect(matches).toEqual([]);
  advance(60_000);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ automation: 'silent', session: ONE, on: 'turnCompleted', count: 1, at: at(600) });
  // The event is the turn itself: it started at the tenth minute before this.
  expect(matches[0]?.event.at).toBe(at(0));
});

it('measures a turn from its start, whether the rule was there then or not', () => {
  const { made, matches, advance } = area();
  made.started(turn(0));
  advance(540_000);
  // Nine minutes in, and the rule has nine minutes of turn behind it rather
  // than ten minutes of its own.
  made.add('silent', { on: 'turnCompleted', when: { turnLongerThan: '10m' } });
  advance(60_000);
  expect(matches).toHaveLength(1);
});

it('reads the running turn when an event arrives', () => {
  const { made, matches, advance } = area();
  made.add('slow-failure', { on: 'toolFailed', when: { turnLongerThan: '5m' } });
  made.started(turn(0));
  made.feed(event('toolFailed', { at: at(60), running: true }));
  expect(matches).toEqual([]);
  made.feed(event('toolFailed', { at: at(360), running: true }));
  expect(matches).toHaveLength(1);

  // A failure in a turn nothing is running is not one either: the turn that
  // ended is over, and nothing is measured from its start.
  advance(600_000);
  made.feed(event('turnCompleted', { at: at(1000), running: false }));
  made.feed(event('toolFailed', { at: at(1020), running: false }));
  expect(matches).toHaveLength(1);
});

it('leaves a rule that counts or waits to its own events', () => {
  const { made, matches, advance } = area();
  made.add('three', { on: 'toolFailed', count: { n: 3 }, when: { turnLongerThan: '5m' } });
  made.add('quiet', { on: 'turnFailed', when: { turnLongerThan: '5m' }, then: { kind: 'idle', for: '1m' } });
  made.started(turn(0));
  advance(600_000);
  // A count is a number of events and a wait follows one, so the turn's own
  // length is neither: a rule with one of those waits for what it asked for.
  expect(matches).toEqual([]);
});

it('stops measuring a turn that ends, and one nothing watches any more', () => {
  const { made, matches, advance } = area();
  made.add('silent', { on: 'turnCompleted', when: { turnLongerThan: '10m' } });
  made.started(turn(0));
  made.feed(event('turnCompleted', { at: at(60), running: false }));
  advance(600_000);
  expect(matches).toEqual([]);

  // A rule taken away measures nothing, and neither does a session that ended.
  made.started(turn(600));
  made.remove('silent');
  advance(600_000);
  expect(matches).toEqual([]);
  made.add('silent', { on: 'turnCompleted', when: { turnLongerThan: '10m' } });
  made.started(turn(1200));
  made.end(ONE);
  advance(600_000);
  expect(matches).toEqual([]);
});

it('keeps counts apart per session and per automation', () => {
  const { made, matches } = area();
  const rule: SessionRule = { on: 'toolFailed', count: { n: 2, consecutive: true } };
  made.add('first', rule);
  made.add('second', rule);
  made.feed(event('toolFailed', { session: ONE }));
  made.feed(event('toolFailed', { session: TWO }));
  expect(matches).toEqual([]);
  made.feed(event('toolFailed', { session: ONE }));
  expect(matches.map((one) => [one.automation, one.session])).toEqual([['first', ONE], ['second', ONE]]);
  // The second session's own count was untouched by any of that.
  made.feed(event('toolFailed', { session: TWO }));
  expect(matches.map((one) => one.session)).toEqual([ONE, ONE, TWO, TWO]);
});

it('cancels a waiting follow-up when the rule is removed', () => {
  const { made, matches, advance } = area();
  made.add('idle-after-failure', { on: 'turnFailed', then: { kind: 'idle', for: '3m' } });
  made.feed(event('turnFailed'));
  made.remove('idle-after-failure');
  advance(180_000);
  expect(matches).toEqual([]);
});

it('cancels a waiting follow-up when the session ends', () => {
  const { made, matches, advance } = area();
  made.add('idle-after-failure', { on: 'turnFailed', then: { kind: 'idle', for: '3m' } });
  made.feed(event('turnFailed'));
  made.feed(event('turnFailed', { session: TWO, at: at(1) }));
  made.end(ONE);
  advance(180_000);
  // The session that ended says nothing; the one still running still does.
  expect(matches.map((one) => one.session)).toEqual([TWO]);
});

it('waits for the named event and matches when it arrives', () => {
  const { made, matches, advance } = area();
  made.add('failed-then-loaded', { on: 'turnFailed', then: { kind: 'event', event: 'idle', within: '5m' } });
  made.feed(event('turnFailed'));
  made.feed(event('idle', { at: at(60) }));
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ count: 1, at: at(60) });

  // And the wait that never comes is dropped rather than matched.
  made.feed(event('turnFailed', { at: at(120) }));
  advance(300_000);
  expect(matches).toHaveLength(1);
});

it('reads a duration in seconds, minutes and hours', () => {
  expect([durationMs('30s'), durationMs('5m'), durationMs('2h')]).toEqual([30_000, 300_000, 7_200_000]);
  expect([durationMs('5'), durationMs('250ms'), durationMs('five minutes'), durationMs('-1m'), durationMs('')])
    .toEqual([undefined, undefined, undefined, undefined, undefined]);
});

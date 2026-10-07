---
title: The rule engine matches a rule
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts) - a clock that is injected, the pattern to mirror"
---

## Objective

`packages/sdk/src/triggers.ts` takes `SessionEvent`s and a clock, and says when a `SessionRule` matches, for each automation and session.

## Files

- `CREATE: packages/sdk/src/triggers.ts` - `createRuleEngine({ now, setTimer })`, `add(id, rule)`, `remove(id)`, `feed(event)`, and an `onMatch` callback.
- `CREATE: packages/sdk/test/triggers.test.ts` - the cases below, with fake time.

## Steps

1. Match `on` and `filter` first, and drop every other event. The filter reads the session's folders and whether a run made it like any other fact on the event.
2. Check `when` against the event's state fields, and `turnLongerThan` against the start of the turn the host said was running.
3. Count matches per rule and session.
4. With `consecutive`, reset the count on any other event of the session.
5. With `sameInput`, count only equal `tool.inputHash` values.
6. Drop counts older than `within`.
7. At the count, start `then`: wait for the event, for quiet, or for the absence.
8. Cancel a waiting `then` when the session ends or the engine removes the rule.
9. Call `onMatch` with the automation, the session, the last event and the count.
10. Clear the count after a match.
11. Hold the turn the host says is running. Arm a timer where a rule watches a turn ending, names a length, and asks for no count or follow-up. Drop the turn when it ends, so a rule arriving at the end of a long turn measures nothing.

## Validation

- `it('matches one event with no count')`
- `it('matches only the sessions a rule filters to')`
- `it('matches three tool failures in a row, and not three with a success between')`
- `it('matches three calls of the same tool with the same input')`
- `it('forgets counts older than the window')`
- `it('matches a failed turn followed by three minutes of quiet')`
- `it('holds a wait for quiet through the idle the host says right after the failure')`
- `it('measures the quiet of a turn from the last thing it did')`
- `it('measures the quiet from what a turn says as well as from what it does')`
- `it('drops every wait when the engine closes')`
- `it('does not match when a turn starts inside the quiet period')`
- `it('matches a finished turn when no turnCompleted follows within two minutes')`
- `it('matches a queued message while running with three tool calls in the turn')`
- `it('keeps counts apart per session and per automation')`
- `it('cancels a waiting follow-up when the rule is removed')`
- `it('cancels a waiting follow-up when the session ends')`
- `it('waits for the named event and matches when it arrives')`
- `it('matches a session by its folders and by whether a run made it')`
- `it('matches a turn that has run longer than the rule allows')`
- `it('measures a turn from its start, whether the rule was there then or not')`
- `it('reads the running turn when an event arrives')`
- `it('leaves a rule that counts or waits to its own events')`
- `it('stops measuring a turn that ends, and one nothing watches any more')`
- `it('reads a duration in seconds, minutes and hours')`
- Run the full gates from the plan. All pass.

## Resume

Built `triggers.ts`: one rule per automation, and one state per automation and session. The clock and the timers come in, and `onMatch` says what a match does next. `triggers.test.ts` has twenty-four cases and passes.

Two things came out of the fork the plan records. The engine takes an `end(session)`, so a wait for a session that is gone is dropped. A rule whose window or wait is a duration it cannot read never fires, rather than firing on the wrong interval. `durationMs` is exported for the store to check the same strings on its own side.

Softov settled the silent turn on 2026-10-07: an internal timer and no new event kind. `started(turn)` is the host's turn start, held per session. `when.turnLongerThan` is read off any event that arrives while it runs. A rule added an hour into a turn is armed for what is left of the length rather than the whole of it. A rule fires from that timer only when it watches a turn ending and asks for nothing else. A rule watching `toolFailed` in a long turn waits for the failure. One with a count or a follow-up waits for what it asked for. The turn is dropped when it ends, before the rules see the event that ended it. That is what keeps one long turn from waking a second run as it finishes.

Softov settled the quiet of a turn on 2026-10-07 as well. The timer above measures that and not the turn's length. `turns` holds both stamps: `start`, for a rule that asks how long a turn has run, and `last`, for one that waits out its quiet. `moved(session)` is a session reporting activity, such as a delta or a tool call starting. `active` writes `last` for it, as it does for any event that is not one ending a turn. A timer that comes due on a session which has said something since then arms itself again for what is left, rather than matching. That is what keeps a rule watching a turn ending from firing before the rule's length of nothing at all.

The `idle` the host says right after a turn end is not counted against a wait for quiet. Only an event that is not `idle` breaks `then: { kind: 'idle' }`. A rule armed by a failed turn is still waiting when the host says the session is idle a moment later. It matches once the quiet has really lasted. A wait on a named event, or on its absence, is still broken by what it names.

`close()` drops every count and every wait a rule holds and cancels its timers. It is the engine's own end, beside `end(session)` for one session going.

---
title: The rule engine matches a rule
status: todo
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

1. Match `on` and `filter` first, and drop every other event.
2. Check `when` against the event's state fields.
3. Count matches per rule and session.
4. With `consecutive`, reset the count on any other event of the session.
5. With `sameInput`, count only equal `tool.inputHash` values.
6. Drop counts older than `within`.
7. At the count, start `then`: wait for the event, for quiet, or for the absence.
8. Cancel a waiting `then` when the session ends or the engine removes the rule.
9. Call `onMatch` with the automation, the session, the last event and the count.
10. Clear the count after a match.

## Validation

- `it('matches one event with no count')`
- `it('matches three tool failures in a row, and not three with a success between')`
- `it('matches three calls of the same tool with the same input')`
- `it('forgets counts older than the window')`
- `it('matches a failed turn followed by three minutes of quiet')`
- `it('does not match when a turn starts inside the quiet period')`
- `it('matches a finished turn when no turnCompleted follows within two minutes')`
- `it('matches a queued message while running with three tool calls in the turn')`
- `it('keeps counts apart per session and per automation')`
- `it('cancels a waiting follow-up when the rule is removed')`
- Run the full gates from the plan. All pass.

## Resume


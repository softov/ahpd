---
title: A stop waits for the start it names - implemented
date: 2026-11-03
refs:
  - git://2ec7d16d - the change
  - git://bbe4ea34 - task 02's change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
---

A stop that names a turn whose start a backend owes waits for that start's answer, and is applied again once it comes.
After the start is said, the stop stops that turn and its backend is told, as for any stop of the held running turn.
After the start is refused, the stop is said as sent and stops nothing.
The stop's connection sends nothing more until the stop is answered, and the wait is bounded by `WAIT_LIMIT`.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a set of waiters on each dispatch's answer, and `startOwed`.
- [`code://packages/sdk/src/host/context.ts`](../../../../packages/sdk/src/host/context.ts) - the `startOwed` declaration.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the stop's case waits on an owed start and is applied again.
- [`code://packages/sdk/test/echo-origin.test.ts`](../../../../packages/sdk/test/echo-origin.test.ts) - a stop on a second connection while the start is owed, then said, and then refused.

## Verified

- On `c97d8459`'s sources both new cases fail, and they pass with the change.
- On those sources the turn starts twice in every client's state, and its backend is never told to stop.
- These sdk test files pass, one file at a time: origins, turns, the wake, steering, command turns and worker chats.
- So do the sdk's files for input, the nested proxy, conformance and session events.
- The turn test files of ACP and cofold that stop a turn through a host pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Task 02

A dispatch on a chat that comes while a stop there waits for the start it names is applied after that stop, from any connection.
So a turn another window sends meanwhile takes the chat only once the stop has ended the turn it named.
That turn is cancelled in the history.

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/host/context.ts`](../../../../packages/sdk/src/host/context.ts) - `ahead`, the waiting stop by its chat.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the waiting stop held in `ahead`, and a dispatch on its chat applied after it.
- [`code://packages/sdk/test/echo-origin.test.ts`](../../../../packages/sdk/test/echo-origin.test.ts) - a turn a third connection sends while the stop waits.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `chat/turnCancelled` row, which says task 01's wait as well.

Verified:

- On `fa9afa9a`'s sources the new case fails: the second turn is said before the stop, which is said as sent and stops nothing.
- With the change the new case passes, and the origins test file passes alone at one worker.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

- The `chat/turnCancelled` row of AHP.md says task 01's wait, which task 01 left unsaid.

---
title: A stop waits for the start it names - implemented
date: 2026-11-03
refs:
  - git://2ec7d16d - the change
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

## Departures from the plan

None.

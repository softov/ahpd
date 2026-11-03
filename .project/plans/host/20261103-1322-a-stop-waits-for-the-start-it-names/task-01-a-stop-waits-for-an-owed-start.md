---
title: A stop waits for an owed start
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the stop's case"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `startOwed`, and what waits on a dispatch's answer"
---

## Objective

A stop that names a turn whose start a backend owes waits for that start's answer, and is then applied again.
A stop applied after the start is said stops that turn, and its backend is told.
A stop applied after the start is refused is said as sent.

## Files

- `UPDATE: packages/sdk/src/host.ts` - more than one waiter on a dispatch's answer, and `startOwed`.
- `UPDATE: packages/sdk/src/host/context.ts` - the `startOwed` declaration.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the stop's case waits on `startOwed` and is applied again.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - a stop on a second connection while the start is owed, said and refused.

## Steps

1. Hold a set of waiters for each dispatch's answer, and call each when the host answers the dispatch.
2. Add `startOwed`, which settles once the host says or refuses an owed start.
3. Make the stop's case wait on an owed start of the turn it names, within the bound of a dispatch.
4. Apply the stop again once the start has its answer.
5. Refuse the stop with the wait's sentence when the bound passes.
6. Add a case for a start the backend says and a case for a start it refuses.

## Validation

- The new cases fail on `c97d8459`'s sources and pass after.
- The touched files' test files pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.

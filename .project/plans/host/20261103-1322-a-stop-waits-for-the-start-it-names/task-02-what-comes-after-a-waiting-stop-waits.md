---
title: What comes after a waiting stop waits for it
status: done
depends: [01]
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the stop's case, and the waits a chat's dispatch goes behind"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the stop each chat's later dispatches wait behind"
---

## Objective

A dispatch on a chat that comes while a stop there waits for the start it names is applied after that stop, from any connection.
So the stop ends its own turn before a later turn takes that turn's place.
The stopped turn is cancelled in the history.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `ahead`, the stop each chat's later dispatches wait behind.
- `UPDATE: packages/sdk/src/host/context.ts` - the `ahead` declaration.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a waiting stop held in `ahead`, and a dispatch on its chat applied after it.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - a turn sent on a third connection while the stop waits.
- `UPDATE: docs/sdk/AHP.md` - the `chat/turnCancelled` row: a stop that waits for its turn's start, and what comes after it.

## Steps

1. Put a waiting stop in `ahead` under its chat, and take it out when the stop applies or fails.
2. Hold each dispatch on a chat with a stop in `ahead` until that stop finishes.
3. Bound that wait by `WAIT_LIMIT`, like every other wait of a dispatch.
4. Apply the dispatch again once the stop finishes.
5. Add a case where a third connection sends a turn while the stop waits.

## Validation

- The new case fails on `fa9afa9a`'s sources and passes after.
- `echo-origin.test.ts` passes alone at one worker.
- `pnpm run typecheck` and `pnpm run boundary` are clean.

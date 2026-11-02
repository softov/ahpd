---
title: The answers a turn owes are given at its end
status: planned
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `dispatch`'s turn end and `owed`"
---

## Objective

When a turn ends, each answer still owed to it is given with its client's origin.
An owed start goes out before the end; an owed stop or client result goes out after it.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the turn end in `dispatch` says the owed answers.
- `UPDATE: packages/sdk/test/host-turn.test.ts` - a stop the backend never says, because the turn completes first, is answered after the end.

## Steps

1. In `dispatch`, take the owed answers of the ending turn's chat and turn out of `owed`.
2. Say an owed `chat/turnStarted` before the end, through `dispatch` with its origin.
3. Say an owed stop or result after the end, the same way.

## Validation

- `pnpm exec vitest run packages/sdk/test/host-turn.test.ts` - passes; the new case fails on e4694965.

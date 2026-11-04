---
title: The host does not fold a notice
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/localturns.ts#L387-L411](../../../../packages/sdk/src/host/localturns.ts#L387-L411) - `asBegun`"
---

## Objective

`asBegun` keeps a turn whose message origin is `systemNotification` as a turn of its own.
The chat shows it after a restart as it showed it live.

## Files

- `UPDATE: packages/sdk/src/host/localturns.ts:387-411` - a turn of origin `systemNotification` is never joined into the turn before it.
- `UPDATE: packages/sdk/test/host-local-turns.test.ts` - a case for a notice turn after a recorded turn.

## Steps

1. In `asBegun`, keep a turn of message origin `systemNotification` out of the join, as the code keeps a local turn.
2. Update the comment on `asBegun` to name the notice turn.
3. Add a case: a recorded turn, then a notice turn the chat did not begin.
4. Assert two turns, with the notice turn last and not a steer part of the first.

## Validation

- `packages/sdk/test/host-local-turns.test.ts` holds the case, and every case passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk tests pass.

## Resume


---
title: Answers go out in the order sent
status: todo
depends: [task-01-an-action-is-answered-on-its-own-channel.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `applyNow` and `waiting`"
---

## Objective

A connection's next action waits until the action a backend answers later is answered.
The wait ends after `WAIT_LIMIT` with nothing refused.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `applyNow` returns a wait for an owed or taken dispatch; `told` ends it.
- `UPDATE: packages/sdk/src/host/state.ts` - `Dispatched.owed`.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - a draft sent after a turn start is answered after it.

## Steps

1. Mark a dispatch owed when `owe` holds it.
2. After the apply, return a promise that `told` settles for an owed or taken dispatch.
3. Settle it after `WAIT_LIMIT` without a refusal.

## Validation

- `pnpm exec vitest run packages/sdk/test/echo-origin.test.ts` - passes; the new case fails on c3c8c3e4.

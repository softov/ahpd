---
title: A worker chat that will not open is logged, not thrown
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L511-L548](../../../../packages/sdk/src/nested.ts#L511-L548) - `openWorker`: `subagent(...)` at 529, after an `await`, outside the `try`"
  - "[code://packages/sdk/src/nested.ts#L567](../../../../packages/sdk/src/nested.ts#L567) - `void openWorker(...)`"
---

## Objective

Whatever opening an inner worker chat throws is logged with the chat's name and leaves the session running.

## Files

- `UPDATE: packages/sdk/src/nested.ts:511-548` - the body after the subscribe is inside the `try`, or `opensWorker` catches the promise; today a throw from `start.subagent(...)` or an `emit` rejects a promise started with `void`, and with no `unhandledRejection` handler anywhere that ends the daemon.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - the case below.

## Steps

1. Failing case first: a `start.subagent` that throws, and an inner worker chat announced. Today the test sees an unhandled rejection; after, a log line naming the chat and no rejection.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts`.

## Resume

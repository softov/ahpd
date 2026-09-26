---
title: Close waits for the inner session to be disposed
status: todo
depends: [task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L511-L524](../../../../packages/sdk/src/nested.ts#L511-L524) - `close`, which sends `disposeSession` and signals the process in the same tick"
---

## Objective

Closing a nested session disposes the inner session before the inner host is stopped, and a host that does not answer is still stopped within a bound.

## Files

- `UPDATE: packages/sdk/src/nested.ts:511-524` - `close`.

## Steps

1. Await `disposeSession` with a short bound (a few seconds, not `ANSWER_TIMEOUT`), then `shutdown`, then `SIGTERM`, and `SIGKILL` if the process has not closed a bound later.
2. Keep `close()` synchronous to its caller; the sequence runs behind it.

## Validation

- `test/nested-proxy.test.ts`: the inner `createHost`'s backend `close` is called before the fake's `kill`; today `kill` comes first in the same tick.
- `test/nested-process.test.ts`: a real inner host that ignores SIGTERM (a fixture option) is gone within the bound.
- `node_modules/.bin/vitest run test/nested-proxy.test.ts test/nested-process.test.ts` passes.

## Resume

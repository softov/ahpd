---
title: The host asks a backend to stop one worker
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L8835-L8847](../../../../packages/sdk/src/host.ts#L8835-L8847) - the worker-chat branch of `chat/turnCancelled`"
  - "[code://packages/sdk/src/types/session.ts#L359](../../../../packages/sdk/src/types/session.ts#L359) - `cancel`, beside which the new method goes"
  - "[code://packages/sdk/test/subagent-chat.test.ts](../../../../packages/sdk/test/subagent-chat.test.ts) - the claude/04 task 17 cases, including the stop that cancels lead turn `t1`"
---

## Objective

A `chat/turnCancelled` on a worker chat calls the backend's `stopWorker(toolCallId)` when it has one, and cancels the lead turn as today when it has not.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:359` - optional `stopWorker?(toolCallId: string): void`, its comment saying what it stops.
- `UPDATE: packages/sdk/src/host.ts:8835-8847` - route to `stopWorker` with the call id read from the worker URI.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts` - the cases below.

## Steps

1. The refusal "Nothing is running on <lead> to stop" stays for the fallback path only.

## Validation

- A fake with `stopWorker` receives the worker's call id and its lead turn is not cancelled; it fails first.
- The existing case, on a fake without `stopWorker`, still cancels lead turn `t1`.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

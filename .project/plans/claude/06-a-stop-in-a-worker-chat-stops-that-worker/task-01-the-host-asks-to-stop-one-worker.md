---
title: The host asks a backend to stop one worker
status: done
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

Built.
`Session` has an optional `stopWorker?(toolCallId)`, its comment saying it stops one worker by the call that spawned it and leaves the turn running, and that without it a worker chat's stop cancels the lead turn.
In the host's `chat/turnCancelled` branch for a worker chat, the call id is read from the chat URI with `toolCallOfSubagentChat` and handed to `stopWorker` when the backend has it; otherwise the lead turn is cancelled as before, and the refusal `Nothing is running on <lead> to stop` stays on that path only.
A nested worker's chat names its own call, so only that worker is asked to stop.

Tests, in `packages/sdk/test/subagent-chat.test.ts`:

- `asks a backend that can stop one worker to stop that worker, and leaves the lead turn running`: the fake, given `stopWorker`, receives `toolu_agent`; nothing is refused, `cancel` is not called and no `chat/turnCancelled` reaches the lead chat.
- `cancels the lead turn when a worker chat is stopped`: unchanged, on the fake without `stopWorker`, still cancels lead turn `t1`.

Failed first: the new case, with `[ { what: 'cancel', id: 't1' } ]` where `[ { what: 'stop', id: 'toolu_agent' } ]` was expected.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1545 tests passed.

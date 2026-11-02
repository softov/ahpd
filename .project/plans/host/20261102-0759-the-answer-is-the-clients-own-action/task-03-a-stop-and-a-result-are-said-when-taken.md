---
title: A stop and a client's result are said when taken
status: done
depends: [task-01-an-action-is-answered-on-its-own-channel.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `stopped`, `chat/turnCancelled` and `chat/toolCallComplete`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the answers a turn's end owes"
---

## Objective

A client's stop is said when the host takes it, so the turn ends in every client's state at once.
A client's tool result is said once the backend took it.
The backend is told after, and what it says of that turn or call then reduces to nothing.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - the stop and the result are said by the host; a worker chat's stop is said on the worker's chat.
- `UPDATE: packages/sdk/src/host.ts` - a turn's end owes only a turn start; `owe` takes a turn start or a queued message.
- `UPDATE: packages/sdk/src/host/context.ts` - `owe` and `answering` as they now are.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - a stop ends the turn before the backend lets go.

## Steps

1. Say the client's stop under the running turn, with the time it ran, then tell the backend.
2. On a worker's chat, say the stop there, then stop the worker or the lead turn.
3. Say a client's result once `completeToolCall` takes it.
4. Drop the owed stop and the owed result from a turn's end.

## Validation

- `pnpm exec vitest run packages/sdk/test/echo-origin.test.ts` - passes; the new case fails on c3c8c3e4.

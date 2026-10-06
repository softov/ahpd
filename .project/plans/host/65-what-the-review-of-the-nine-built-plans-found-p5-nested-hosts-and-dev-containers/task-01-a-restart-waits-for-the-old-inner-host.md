---
title: A restart waits for the old inner host and keeps its session
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L964-L983](../../../../packages/sdk/src/nested.ts#L964-L983) - `close`, which returns before the inner host is gone and disposes its session"
  - "[code://packages/sdk/src/host/lifecycle.ts#L409-L412](../../../../packages/sdk/src/host/lifecycle.ts#L409-L412) - the restart closes each chat"
  - "[code://packages/sdk/src/host/lifecycle.ts#L462-L470](../../../../packages/sdk/src/host/lifecycle.ts#L462-L470) - and spawns the new backend straight after"
  - "[code://packages/sdk/test/nested-process.test.ts](../../../../packages/sdk/test/nested-process.test.ts) - the cases against a real child"
---

## Objective

When a nested session restarts (a directory added, a folder moved), the old inner host is stopped without disposing its session, the restart waits until its process has exited, and only then starts the new one, which resumes the same inner session.
A removal still disposes the inner session before the host stops.

## Files

- `UPDATE: packages/sdk/src/nested.ts:964-983` - `close` takes whether the session is being removed, disposes inside only then, and resolves when the process has exited; today it returns at once, sends `disposeSession` inside on every close, and the old process lives up to `DISPOSE_WAIT` plus `KILL_AFTER`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:409-412,462-470` - the restart awaits the old chats' close before `spawn`; today the new inner `ahpd --stdio` starts while the old one runs, two processes write one session, and the old one's `disposeSession` is sent for the inner session the new one is resuming.
- `UPDATE: packages/sdk/src/types/agent.ts` - a chat's `close` may return a promise.
- `UPDATE: packages/sdk/test/nested-process.test.ts` - the case below.

## Steps

1. Failing case first: a nested session with one turn; add a directory. Today a second inner process starts before the first has exited; after, the first has exited before the second starts, and the second resumes with the first turn in it.
2. A removal still sends `disposeSession` inside (passes before and after).

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts`.

## Resume

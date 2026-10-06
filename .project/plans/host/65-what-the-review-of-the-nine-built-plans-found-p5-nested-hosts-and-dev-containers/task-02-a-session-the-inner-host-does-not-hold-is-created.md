---
title: A session the inner host does not hold is created, not resumed
status: todo
depends: [task-01-a-restart-waits-for-the-old-inner-host.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L756-L772](../../../../packages/sdk/src/nested.ts#L756-L772) - `createSession` skipped whenever `start.resume` is set"
  - "[code://packages/sdk/src/nested.ts#L817](../../../../packages/sdk/src/nested.ts#L817) - `agentId: () => sessionId`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L423-L426](../../../../packages/sdk/src/host/lifecycle.ts#L423-L426) - a restart resumes whenever `agentId()` is set"
---

## Objective

A nested session the inner host does not hold is created there, whether or not the outer host asked to resume it; one it holds is resumed.

## Files

- `UPDATE: packages/sdk/src/nested.ts:756-772` - on resume, ask the inner host whether it holds the session and create it when it does not; today `agentId()` is the session id from the start, so adding a directory before the first turn restarts with `resume` set, `createSession` is skipped, and an inner host that never persisted the session refuses with "holds no session to resume".
- `UPDATE: packages/sdk/test/nested-process.test.ts` - the case below.

## Steps

1. Failing case first: create a nested session, add a directory before any turn, then send a turn. Today the session ends with "holds no session to resume"; after, the turn runs.
2. A session with a turn, restarted, is still resumed with its turns (task 01's case).

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts`.

## Resume

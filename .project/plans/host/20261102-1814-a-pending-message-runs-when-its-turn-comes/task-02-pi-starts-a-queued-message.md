---
title: pi starts a queued message as a turn naming it
status: todo
depends: []
layer: agent-pi
refs:
  - "[code://packages/agent-pi/src/session.ts#L1159-L1213](../../../../packages/agent-pi/src/session.ts#L1159-L1213) - `startNext` and `runCommand`"
  - "[code://packages/agent-pi/src/session.ts#L1361-L1376](../../../../packages/agent-pi/src/session.ts#L1361-L1376) - `ran`"
  - "[code://packages/agent-pi/src/session.ts#L1500-L1512](../../../../packages/agent-pi/src/session.ts#L1500-L1512) - `queue`"
---

## Objective

A message or a command queued with nothing running starts at once.
Every turn pi starts for a queued message names it as `queuedMessageId`, and nothing is said of the message before that turn.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:1159-1213` - `startNext` says no removal, and hands the queued id to `runCommand`.
- `UPDATE: packages/agent-pi/src/session.ts:1361-1376` - `ran` queues a command under its queued id and starts the queue.
- `UPDATE: packages/agent-pi/src/session.ts:1500-1512` - `queue` starts the queue.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - a queued message and a queued command, each started as a turn naming it.

## Steps

1. Start the queue at the end of `queue`.
2. Queue a command that came with a queued id, and start the queue.
3. Name the queued id on the turn `runCommand` starts.
4. Remove the `chat/pendingMessageRemoved` that `startNext` says before a turn.
5. Add the two cases, and change the case that read the removal.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts`: the new cases fail on `89ebe4d5` and pass after.
- The agent-pi test files pass.
- `pnpm run typecheck` is clean.

## Resume

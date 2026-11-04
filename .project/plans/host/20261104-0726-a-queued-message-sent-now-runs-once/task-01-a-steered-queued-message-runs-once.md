---
title: A steered queued message runs once
status: implemented
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1485-L1486](../../../../packages/sdk/src/host/chatactions.ts#L1485-L1486) - the hand-off to `session.steer`"
---

## Objective

A steering message under the id of a queued entry goes into the running turn.
The host removes the queued entry, so the message does not run again.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1485-1486` - after `session.steer` takes the message, call `session.unqueue(id)` when the backend holds a queued entry under that id.
- `UPDATE: packages/sdk/test/host-steering.test.ts` - a case that queues, then steers the same id while a turn runs, and a case with a fresh id.

## Steps

1. In the `chat/pendingMessageSet` case, read whether the chat holds a queued entry under `id` before the steer.
2. Call `session.unqueue(id)` when `session.steer` returns true and the chat held such an entry.
3. Add the case that queues, then steers the same id: the backend gets one steer and one `unqueue`.
4. Add the case with a fresh id: the backend gets no `unqueue`.

## Validation

- The first new case fails without the change and passes with it.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- The sdk, agent-claude, agent-cofold, agent-pi and bot tests pass, one at a time.

## Resume

- **Done so far:** every step on 2026-11-04. The first case fails without the change.
- **Watch out for:** the tests are in the host's own steering file, because the fix is in the host and covers every backend.

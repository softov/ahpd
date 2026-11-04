---
title: A steered queued message runs once
status: todo
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
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - a case through the host: queue, then steer the same id while a turn runs.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - the same case for cofold.

## Steps

1. In the `chat/pendingMessageSet` case, read whether the chat holds a queued entry under `id` before the steer.
2. Call `session.unqueue(id)` when `session.steer` returns true and the chat held such an entry.
3. Add the Claude case: the turn takes the message once, and no `chat/turnStarted` names it.
4. Add the cofold case with the same checks.

## Validation

- The two new cases fail without the change and pass with it.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- The sdk, agent-claude, agent-cofold, agent-pi and bot tests pass, one at a time.

## Resume

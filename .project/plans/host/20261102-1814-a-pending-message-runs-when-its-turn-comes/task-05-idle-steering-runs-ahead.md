---
title: Idle steering runs ahead of the queue
status: todo
depends: [task-04-a-stop-holds-the-queue.md]
layer: host
refs:
  - "[code://packages/sdk/src/types/session.ts#L657-L672](../../../../packages/sdk/src/types/session.ts#L657-L672) - `Session.queue`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1307-L1396](../../../../packages/sdk/src/host/lifecycle.ts#L1307-L1396) - `beginOrRun`, which hands a waiting message to the queue"
  - "[code://packages/sdk/src/host/chatactions.ts#L1396-L1475](../../../../packages/sdk/src/host/chatactions.ts#L1396-L1475) - the pending message case"
---

## Objective

A steering message sent with no turn running is the next turn, ahead of every queued message the backend holds.
`Session.queue` takes the pending message's kind, and each backend puts a steering message at the head of its queue.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:657-672` - `queue` takes `kind`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:1307-1396` - `beginOrRun` hands the kind on.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1396-1475` - the pending message case names its kind.
- `UPDATE: packages/agent-claude/src/session/turns.ts:693-721` - a steering message goes to the head.
- `UPDATE: packages/agent-pi/src/session.ts:1508-1528` - the same in pi.
- `UPDATE: packages/agent-acp/src/session/queue.ts` - the same in ACP.
- `UPDATE: packages/agent-cofold/src/turns.ts:763-792` - the same in cofold.
- `UPDATE: packages/bot/src/chat.ts:968-978` - the same in the bot.
- `UPDATE: packages/sdk/src/sessions/nested.ts:1411-1425` - the kind goes to the inner host.
- `UPDATE: examples/echo/agent.ts:293-308` - the same in the example backend.
- `UPDATE: packages/sdk/test/host-steering.test.ts` - an idle steering message reaches the queue as steering.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts` - after a stop, an idle steering message runs before the queued one.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts:480-505` - the same in cofold.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - the same in Claude.

## Steps

1. Add `kind` to `Session.queue`, a steering message the next turn.
2. Hand the kind from the pending message case through `beginOrRun`.
3. Put a steering message at the head of each backend's queue.
4. Say the message under its own kind.
5. Add the host's case and a case per backend that holds a queue after a stop.

## Validation

- The new cases fail on `0229216e` and pass after.
- The sdk, agent-claude, agent-pi, agent-acp, agent-cofold and bot test files that queue a message pass.
- `pnpm run typecheck` is clean.

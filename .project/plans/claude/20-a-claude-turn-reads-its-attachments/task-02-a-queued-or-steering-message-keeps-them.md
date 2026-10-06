---
title: A queued or steering message keeps its attachments
status: todo
depends: [task-01-a-begun-turn-sends-its-attachments.md]
layer: "agent-claude"
refs:
  - "[code://packages/sdk/src/types/session.ts#L364](../../../../packages/sdk/src/types/session.ts#L364) - `steer`"
  - "[code://packages/sdk/src/types/session.ts#L412](../../../../packages/sdk/src/types/session.ts#L412) - `queue`"
  - "[code://packages/agent-claude/src/session/turns.ts#L433](../../../../packages/agent-claude/src/session/turns.ts#L433) - `steer`'s push"
---

## Objective

With host 68 task 02 passing them, the Claude backend keeps a queued message's attachments on its entry until its turn starts, and sends a steering message's with it.

## Files

- `UPDATE: packages/agent-claude/src/session/turns.ts` - `queue` stores them on the entry's `message`; `startNext` hands them to `beginTurn`; `steer` pushes `blocksFor(text, attachments)`.

## Steps

1. A queued entry's `message.attachments` is what `chat/pendingMessageSet` echoes, so a client sees them waiting.

## Validation

- A host test queues a message with an image behind a running turn and reads the fake CLI's content when it starts.
- A host test steers with pasted text and reads it in the pushed content.
- The `pnpm` gates.

## Resume

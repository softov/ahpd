---
title: A queued or steering message keeps its attachments
status: done
depends: [task-01-a-begun-turn-sends-its-attachments.md]
layer: "agent-claude"
refs:
  - "[code://packages/sdk/src/types/session.ts#L368](../../../../packages/sdk/src/types/session.ts#L368) - `steer`"
  - "[code://packages/sdk/src/types/session.ts#L420](../../../../packages/sdk/src/types/session.ts#L420) - `queue`"
  - "[code://packages/agent-claude/src/session/turns.ts#L433](../../../../packages/agent-claude/src/session/turns.ts#L433) - `steer`'s push"
---

## Objective

With host 68 task 02 passing them, the Claude backend keeps a queued message's attachments on its entry until its turn starts, and sends a steering message's with it.

## Files

- `UPDATE: packages/agent-claude/src/session/turns.ts` - `queue` stores them on the entry's `message`; `startNext` hands them to `beginTurn`; `steer` pushes `blocksFor(text, attachments)`.
- `UPDATE: packages/sdk/test/host-input.test.ts` - a queued message's image and a steering message's text, read off the CLI.

## Steps

1. A queued entry's `message.attachments` is what `chat/pendingMessageSet` echoes, so a client sees them waiting.

## Validation

- A host test queues a message with an image behind a running turn and reads the fake CLI's content when it starts.
- A host test steers with pasted text and reads it in the pushed content.
- The `pnpm` gates.

## Resume

- **Implemented** 2026-10-07 on `build/agents/c1f55bac`, uncommitted.
- `queue` keeps the attachments on the entry's `message`, which is what `chat/pendingMessageSet` echoes.
- `startNext` reads them back and hands them to `beginTurn`.
- `steer` announces them and pushes them as the content of the running turn.
- `packages/sdk/test/host-input.test.ts` reads a queued image and a steering text off the fake CLI.

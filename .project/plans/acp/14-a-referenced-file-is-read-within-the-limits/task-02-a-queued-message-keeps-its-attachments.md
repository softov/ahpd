---
title: A queued message keeps its attachments
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/queue.ts#L176-L201](../../../../packages/agent-acp/src/session/queue.ts#L176-L201) - `startNext`, passing the entry's attachments to `begin`"
  - "[code://packages/sdk/src/types/session.ts#L420](../../../../packages/sdk/src/types/session.ts#L420) - `queue`, which host 68 gave an `attachments` parameter"
---

## Objective

`queue` keeps the attachments host 68 passes on the entry's `message`, and `startNext` passes them to `begin`.

## Files

- `UPDATE: packages/agent-acp/src/session/queue.ts` - the queue keeps `message.attachments`, and `startNext` passes them to `begin`.
- `UPDATE: packages/agent-acp/test/agent-acp-blocks.test.ts` - a queued image reaches the prompt of its turn.

## Steps

1. The entry's `message.attachments` is what `chat/pendingMessageSet` echoes.

## Validation

- A queued message with an image reaches the fake server's prompt.

## Resume

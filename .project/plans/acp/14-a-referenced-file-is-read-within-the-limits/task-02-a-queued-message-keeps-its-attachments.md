---
title: A queued message keeps its attachments
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/queue.ts#L185-L195](../../../../packages/agent-acp/src/session/queue.ts#L185-L195) - `startNext`, passing `undefined`"
---

## Objective

`queue` keeps the attachments host 68 passes on the entry's `message`, and `startNext` passes them to `begin`.

## Files

- `UPDATE: packages/agent-acp/src/session/queue.ts`.

## Steps

1. The entry's `message.attachments` is what `chat/pendingMessageSet` echoes.

## Validation

- A queued message with an image reaches the fake server's prompt.

## Resume

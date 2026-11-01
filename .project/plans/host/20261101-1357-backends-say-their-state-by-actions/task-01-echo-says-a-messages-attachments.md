---
title: The echo backend says a message's attachments
status: todo
depends: []
layer: "examples"
refs:
  - "[code://examples/echo/agent.ts](../../../../examples/echo/agent.ts) - `beginTurn`, `begin`, `queue` and `startNext`"
  - "[code://packages/sdk/test/host-attachments.test.ts](../../../../packages/sdk/test/host-attachments.test.ts) - the case that reads the pasted picture off the turn"
---

## Objective

A turn the echo backend starts carries the attachments its message was handed, on the action and so in every client's chat.

## Files

- `UPDATE: examples/echo/agent.ts` - `beginTurn` takes the attachments, and `begin`, `queue` and `startNext` hand them on.

## Steps

1. Add an `attachments` parameter to `beginTurn`, and put a non-empty list on the turn's message.
2. Hand `begin`'s attachments to `beginTurn`.
3. Put `queue`'s attachments on the queued message, and hand them on in `startNext`.

## Validation

- `host-attachments.test.ts` "writes an embedded image to a file" fails without the change.
- The turn it reads there carries no attachments.
- With the change, the file passes 9 of 9.

## Resume

Not started.

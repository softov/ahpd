---
title: begin carries a message's attachments
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L345](../../../../packages/sdk/src/types/session.ts#L345) - `begin`"
  - "[code://packages/sdk/src/host.ts#L6188](../../../../packages/sdk/src/host.ts#L6188) - the attachments"
---

## Objective

`Session.begin` gains an optional attachments argument, filled by the host from the message.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:345`.
- `UPDATE: packages/sdk/src/host.ts`.

## Steps

1. Read what the host does with attachments today at line 6188 first; if it already turns them into text for backends, keep that for backends that ignore the argument.

## Validation

- A message with an attachment reaches a fake session's `begin`.

## Resume

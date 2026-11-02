---
title: The docs say how the bits move
status: todo
depends: [task-01-a-session-and-its-chats-move-each-other.md]
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L252](../../../../docs/sdk/AHP.md#L252) - the `session/isReadChanged` row"
  - "[code://docs/sdk/AHP.md#L280](../../../../docs/sdk/AHP.md#L280) - the `chat/isReadChanged` row"
---

## Objective

`AHP.md` says how a session's read bit and its chats' bits move each other.

## Files

- `UPDATE: docs/sdk/AHP.md:252` - the `session/isReadChanged` row says when a read is said unread and when a sole chat moves.
- `UPDATE: docs/sdk/AHP.md:280` - the `chat/isReadChanged` row says when the session moves with a chat.

## Steps

1. Grep the docs and the touched files for wording that keeps the bits apart.
2. Write each row from what the host does after task 01.

## Validation

- `rg -n -i "neither action implies|its own read state|alone" docs/sdk/AHP.md packages/sdk/src/host/chatactions.ts` names no read bit kept apart.

## Resume

Not started.

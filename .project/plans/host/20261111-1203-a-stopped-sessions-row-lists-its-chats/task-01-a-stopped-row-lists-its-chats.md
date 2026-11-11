---
title: A stopped row lists its chats
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L1553-L1599](../../../../packages/sdk/src/host/catalogue.ts#L1553-L1599) - the row to extend"
  - "[code://packages/sdk/src/host/catalogue.ts#L560-L571](../../../../packages/sdk/src/host/catalogue.ts#L560-L571) - the shape of a row's chats"
---

## Objective

The row of a session nothing runs carries `chats` and `defaultChat` from the record, in the shape a running session's row has.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:1553-1599` - `registerListedSession` adds `chats` and `defaultChat`.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - a second host on the same store lists the nested chat.

## Steps

1. Read the record's chats with `recordedChats` for the row's id.
2. Map each one to a summary chat with its title, origin, provider and status.
3. Set the status to `Idle` with the chat's own flags, and `archived` when they say so.
4. Leave out a tool's chat.
5. Set `defaultChat` to the chat the record marks default.
6. Add both to the row only when the record has chats.
7. Write a test: a session with a nested chat, a second host on the same store, and its `list_sessions` row.

## Validation

- `sessiontools.test.ts`: the second host's row lists the nested chat with the link the first host gave.
- `pnpm typecheck` passes.

## Resume

- `storedChatsOf` in `catalogue.ts` builds a stopped row's `chats` and `defaultChat` from the record, in `toSessionSummaryChats`' shape.
- Both `registerListedSession` and `getSurfacedSessionSummary` use it, since the listing rebuilds each stopped row in the second.

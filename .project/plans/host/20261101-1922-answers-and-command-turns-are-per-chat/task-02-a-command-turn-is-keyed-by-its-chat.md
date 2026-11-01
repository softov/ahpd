---
title: A command turn is keyed by its chat
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/context.ts#L145-L153](../../../../packages/sdk/src/host/context.ts#L145-L153) - `commandTurns`, by turn id while they run"
  - "[code://packages/sdk/src/host/spawn.ts#L1483-L1499](../../../../packages/sdk/src/host/spawn.ts#L1483-L1499) - a command turn's start and end"
---

## Objective

A `!` command's turn is held under its chat and its turn id.
Two chats that run a turn of the same id each put back their own chat's read bit at the end.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:138-141` - `commandTurnKey(chat, turn)` beside `startsRead`.
- `UPDATE: packages/sdk/src/host/context.ts:145-153` - `commandTurns` is keyed by `commandTurnKey`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:1394` - a command turn is held under its chat.
- `UPDATE: packages/sdk/src/host/spawn.ts:1263` - a queued command moves to its turn in the same chat.
- `UPDATE: packages/sdk/src/host/spawn.ts:1483-1499` - a command turn's start and end read the key of their own chat.
- `UPDATE: packages/sdk/test/host-terminals.test.ts` - two chats run command turn `t1` at once.

## Steps

1. Add `commandTurnKey` to chatactions.ts, which spawn.ts and lifecycle.ts already import from.
2. Key every `commandTurns` read and write by `commandTurnKey` and the chat in hand.
3. Add a test where a long and a short command turn share id `t1` in two sessions.

## Validation

- `packages/sdk/test/host-terminals.test.ts`: both chats and both sessions end read; before the change, the long one's session ends unread.
- `pnpm typecheck` exits 0.

## Resume


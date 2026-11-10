---
title: set_workspace moves the calling chat
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L2086](../../../../packages/sdk/src/host/tooling.ts#L2086) - `setWorkspace`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1150](../../../../packages/sdk/src/host/lifecycle.ts#L1150) - `moveSession`"
---

## Objective

For an agent with `multipleDirectories`, `set_workspace` moves only the calling chat at its turn's end, with `restartChat`, and the session's folders gain the new one.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:2086` - the move is kept for the calling chat.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:1150` - a chat's move beside the session's move.
- `UPDATE: packages/sdk/src/tools/session.ts:459-505` - VS Code's text.
- `UPDATE: packages/sdk/test` - a session with two chats, one moved.

## Steps

1. Keep the move with the calling chat's URI.
2. At the turn's end, set that chat's folders, add the folder to the session's, and run `restartChat`.
3. Start the continuation turn in that chat.
4. Keep `moveSession` for an agent without `multipleDirectories`.
5. Copy VS Code's `set_workspace` text at 171e90619.
6. Check by hand that ahpw and ahpc draw the session after the move.

## Validation

- Two chats in one session: one calls `set_workspace`, and the other keeps its folder and its process.
- `pnpm typecheck`, then the sdk suite.

## Resume


---
title: set_workspace moves the calling chat
status: implemented
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

Implemented 2026-11-10. `set_workspace` keeps the move with the calling chat's URI. At its turn's end, `moveChatWorkspace` moves that chat alone when the agent has `multipleDirectories`. It asks the window about the folder. It cuts a worktree when isolation was asked for, and keeps that tree with the session's. It restarts the chat resumed in the new folder with `relaunchChat`. It adds the folder to the session's set before replacing the chat's folders. It starts the continuation turn in the chat with VS Code's `Workspace Set` label and its words for a chat alone. An agent without `multipleDirectories` keeps `moveSession` and its `Continue in the requested workspace.` turn. A failed move continues the chat's turn under `Workspace Setup Failed` in VS Code's words, as a session's move does. `packages/sdk/test/host-tools.test.ts` has a chat-alone move and a two-chat move. In the two-chat move, the other chat keeps its folder and its process. Its session-move case and `packages/sdk/test/host-files.test.ts` now run an agent without `multipleDirectories`. The host-files cases that change a session's folders run one with it. Gate: typecheck clean. The sdk suite passed 4623 and failed 1, `watches.test.ts > honours the excludes it was given`. That failure is the prescribed `TMPDIR` inside the worktree that task 01 records. Step 6 was not done: this mode starts no daemon and neither client is in this repository.


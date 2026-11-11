---
title: A row lists its chats
status: todo
depends: []
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L105-L140](../../../../packages/sdk/src/tools/session.ts#L105-L140) - `serializeSession`, which gets `chats`"
  - "[code://packages/sdk/src/tools/session.ts#L535-L567](../../../../packages/sdk/src/tools/session.ts#L535-L567) - `list_sessions`, whose description gets the sentence on `chats`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1194](../../../../packages/sdk/src/host/sessionmethods.ts#L1194) - the row's `chats`, cut to the chats a connection is shown"
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L611-L644 - the shape and the filter this task copies
---

## Objective

A `list_sessions` row, and the `get_current_session` answer, list `chats` when the session has a nested chat.
Each entry has the chat's `title`, `openLink` and `status`, with `main: true` for the default chat.
An entry has `harness` when the host knows the chat runs another agent.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:105-140` - `serializeSession` serializes the row's `chats` with VS Code's filter and fields.
- `UPDATE: packages/sdk/src/tools/session.ts:535-567` - `list_sessions`'s description adds VS Code's sentence on `chats`.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the cases in *Validation*.
- `UPDATE: docs/sdk/TOOLS.md` - a row's `chats`.
- `UPDATE: docs/server/MCP.md:47` - `list_sessions` lists a session's chats.

## Steps

1. Read each chat of the row's `chats` in `serializeSession`, in the row's order.
2. Leave out a chat whose `origin` is a tool and a chat whose `interactivity` is hidden.
3. Leave out `chats` when only the default chat remains.
4. Give each entry `title`, `openLink`, `main: true` for the default chat, and `status` in the words a row's `status` uses.
5. Build a nested chat's `openLink` with its chat id, and the default chat's as the session's own link.
6. Add `harness` only where the host records another agent for the chat.
7. Add VS Code's sentence on `chats` to `list_sessions`'s description.
8. Update the docs.
9. Write the tests.

## Validation

- `packages/sdk/test/sessiontools.test.ts`: a session with one nested chat lists two `chats`, the default one first with `main: true`.
- A nested chat's `openLink` targets that chat in `get_session_context` and `rename_chat`.
- A session with its default chat only has no `chats` key.
- A tool's chat and a hidden chat are not listed.
- `get_current_session` carries the same `chats`.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes.

## Resume


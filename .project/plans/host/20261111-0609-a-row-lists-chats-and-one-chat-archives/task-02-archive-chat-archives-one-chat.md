---
title: archive_chat archives one chat
status: implemented
depends: [task-01-a-row-lists-its-chats.md]
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L1029-L1053](../../../../packages/sdk/src/tools/session.ts#L1029-L1053) - `delete_session`, the tool shape this one copies"
  - "[code://packages/sdk/src/host/chatactions.ts#L112-L128](../../../../packages/sdk/src/host/chatactions.ts#L112-L128) - `chatFlag`, the chat's archive"
  - "[code://packages/sdk/src/host/actions.ts#L955-L975](../../../../packages/sdk/src/host/actions.ts#L955-L975) - a default chat's archive is the session's"
  - "[code://packages/sdk/src/host/gate.ts#L163](../../../../packages/sdk/src/host/gate.ts#L163) - `session:mark`"
  - "[code://packages/sdk/src/host/gate.ts#L183](../../../../packages/sdk/src/host/gate.ts#L183) - `chat:mark`"
  - "[code://UPSTREAM.md#L29](../../../../UPSTREAM.md#L29) - the item this task closes"
  - https://github.com/microsoft/vscode/blob/a1a15017f8a/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L2045-L2096 - the targets and the refusals this task copies
---

## Objective

`archive_chat { chat }` archives a nested chat alone, or the whole session for its default chat or a session link.
It refuses the chat it runs in and the default chat of its own session, and it is served at `/mcp`.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts` - add `archive_chat` beside `delete_session`, with VS Code's input, description and refusals, `sessionless: true`.
- `UPDATE: packages/sdk/src/types/host.ts:1659` - the tools' host gets one call that archives a chat or a session, through the host's own archive.
- `UPDATE: packages/sdk/src/host/tooling.ts` - that call, over `chatFlag` for a chat and the session's archive for a session.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the cases in *Validation*.
- `UPDATE: docs/sdk/TOOLS.md` - `archive_chat`.
- `UPDATE: docs/server/MCP.md:45-62` - `archive_chat` in the table, and the count of tools a `member` sees.
- `UPDATE: UPSTREAM.md:29` - check the `archive_chat` item, with this plan's id.

## Steps

1. Add the tool's definition with VS Code's input schema and description, in the order VS Code lists it.
2. Resolve `chat` with the other tools' lookup, and refuse an id that names no chat of the session.
3. Read a session link, or the default chat's link, as the whole session.
4. Refuse the calling chat, and the default chat of its own session, in VS Code's words.
5. Check `chat:mark` for a chat and `session:mark` for a session before the archive.
6. Archive through the tools' host, so the archive takes the host's own path and its clients see it.
7. Answer VS Code's confirmation text for each target.
8. Update the docs and `UPSTREAM.md`.
9. Write the tests.

## Validation

- `packages/sdk/test/sessiontools.test.ts`: a nested chat's link archives that chat, and the session stays unarchived.
- A session link archives the session, and so does the default chat's link.
- The tool refuses the chat it runs in, and the default chat of its own session.
- A caller without `chat:mark` cannot archive a chat.
- A caller with no session can call it, as `/mcp` does.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes, then `packages/server`.

## Resume


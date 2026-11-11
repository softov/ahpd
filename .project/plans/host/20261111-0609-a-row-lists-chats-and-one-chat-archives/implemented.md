---
title: A session row lists its chats, and one chat archives - implemented
date: 2026-11-11
refs:
  - git://9d9f40bec
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts)"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts)"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts)"
  - "[code://packages/sdk/test/sessiontools.test.ts](../../../../packages/sdk/test/sessiontools.test.ts)"
---

A `list_sessions` row now lists its chats when the session has a nested chat, and `get_current_session` answers the same list.
Each chat carries its title and an `openLink` that names it in the other session tools.
The default chat also carries `main: true`, and a chat carries its status and its harness where one differs.
`archive_chat` archives one nested chat, or a whole session through its main chat or a session link, from a session and from `/mcp`.

## What was built

- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - `serializeChats` fills the row's `chats`, and the `list_sessions` description carries VS Code's sentence on it. `archive_chat` resolves its link, refuses its own chat and session, checks `chat:mark` or `session:mark`, and archives through the tools' host.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `archive(session, chat?)` on the tools' host, answering whether the bit moved.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `archiveOf` calls `chatFlag` for a chat and `sessionFlag` for a session, and both tool contexts expose it.
- [`code://packages/sdk/test/sessiontools.test.ts`](../../../../packages/sdk/test/sessiontools.test.ts) - two cases cover the serialized row, and one covers a row's chats resolving through `get_session_context` and `rename_chat`. One case archives a nested chat, a session link and a main chat's link. One case covers the own-chat and own-session refusals. A sessionless case archives and refuses a caller without `chat:mark`.
- `docs/sdk/TOOLS.md`, `docs/server/MCP.md` and `UPSTREAM.md` - the fourteen session tools, the row's `chats`, and `archive_chat` marked built.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` passed with no output.
- The three new cases pass when run by name in `packages/sdk/test/sessiontools.test.ts`. They are the row's chats, the archive targets and refusals in a turn, and the sessionless archive with the grant refusal.
- An earlier whole-file run passed the sixty-five existing cases and failed only the three new ones, which the fixes above then made pass.
- The vitest suites are left to review, because this session's mode refused `flock`.
- `packages/sdk/test/fixtures/wire.jsonl` is unmodified, so no restore was needed.

## Departures from the plan

- An explicit `chat=` that is empty or cannot be decoded is refused, which the task's steps did not name. VS Code refuses it in `getArchiveChatArgs`, and without the check `sessionMeant` would drop the empty id and archive the whole session.
- The turn case starts a running turn before calling `create_chat`. A session tool called with no turn running acts as nobody and may not write, which the plan's validation did not say how to reach.

## Left for later

- None.

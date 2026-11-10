---
title: move_session reorganizes sessions
status: implemented
depends: []
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L190-L200](../../../../packages/sdk/src/host/sessionmethods.ts#L190-L200) - the host's `moveChat`"
  - "[code://packages/sdk/src/tools/session.ts#L406](../../../../packages/sdk/src/tools/session.ts#L406) - `sessionTools`"
---

## Objective

ahpd serves VS Code's `move_session`, over the host's `moveChat`, with VS Code's schema, text and refusals.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:406` - `move_session` joins `sessionTools`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - `createChatMover` reads the `end` anchor, the destination's last chat.
- `UPDATE: packages/sdk/src/host/tooling.ts` - the tool context's `move` calls the host's mover.
- `UPDATE: packages/sdk/src/types/host.ts` - `ToolCall.move` and its `after` anchor.
- `UPDATE: packages/sdk/test` - the cases of the move.
- `UPDATE: docs/server/MCP.md` - the tool.
- `UPDATE: docs/sdk/TOOLS.md` - the tool.

## Steps

1. Copy VS Code's `move_session` schema and description at 171e90619.
2. Map `into`, `after` and `relationship: independent` to the host's `moveChat`.
3. Refuse while `chatMoves.enabled` is off, in the host's words.
4. Give the tool the grant `session:write`.

## Validation

- A move into another session, a reorder, `independent`, and a refusal while moves are off.
- `pnpm typecheck`, then the sdk suite.

## Resume

Implemented 2026-11-10. `move_session` is in `sessionTools` with VS Code's name, title, description and input schema, its read-only and destructive hints, grant `session:write`, `sessionless: true` and `deferLoading: true`.
`into`, `after` and `relationship: "independent"` map to `ToolCall.move` over the host's `moveChat`, and the nine refusal reasons are VS Code's words.
`packages/sdk/src/host/sessionmethods.ts` holds `createChatMover`, which the protocol's `moveChat` and the tool share.
`packages/sdk/src/host/tooling.ts` gives a turn's tool context the mover, and `packages/sdk/src/types/host.ts` declares `ToolCall.move`.
Cases are in `packages/sdk/test/host-tools.test.ts` and `packages/sdk/test/sessiontools.test.ts`; `docs/server/MCP.md` and `docs/sdk/TOOLS.md` name the tool.

A tool's absent `after` is the destination's last chat, so the mover gained the `end` anchor.
A client's absent `after` stays the protocol's beginning.

Left undone, outside the steps: VS Code's `maxMovedSessions: 50` and `topLevelChatOnly: true` are not enforced.
A whole-session move is refused, because a session's default chat is not structurally movable.
`list_sessions` sends no `chats`, so the copied text's "the `openLink` listed for it in the session's `chats`" has no list to point at.

Gate: typecheck clean. The sdk suite passed 4629 and failed 1: `watches.test.ts > honours the excludes it was given`. The prescribed `TMPDIR` inside the worktree breaks it, because the case's own paths then contain `node_modules/`. `packages/sdk/test/host-tools.test.ts` passed 105, and `packages/sdk/test/sessiontools.test.ts` passed 61.

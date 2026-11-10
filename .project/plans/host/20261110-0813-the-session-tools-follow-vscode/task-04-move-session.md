---
title: move_session reorganizes sessions
status: todo
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


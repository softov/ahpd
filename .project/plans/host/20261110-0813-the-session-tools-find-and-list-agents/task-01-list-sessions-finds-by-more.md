---
title: list_sessions finds by more
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - `serializeSession`, `filterSessions` and `list_sessions`"
---

## Objective

A `list_sessions` row says its `agent`, and the tool takes `agent`, `limit`, `title`, `path`, `modifiedAfter` and `modifiedBefore`, newest first.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:102-136` - the row says `agent`.
- `UPDATE: packages/sdk/src/tools/session.ts:139-180` - the new filters, and the order newest first.
- `UPDATE: packages/sdk/src/tools/session.ts:409-440` - the inputs and the description of `list_sessions`.
- `UPDATE: packages/sdk/test` - the `list_sessions` cases.
- `UPDATE: docs/server/MCP.md:43-61` - the new inputs.

## Steps

1. Add `agent`, the session's provider id, to the row.
2. Add `agent`, an exact provider id.
3. Add `title` and `path`, each a text that the title or a folder contains, in any case.
4. Add `modifiedAfter` and `modifiedBefore`, as `createdAfter` and `createdBefore` are.
5. Sort the rows by `modifiedAt`, newest first, and keep the first `limit`.
6. Say in the answer when the limit cut rows, as `get_session_context` says a cut transcript.
7. Keep VS Code's description words, and add one sentence for the new filters in its style.

## Validation

- A case for each filter, for the order, and for a limit that cuts rows.
- `pnpm typecheck`, then the sdk suite.

## Resume


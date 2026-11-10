---
title: list_sessions finds by more
status: implemented
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

Implemented 2026-11-10. A row answers `agent`, its provider id; `filterSessions` takes `agent` (exact), `title` and `path` (contains, any case), `modifiedAfter` and `modifiedBefore`, and answers newest first by `modifiedAt`, keeping the catalogue's order for rows changed in the same millisecond; `list_sessions` keeps the newest `limit` and answers `truncated: true` when the limit cut rows. `path` matches a working directory, as its path or its `file://` URI, in any case; a project's URI is not matched by it, since `workspace` already names a project. Cases in `packages/sdk/test/sessiontools.test.ts`; `docs/server/MCP.md` names the new filters. Gate: typecheck clean, sdk suite green but for eight git/filesystem cases (`changes-refresh`, `git`, `watches`, `worktrees`) that the prescribed `TMPDIR` inside the worktree breaks - they pass with `TMPDIR` outside the repository, and none of them reads these tools.


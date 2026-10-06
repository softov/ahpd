---
title: A deleted session leaves the held catalogue
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/history.ts#L129-L181](../../../../packages/sdk/src/host/history.ts#L129-L181) - the held `rows`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L343-L373](../../../../packages/sdk/src/host/lifecycle.ts#L343-L373) - `removeSession`, which never touches `rows`"
---

## Objective

After `disposeSession`, the next `listSessions` and the `list_sessions` tool no longer return the session, and the next refresh sends no second `root/sessionRemoved` for it.

## Files

- `UPDATE: packages/sdk/src/host/history.ts` - a `drop(resource)` that removes a row from the held rows.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:343-373` - `removeSession` calls it.
- `UPDATE: packages/sdk/test/host-catalogue-held.test.ts` - the case below.

## Steps

1. Failing case first: list, dispose a listed session, list again; the second answer must not hold it, and a following refresh must not announce it removed a second time.
2. History gains `drop(resource)`, which filters the held rows. A refresh already in flight that read the store before the delete can still put the row back; record dropped resources until the next listing that started after the drop lands, and filter them out of it.
3. `removeSession` calls `drop` for the session's resource, under both spellings of its name.

## Validation

- The case fails on `main` and passes after.
- `pnpm exec vitest run packages/sdk/test/host-catalogue*.test.ts packages/sdk/test/session-delete.test.ts`.

## Resume

Built 2026-10-06.

- The two cases in `describe('a session deleted from the catalogue')` in `packages/sdk/test/host-catalogue-held.test.ts`. Both failed first on `c4e4dd0`, each answering `['slow:/one']` where `[]` was expected: the row was held, and the delete never reached it.
- The `backend` fixture gained `delete`, which takes the row out of its store the way a backend answering for its own transcripts would, and `started` takes the backend to build the host over. The second case needs one that reads its store when a pass starts - `readingEarly` - because the fixture reads it when the pass lands, which is the timing the rest of the file leans on: moving that read broke two cases here, so the variant is local to the case that needs it.
- `history.ts` gained `drop(resource)`, which filters the held rows by id and dates the delete with the pass it happened in, and `refresh` now filters what a pass found and what it is diffed against by that date. The record is cleared once a pass that started after the delete has landed.
- `lifecycle.ts`'s `removeSession` calls `ctx.drop(uri)` beside `forgetSent`, before the broadcast. Read off `ctx` rather than the destructure at the top of the factory, because history is built after lifecycle.
- `pnpm exec vitest run packages/sdk/test/host-catalogue*.test.ts packages/sdk/test/session-delete.test.ts packages/sdk/test/host-past-open.test.ts` passes, 58 tests. `pnpm typecheck` passes.

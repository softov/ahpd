---
title: A deleted session leaves the held catalogue
status: todo
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

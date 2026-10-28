---
title: The store keeps a session's URI
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/sessions.ts#L240-L252](../../../../packages/sdk/src/types/sessions.ts#L240-L252) - `provider` and `setProvider`, the shape the new pair copies"
  - "[code://packages/sdk/src/sessions/sessions.ts#L423-L467](../../../../packages/sdk/src/sessions/sessions.ts#L423-L467) - `Row` and `empty`"
  - "[code://packages/sdk/src/sessions/sessions.ts#L753-L755](../../../../packages/sdk/src/sessions/sessions.ts#L753-L755) - how a file row's `provider` is read back"
---

## Objective

A session's row holds the URI the host holds the session under, as `uri`, in the memory store and in the file store.
A row that holds only a `uri` is empty, so a URI alone writes no file.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts:240-252` - add optional `uri(id)` and `setUri(id, value)` beside `provider`, with a comment on what the name is.
- `UPDATE: packages/sdk/src/sessions/sessions.ts` - `Row`, the file row type, `memorySessions`, `fileSessions`, the read of a file row and `empty` gain `uri`.
- `UPDATE: packages/sdk/test/sessions.test.ts` - cases for the stored URI.

## Steps

1. Add `uri?(id)` and `setUri?(id, value)` to `SessionStore`, optional as `workingDirectory` is.
2. Add `uri` to `Row` and to the file row type.
3. Implement the pair in `memorySessions` with `patch`, as `setProvider` does.
4. Implement the pair in `fileSessions` through `touched`, and write `uri` with the other fields.
5. Read `uri` back from a file row only when it is a non-empty string.
6. Do not count `uri` in `empty`, the same as the working folder.

## Validation

- Test in `packages/sdk/test/sessions.test.ts` that a stored `uri` reads back after the file store opens again.
- Test that a row with only a `uri` writes no file.
- Test that a file row whose `uri` is not a string reads as a row with no `uri`.
- `pnpm boundary`, `pnpm typecheck` and `pnpm test` pass.

## Resume

---
title: A streamed file opens before its body is made
status: todo
depends: []
layer: "@ahpd/activepieces"
refs:
  - "[code://packages/activepieces/src/files.ts#L223-L235](../../../../packages/activepieces/src/files.ts#L223-L235) - `attachmentOf`: `stat`, then `createReadStream`, which opens the file after the body is returned"
  - "[code://packages/activepieces/test/files.test.ts#L104-L117](../../../../packages/activepieces/test/files.test.ts#L104-L117) - the streaming case, which destroys the body before it opened"
  - "[code://packages/activepieces/test/files.test.ts#L21-L24](../../../../packages/activepieces/test/files.test.ts#L21-L24) - `afterEach`, which removes the folder"
  - https://nodejs.org/api/fs.html#filehandlecreatereadstreamoptions - `FileHandle.createReadStream`, a stream over a file that is already open
---

## Objective

A streaming attachment is opened before `attachmentOf` returns, so a file that went away is no file, and no stream throws in the daemon.

## Files

- `UPDATE: packages/activepieces/src/files.ts:223-235` - the streaming branch opens a file handle, takes the size from it, and makes the body from it.
- `UPDATE: packages/activepieces/test/files.test.ts:104-117` - the case waits for the body to close, and a new case covers a file that does not open.

## Steps

1. Import `open` from `node:fs/promises` in `files.ts`.
2. In the streaming branch of `attachmentOf`, open `found` with `open(found, 'r')`, and return `null` when it fails.
3. Take `size` from `handle.stat()`, and make `body` with `handle.createReadStream()`.
4. Close the handle when `handle.stat()` fails, and return `null`.
5. Remove the `createReadStream` import from `node:fs` when nothing else uses it.
6. In the streaming case, wait for `once(body, 'close')` after `body.destroy()`.
7. Mock `open` of `node:fs/promises` in the test file with a pass-through to the real `open`.
8. Add a case where `open` rejects once with `ENOENT`: the streaming prop gives `null`, and nothing throws.
9. Run the file alone 24 times, and record the failures.

## Validation

- `pnpm vitest run packages/activepieces/test/files.test.ts`, 24 times in a row: 0 failures and no unhandled error.
- `pnpm typecheck` and `pnpm boundary` pass.
- The PR's `check` job ends with no "Unhandled Errors" section.

## Resume

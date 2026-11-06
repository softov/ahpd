---
title: An unreadable file is moved aside
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/sessions/sessions.ts#L715-L737](../../../../packages/sdk/src/sessions/sessions.ts#L715-L737) - `load`"
---

## Objective

`load` renames a session file it cannot read to `<file>.unreadable-<time>`, so no write replaces it.

## Files

- `UPDATE: packages/sdk/src/sessions/sessions.ts:715-737` - `load` renames a file that is not read, and logs the new name.
- `UPDATE: packages/sdk/test/sessions.test.ts` - cases for a file that is not JSON and for a file of version 2.

## Steps

1. In `load`, when a file is not `ok` and not `missing`, or has an unknown version, rename it with `renameSync`.
2. Log `Moved <file> to <new name>: <reason>`, with the reason and no file contents.
3. When the rename throws, log that the file stays, and go on to the next file.
4. Add a case for a file that is not JSON: after a load and a write, check the moved text.
5. Add the case for a file of version 2, with the same check.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/sdk test` passes, run alone.

## Resume

- **Done so far:** every step.
- **Found:** the old log line for a file that is not JSON quoted the parser's error, which quotes the file. It now says only that the file is not JSON.

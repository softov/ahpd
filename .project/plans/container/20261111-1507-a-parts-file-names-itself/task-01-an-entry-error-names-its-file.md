---
title: An entry error names its file
status: implemented
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/parts.ts#L133-L156](../../../../packages/computer/src/parts.ts#L133-L156) - `said`, `entryOf` and `exact`"
---

## Objective

Each error that `entryOf` throws names the file that `readParts` read.

## Files

- `UPDATE: packages/computer/src/parts.ts:133-262` - `said` takes the file, and `entryOf` takes the path from `readParts`.
- `UPDATE: packages/computer/test/computer-parts.test.ts:129-136` - the version cases expect the temp file's path.

## Steps

1. Give `said` a first parameter, the file to name.
2. Give `entryOf` a third parameter, `path`, and call `said` with it inside `entryOf`.
3. Use `path` in the message of `exact` in place of `versionsPath()`.
4. Pass `path` from `readParts` to `entryOf`.
5. Change the version cases to write the temp file first and expect its path.

## Validation

- `computer-parts.test.ts`: the version cases name the temp file.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/computer` passes.

## Resume

Implemented 2026-11-11 in `1780c81fc`. See [implemented.md](implemented.md).


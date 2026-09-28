---
title: A trailing newline is not counted as a line
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L36-L44](../../../../packages/sdk/src/changes.ts#L36-L44) - `counted()` splits on `\\n` and keeps the empty last row"
---

## Objective

A two-line file ending in a newline counts as two added lines in the session's changes.

## Files

- `UPDATE: packages/sdk/src/changes.ts:36-44` - drop the empty row after a final newline on both sides.
- `UPDATE: packages/sdk/test/` - the case below, beside the existing `counted` or session-row cases.

## Steps

1. Check `lines()` in the same file for the same count.

## Validation

- A created file `"a\nb\n"` shows `added: 2`; it fails first with 3.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

- **Done:** `counted()` in `packages/sdk/src/changes.ts` drops one final newline from each side before splitting, so it ends the last line rather than starting an empty one.
- **Step 1:** `lines()` in the same file already subtracts a final newline, so untracked files in the `uncommitted` scope were counted right; it is unchanged.
- **Tests:** in `packages/sdk/test/changes-uris.test.ts`, beside the captured-side cases, a new `describe('a turn\'s line counts')` over the `session` scope: "counts a created file ending in a newline by its lines" (`a\nb\n` is 2 added), "counts a created file with no final newline by its lines" (`a\nb` is 2), "counts a changed line once on each side" (`a\nb\n` to `a\nc\n` is 1 and 1).
- **Failed first:** the first case with `added: 3`; the other two passed before and after, since both sides shared the empty last row or had none.
- **Departures:** none.
- **Not in scope, seen:** a change that only adds or removes the final newline now counts as 0 and 0, where git counts 1 and 1.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 1568 passed of 1568 in 108 files.

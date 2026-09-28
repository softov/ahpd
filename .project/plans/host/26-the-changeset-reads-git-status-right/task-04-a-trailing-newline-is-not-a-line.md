---
title: A trailing newline is not counted as a line
status: todo
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

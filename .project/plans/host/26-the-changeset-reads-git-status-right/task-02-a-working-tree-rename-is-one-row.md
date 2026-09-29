---
title: A rename in the working tree is one row
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L574-L590](../../../../packages/sdk/src/changes.ts#L574-L590) - the record loop, which consumes a source record only for `code[0]`"
  - "[code://packages/sdk/test/commit.test.ts](../../../../packages/sdk/test/commit.test.ts) - 'keeps a staged rename as one row under its new name', the index-column case"
---

## Objective

A record whose working-tree column is `R` or `C` consumes the source record after it, so no fake row appears.

## Files

- `UPDATE: packages/sdk/src/changes.ts:584` - consume the next record when either column is `R` or `C`; the comment above says so.
- `UPDATE: packages/sdk/test/commit.test.ts` - the case below.

## Steps

1. Test beside the staged-rename case: a tracked `Data.txt` moved to `new.txt` and `git add -N new.txt` lists one row, `new.txt`, and no `a.txt`.

## Validation

- The case fails first with a second row `a.txt` whose `after` is missing.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

- **Done:** `look()` in `packages/sdk/src/changes.ts` consumes the source record after a porcelain record whose code has `R` or `C` in either column; the comment above says so.
- **Tests:** in `packages/sdk/test/commit.test.ts`: "keeps a working-tree rename as one row under its new name": a committed `Data.txt` renamed on disk to `new.txt`, then `git add -N new.txt`; it checks git's own porcelain is ` R Data.txt -> new.txt`, that the rows are only `new.txt`, and that the row has an `after`.
- **Failed first:** the rows were `new.txt` and a fake `a.txt` (the tail of `Data.txt` after its first three characters, read as `Da` status plus path).
- **Departures:** none.
- **Not in scope, seen:** the renamed row's `before` names `HEAD:new.txt`, which does not exist; a staged rename has the same `before` today.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 1562 passed of 1562 in 108 files.

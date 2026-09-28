---
title: A rename in the working tree is one row
status: todo
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

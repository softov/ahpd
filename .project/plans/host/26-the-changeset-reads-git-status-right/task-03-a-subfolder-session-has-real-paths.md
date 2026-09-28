---
title: A session in a subfolder lists its rows by their real paths
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L536-L620](../../../../packages/sdk/src/changes.ts#L536-L620) - `look()`: row id, counts and line reads join `dir` to a root-relative path"
  - "[code://packages/sdk/src/changes.ts#L130-L139](../../../../packages/sdk/src/changes.ts#L130-L139) - `pathIn`, the path `stage` and `unstage` pass to git"
  - "[code://packages/sdk/src/changes.ts#L1124-L1141](../../../../packages/sdk/src/changes.ts#L1124-L1141) - `stage` and `unstage`"
---

## Objective

In a session whose folder is below the repository root, each uncommitted row's id, `after` URI and line count name the real file, and stage, unstage and discard from a row act on that file.

## Files

- `UPDATE: packages/sdk/src/changes.ts:536-620` - resolve porcelain and numstat paths against the repository root (`git rev-parse --show-toplevel`, once per look), and list only files under the session folder.
- `UPDATE: packages/sdk/src/changes.ts` - `stage`, `unstage` and `discard` pass git a path it accepts from the session folder.
- `UPDATE: packages/sdk/test/commit.test.ts` - the cases below.

## Steps

1. Whether a file outside the session folder but in the same repository is listed today is recorded in the Resume before it changes.

## Validation

- A repository with `sub/`, the session in `sub`: a new `sub/new.txt` is one row with id `file://<repo>/sub/new.txt`; stage then unstage from that row succeed; a file at the root is not listed; each fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

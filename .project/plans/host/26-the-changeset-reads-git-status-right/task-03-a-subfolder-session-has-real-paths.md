---
title: A session in a subfolder lists its rows by their real paths
status: implemented
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

- **Before the change (step 1):** with the session in `sub`, a new `sub/new.txt` was listed as `file://<repo>/sub/sub/new.txt` and a new `root.txt` at the repository root was listed too, as `file://<repo>/sub/root.txt`; staging from the first row failed with `pathspec 'root.txt' did not match any files` (the rows came in that order), and a changed file in `sub` had no line count, since numstat's root-relative path never matched.
- **Done:** `look()` in `packages/sdk/src/changes.ts` reads `git rev-parse --show-prefix` once per look; a porcelain path that does not start with the prefix is skipped, and the rest of it after the prefix is the row's path in the directory. Numstat counts are looked up by the root-relative path.
- `read` of a `before` side runs `git show HEAD:./<path>`, so the path is read from the directory, not the root; at the root this is the same file.
- `stage`, `unstage` and `discard` were not changed: they pass git the row's path relative to the directory, which git takes as a pathspec from there, and the rows now carry the real path.
- **Departure:** the plan names `git rev-parse --show-toplevel`; `--show-prefix` gives the directory's place in the repository in one call and needs no path arithmetic against a top level that may be spelled differently (a symlinked checkout). The decision, resolving against the root and listing only rows under the session folder, is what it does. Review whether this is acceptable.
- **Tests:** in `packages/sdk/test/commit.test.ts`, a new `describe('a session in a subfolder of its repository')`: "lists a new file under its real path, and nothing outside the folder" (id and `after` URI `file://<repo>/sub/new.txt`, 3 added lines, no root file), "reads a changed file's before from the commit, and counts it" (1 added line and the committed text through `read`), "stages and unstages a file from its row" (porcelain `A  sub/new.txt`, then `?? sub/new.txt`).
- **Failed first:** the listing case with the two wrong rows above; the before case with no count (`undefined` diff), and with the ids fixed but `HEAD:<path>` still in `read`, with `''` for the before text; the staging case with `Could not stage: fatal: pathspec 'root.txt' did not match any files`.
- **Not in scope, seen:** the commit operation's `git add -A` with nothing staged takes the whole repository, not only the session folder.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 1565 passed of 1565 in 108 files.

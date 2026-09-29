---
title: "The session's changes read git's status right, from any folder - implemented"
date: 2026-09-29
refs:
  - git://373253e
  - "[code://packages/sdk/src/changes.ts](../../../../packages/sdk/src/changes.ts) - `look()` and `counted()`"
---

A working-tree rename is one row under its new name, a session in a subfolder of its repository lists only its own files under their real paths and can stage, unstage and read them, and a file ending in a newline is counted by its lines.

## What was built

- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `look()` consumes a rename's source record, reads `git rev-parse --show-prefix` and keeps only rows under the session folder with their path from there; a `before` is read with `git show HEAD:./<path>`; `counted()` drops one final newline before splitting.

## Verified

- [`code://packages/sdk/test/commit.test.ts`](../../../../packages/sdk/test/commit.test.ts) - the working-tree rename, and `a session in a subfolder of its repository` (listing, before and count, stage and unstage); each failed first.
- [`code://packages/sdk/test/changes-uris.test.ts`](../../../../packages/sdk/test/changes-uris.test.ts) - `a turn's line counts`; the newline case failed first with 3 added.
- Softov on 2026-09-29: a new file staged and unstaged from the IDE and from ahpapp shows `A` and `U` in both directions.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1568 of 1568.

## Departures from the plan

- The folder's place in the repository comes from `git rev-parse --show-prefix`, not `--show-toplevel`, which needs no path arithmetic against a top level spelled differently through a symlink.
- Task 01 was dropped: the staged new file listed as `D` did not reproduce in six real Claude sessions or in Softov's check.

## Left for later

- A renamed row's `before` names `HEAD:<new path>`, which does not exist; a staged rename has the same `before`.
- The commit operation's `git add -A` with nothing staged takes the whole repository, not only the session folder.
- A change that only adds or removes the final newline counts as 0 and 0, where git counts 1 and 1.

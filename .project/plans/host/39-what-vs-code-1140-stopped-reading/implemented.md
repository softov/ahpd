---
title: The pull request pill and the worktree's files come back in VS Code 1.140 - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/worktrees.ts](../../../../packages/sdk/src/worktrees.ts)"
  - "[code://packages/sdk/src/types/worktrees.ts](../../../../packages/sdk/src/types/worktrees.ts)"
---

A session from this host shows its pull request in VS Code 1.140's Sessions window again, a worktree session gets the include files the window sends as a list, and git-ignored folders such as `node_modules` can be linked into a new worktree.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `metaOf` publishes the GitHub state under `_meta.githubData`, keyed by the working directory's `file://` URI named in `_meta.workingDirectoryKeys`, and still under `_meta.github`; `worktreeIncludeFiles` is an array that still reads a comma-separated string, on creation and from a stored session; `worktreeSymlinkFolders` is a read-only array; the host's own config paths carry a list for the two pattern keys.
- [`code://packages/sdk/src/worktrees.ts`](../../../../packages/sdk/src/worktrees.ts) - the symlink pass before the include copy: ignored folders found with `ls-files` and matched with `check-ignore --no-index` against a temporary excludes file, each linked with the reference's checks, best effort as a whole.
- [`code://packages/sdk/src/types/worktrees.ts`](../../../../packages/sdk/src/types/worktrees.ts) - `symlink` beside `include`.
- `docs/AHP.md` - the pull request row and the worktree properties.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 150 files and 2194 tests after the rebase onto usage/04, `pnpm boundary` clean.
- `packages/sdk/test/host.test.ts`: `githubData`, `workingDirectoryKeys` and `github` carry the same state.
- `packages/sdk/test/worktrees.test.ts`: an array and a string both copy `.env`; a stored string reads back as a list; root and nested `node_modules` linked and readable; a pattern naming nothing or a tracked file still makes the tree; a pattern reaching outside the repository is dropped.

## Departures from the plan

- The build agent was restarted part way, after its model settings were corrected.
- `execFile`'s async form ignores `input`, so `check-ignore --stdin` is fed through `child.stdin`.

## Left for later

- See [deferred.md](deferred.md).

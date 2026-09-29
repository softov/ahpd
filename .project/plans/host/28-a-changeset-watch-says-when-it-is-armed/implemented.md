---
title: "A changeset watch says when it is armed, and nothing between the first read and the watch is missed - implemented"
date: 2026-09-28
refs:
  - git://bde31b5
  - "[code://packages/sdk/src/types/changes.ts](../../../../packages/sdk/src/types/changes.ts) - `ChangesetWatch`"
  - "[code://packages/sdk/src/changes.ts](../../../../packages/sdk/src/changes.ts) - `gitChanges().watch` returns `ready`; `quiet()`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `startWatchingDir` re-reads on `ready`; `refreshWatched` ends quietly"
  - "[code://packages/sdk/src/git.ts](../../../../packages/sdk/src/git.ts) - `gitBranches` runs git with `quiet()`"
---

A change made right after a changeset is first read reaches the client, because the host re-reads once the git watch says it is armed.
The daemon's background git reads take no optional lock, so a person's `git add` is not refused over `index.lock`, and a re-read of a directory removed mid-way ends quietly instead of an unhandled rejection.

## What was built

- [`code://packages/sdk/src/types/changes.ts`](../../../../packages/sdk/src/types/changes.ts) - `ChangesetWatch`, the stop function with an optional `ready`.
- [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) - `gitChanges().watch` resolves `ready` once its watchers are open or it gave up; `quiet()` sets `GIT_OPTIONAL_LOCKS=0` on every git run.
- [`code://packages/sdk/src/git.ts`](../../../../packages/sdk/src/git.ts) - `gitBranches` runs its git with the same `quiet()`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `startWatchingDir` re-reads on `ready` while the same watch is held; `refreshWatched` catches a failure while telling sessions what moved.
- [`code://docs/LIBRARY.md`](../../../../docs/LIBRARY.md) - `watch` and `ready`.

## Verified

- [`code://packages/sdk/test/changes-refresh.test.ts`](../../../../packages/sdk/test/changes-refresh.test.ts) - the re-read on `ready`, a commit before the watch is armed, the branch-move case with no fixed wait, the coalesce case waiting on its source, and a directory removed mid re-read; each failed first.
- [`code://packages/sdk/test/changes-locks.test.ts`](../../../../packages/sdk/test/changes-locks.test.ts) and [`code://packages/sdk/test/git-locks.test.ts`](../../../../packages/sdk/test/git-locks.test.ts) - a `git` wrapper on `PATH` shows every run has `GIT_OPTIONAL_LOCKS=0`; without it they listed the `unset` runs.
- Load (6 copies, 2 CPUs, 2 busy loops): the changes-refresh flakes went from 2 in 24 to 0 in 48, twice.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1713 of 1713 three times at `bde31b5`, each exit 0.

## Departures from the plan

- Tasks 03, 04 and 05 were added during the build: task 01's re-read made the `index.lock` refusal and the late rejection show, and Softov chose the product fixes.

## Left for later

- Three changes-refresh cases still `settle` before asserting that something did not happen (no git with no watcher, the watch closing); an absence has no condition to wait on.

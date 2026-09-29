---
title: The git watch says when it is armed, and the host re-reads then
status: done
depends: [task-03-a-background-git-read-takes-no-lock.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/changes.ts#L276-L284](../../../../packages/sdk/src/types/changes.ts#L276-L284) - the `watch` signature"
  - "[code://packages/sdk/src/changes.ts#L1184-L1300](../../../../packages/sdk/src/changes.ts#L1184-L1300) - where the watchers are opened"
  - "[code://packages/sdk/src/host.ts#L2844-L2856](../../../../packages/sdk/src/host.ts#L2844-L2856) - `startWatchingDir`"
---

## Objective

`ChangesetSource.watch` may return a stop function carrying `ready: Promise<void>`, resolved once the source's watchers are armed. `gitChanges` resolves it after its last watcher opens, and also when it gives up (no git directory, or stopped first). The host re-reads the directory once through `refreshWatched` when `ready` resolves, unless that watch was stopped first.

## Files

- `UPDATE: packages/sdk/src/types/changes.ts` - a named type for the returned stop function with an optional `ready`, documented.
- `UPDATE: packages/sdk/src/changes.ts` - `gitChanges().watch` returns `ready`.
- `UPDATE: packages/sdk/src/host.ts` - `startWatchingDir` re-reads on `ready`.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - new cases, and the branch-move case without its fixed `settle` before the commit.
- `UPDATE: docs/` wherever `ChangesetSource.watch` is described.

## Steps

1. Tests first: a source whose `ready` resolves when the test says; the host calls `refresh` once after it and not before. A real repository where the commit comes right after the first read, with no wait, must reach the client; it fails on current code.
2. Implement the type, `gitChanges` and the host.
3. Run `changes-refresh.test.ts` under load (several copies at once pinned to 2 CPUs) before and after, and record the rates.

## Validation

- The new cases pass; the branch-move case passes under load with 0 failures.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Status:** implemented, awaiting review.
- **Done:** `ChangesetWatch` in `packages/sdk/src/types/changes.ts` (L249), above `ChangesetSource`'s doc comment: the stop function with an optional `ready`; `watch?` returns it (L294). `gitChanges().watch` in `packages/sdk/src/changes.ts` makes its arming task `ready` (L1195) and returns it on the stop function (L1312); it resolves once the last watcher is opened, or once it gave up (no git directory, stopped first, or a failure). In `packages/sdk/src/host.ts`, `startWatchingDir` calls `refreshWatched(dir)` when `ready` resolves, if the same watch is still held for that directory (L2873). `docs/LIBRARY.md` lists `watch` and describes `ready`.
- **Tests:** in `packages/sdk/test/changes-refresh.test.ts`, `counting` takes an optional `ready` and counts finished re-reads. New cases: "reads the directory again once its watch says it is armed, and not before" (L390) and "sees a commit made right after the first read, before the watch is armed" (L405). The branch-move case (L416) lost its `settle(10)` before the commit.
- **Failed first:** on the old sdk the two new cases and the branch-move case failed with `the change never arrived`, every run.
- **Load:** `changes-refresh.test.ts`, 6 copies at once pinned to 2 CPUs with 2 busy loops. Before (old code and old test file): 2 failures in 24 runs, one coalesce and one branch-move. With this task alone: 4 failures in 48 runs, all `index.lock: File exists` in "re-reads a changeset when git is changed outside the host", which task 03 removes. With tasks 01 to 04 built, `changes-refresh.test.ts` and `changes-locks.test.ts` together: 0 failures in 48 runs, twice.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared). Full `pnpm test` three times with all four tasks built: 1712 of 1712 passed in 119 files each run, every run exited 0, no unhandled error.

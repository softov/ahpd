---
title: The coalesce case waits on its counting source, not on a number of turns
status: done
depends: []
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/changes-refresh.test.ts#L123-L149](../../../../packages/sdk/test/changes-refresh.test.ts#L123-L149) - `counting`, which sees each re-read begin"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L264-L277](../../../../packages/sdk/test/changes-refresh.test.ts#L264-L277) - the coalesce case"
---

## Objective

`counting` also records each re-read that finishes. The coalesce case waits, with a wall-clock limit that fails on its own message, until two re-reads have finished and none is running, then asserts the count is more than one and at most two.

## Files

- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - `counting` gains a finished count; the coalesce case waits on it.

## Steps

1. Reproduce `expected 1 to be greater than 1` under load first.
2. Replace the `settle(20)` with the condition wait; keep both assertions as they are.
3. Check a third re-read would still fail the case: with the host's coalescing removed locally, the case must fail.

## Validation

- 0 failures under load; the case fails when coalescing is broken.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Done:** in `packages/sdk/test/changes-refresh.test.ts`, `counting` records `finished`, the re-reads that answered (a `Calls` interface names its fields). Before counting, the coalesce case waits until the watch is open and no re-read is running, then resets both counts. After the burst it waits (`waitFor`, 3 s wall clock, fails on its own message) until at least two re-reads finished and none is running. Both assertions are unchanged.
- **Reproduced first:** `expected 1 to be greater than 1` under load, 1 in 18 runs on 4 CPUs and 1 in 24 on 2 CPUs, before any change.
- **Breaks when it should:** with the host's coalescing removed locally (the `refreshing.has(dir)` early return in `refreshWatched`), the case fails with `expected 20 to be less than or equal to 2`.
- **Load after:** 0 failures of the coalesce case in 48 runs (6 copies at once, 2 CPUs, 2 busy loops).
- **Not changed:** "runs no git for tool calls or writes when no client watches the directory" still asserts `refresh` is 0 after `settle(10)`, and the watch-closing cases assert `stopped` after `settle(8)`. An absence has no condition to wait on, and the checklist item about a `settle` before a count is still open for those.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared). Full `pnpm test` three times with both plans built: 1710 of 1710 passed each run; runs 1 and 2 exited 0, run 3 exited 1 on one unhandled rejection after teardown in `packages/sdk/test/host.test.ts` (`git rev-parse` in a removed temp directory, reached through `summaryMoved`), which host/28 task 01 records.


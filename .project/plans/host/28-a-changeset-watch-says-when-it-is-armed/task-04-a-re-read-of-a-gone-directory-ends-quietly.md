---
title: A re-read whose directory is gone ends quietly
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2794-L2835](../../../../packages/sdk/src/host.ts#L2794-L2835) - `refreshWatched`, which catches `refresh` but not what runs after it"
  - "[code://packages/sdk/src/host.ts#L2101-L2122](../../../../packages/sdk/src/host.ts#L2101-L2122) - `summaryMoved`, on the path the rejection came through"
---

## Objective

A re-read of a directory that is removed while it runs rejects nothing unhandled. The promise on that path that has no catch today gets one in product code, and the re-read ends without an action.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the catch, where the rejection starts.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the case below.

## Steps

1. Find the rejection first: run 3 of the full suite ended on an unhandled `git rev-parse` in a removed temp directory, from `packages/sdk/test/host.test.ts`, reached through `summaryMoved`. Name the call that rejects.
2. Test first: a directory removed while a re-read of it runs, with an `unhandledRejection` listener that fails the case.
3. Add the catch there; no host teardown API, and no waiting in the tests.

## Validation

- The new case passes; full `pnpm test` 3 times with no unhandled rejection.
- `pnpm typecheck`, `pnpm boundary`.

## Resume

- **Status:** implemented, awaiting review.
- **The call that rejects:** `refreshWatched` in `packages/sdk/src/host.ts`, after a re-read that moved: `summaryMoved(uri)` -> `summaryOf` -> `describes` -> `metaOf` -> `options.directories.meta(dir)`. The test host's `meta` in `packages/sdk/test/host.test.ts` runs `git rev-parse --abbrev-ref HEAD` with `execFileSync`, which throws once the temp directory is gone; the throw rejects the `refreshWatched` promise, and every caller starts it with `void`, here the re-read on `ready`.
- **Done:** in `refreshWatched` (L2806), the loop that tells each session what moved (`dispatch`, `summaryMoved`, `contentMoved`) is in a `try`; a failure ends the re-read there with no action (the `catch` at L2837). No host teardown API.
- **Tests:** `packages/sdk/test/changes-refresh.test.ts`, "ends quietly a re-read whose directory is removed while it runs" (L440): a source whose `refresh` the test holds and a `directories` port whose `meta` throws for a directory that is gone; the directory is removed while the re-read is held, the re-read is let go answering "moved", and an `unhandledRejection` listener must have seen nothing once `meta` has thrown.
- **Failed first:** with the `try` taken out locally, the case fails with `expected [ …(1) ] to deeply equal []`, the rejection being `<dir> is gone`; restored, it passes. Under load the same file failed the case in all 6 copies of the round run before the catch existed.
- **Load:** 0 failures of the case in 48 runs, twice (6 copies at once, 2 CPUs, 2 busy loops).
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared). Full `pnpm test` three times with all four tasks built: 1712 of 1712 passed in 119 files each run, every run exited 0, no unhandled error; before this task, one run in three ended exit 1 on the rejection above.

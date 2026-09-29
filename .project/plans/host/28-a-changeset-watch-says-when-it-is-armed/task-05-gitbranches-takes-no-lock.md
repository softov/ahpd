---
title: gitBranches takes no optional lock either
status: done
depends: [task-03-a-background-git-read-takes-no-lock.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/git.ts#L27-L33](../../../../packages/sdk/src/git.ts#L27-L33) - `git`, the runner `gitBranches` reads through, including `status -sb --porcelain`"
  - "[code://packages/sdk/test/changes-locks.test.ts](../../../../packages/sdk/test/changes-locks.test.ts) - the wrapper-on-`PATH` test to mirror"
---

## Objective

Every git process `gitBranches` runs gets `GIT_OPTIONAL_LOCKS=0`, so its background `git status` never takes `.git/index.lock`.

## Files

- `UPDATE: packages/sdk/src/git.ts` - the runner sets the variable over the inherited environment, the way `changes.ts` does.
- `CREATE or UPDATE:` a test beside `changes-locks.test.ts`, mirroring it for `gitBranches().refresh`.

## Steps

1. Test first: the wrapper logs each run's variable; `gitBranches().refresh(dir)` must log only `0`, and fails on current code.
2. Set the variable in the runner.

## Validation

- The case fails without the change and passes with it.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Status:** implemented, awaiting review.
- **Done:** `quiet()` in `packages/sdk/src/git.ts` (L12), the inherited environment with `GIT_OPTIONAL_LOCKS=0` as in `changes.ts`; the `git` runner in `gitBranches` passes it (L38), so `rev-parse`, `status -sb --porcelain` and `remote get-url` all run with it.
- **Tests:** `packages/sdk/test/git-locks.test.ts`, "runs every git read of a directory with GIT_OPTIONAL_LOCKS=0", mirroring `changes-locks.test.ts`: a `git` wrapper first on `PATH` logs the variable per run, and `gitBranches().refresh(dir)` over a repository whose tracked file's stat no longer matches the index must include a `status` and run nothing without `0`.
- **Failed first:** on the old `git.ts` the case failed with three runs `unset`: `rev-parse --abbrev-ref HEAD`, `status -sb --porcelain`, `remote get-url origin`. It passes with the change; `git.test.ts` still passes.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared). Full `pnpm test` three times with tasks 01 to 05 built: 1713 of 1713 passed in 120 files each run, every run exited 0, no unhandled error.

---
title: A background git read takes no optional lock
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L49](../../../../packages/sdk/src/changes.ts#L49) - `git`, the helper every read in `gitChanges` goes through"
  - https://git-scm.com/docs/git#Documentation/git.txt---no-optional-locks - `GIT_OPTIONAL_LOCKS=0`, for background processes
---

## Objective

Every git process `gitChanges` runs gets `GIT_OPTIONAL_LOCKS=0` in its environment, so `git status` never takes `.git/index.lock` and a person's `git add` at the same moment does not fail.

## Files

- `UPDATE: packages/sdk/src/changes.ts` - the `git` helper sets the variable over the inherited environment.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` or a sibling - the case below.

## Steps

1. Test first: a `git add` made while the host is re-reading the directory succeeds. Reproduce the `index.lock: File exists` failure of "re-reads a changeset when git is changed outside the host" under load with task 01's re-read on `ready` in place.
2. Set the variable in the helper, and check no other git run in `@ahpd/sdk` that reads in the background bypasses it (`rg "execFile|spawn" packages/sdk/src`); report any that does rather than changing it.

## Validation

- "re-reads a changeset when git is changed outside the host": 0 failures under load, against 4 of 48 before.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Status:** implemented, awaiting review.
- **Done:** `quiet()` in `packages/sdk/src/changes.ts` (L54) is the inherited environment with `GIT_OPTIONAL_LOCKS=0`; both `git` runners there, `git` and `run`, pass it, so every git run in `gitChanges` has it.
- **Tests:** `packages/sdk/test/changes-locks.test.ts`, "runs every background git read with GIT_OPTIONAL_LOCKS=0": a `git` wrapper first on `PATH` logs the variable per run; a `refresh` and a `watch` up to `ready`, over a repository whose tracked file's stat no longer matches the index, must include a `status` and run nothing without `0`.
- **Failed first:** with `env: quiet()` taken out of both runners locally, the case fails listing six runs as `unset` (`status`, `rev-parse --show-prefix`, `diff --numstat`, `rev-parse --absolute-git-dir`, `rev-parse --git-common-dir`, `symbolic-ref`); restored, it passes.
- **Load:** "re-reads a changeset when git is changed outside the host", with task 01's re-read on `ready` in place: 4 failures in 48 runs before (`git add` refused with `index.lock: File exists`), 0 in 48 after, twice (6 copies at once, 2 CPUs, 2 busy loops).
- **Other git runs in `@ahpd/sdk` that bypass it, not changed:** `packages/sdk/src/git.ts` L30, the `gitBranches` directories port, runs `git status -sb --porcelain` in the background with no `GIT_OPTIONAL_LOCKS`, so it can still take `index.lock`. `packages/sdk/src/worktrees.ts` L11 runs `git status --porcelain` before removing a worktree, on request rather than in the background.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared). Full `pnpm test` three times with all four tasks built: 1712 of 1712 passed in 119 files each run, every run exited 0, no unhandled error.

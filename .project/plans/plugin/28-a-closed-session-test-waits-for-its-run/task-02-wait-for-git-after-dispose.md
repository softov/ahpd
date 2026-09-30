---
title: Wait for git to finish removing a worktree before removing the repository
status: done
depends: []
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/worktrees.test.ts#L535-L555](../../../../packages/sdk/test/worktrees.test.ts#L535-L555) - waits only until the worktree folder is gone"
  - "[code://packages/sdk/test/worktrees.test.ts#L25-L28](../../../../packages/sdk/test/worktrees.test.ts#L25-L28) - `afterEach` removes the root"
  - "[code://packages/sdk/src/worktrees.ts#L124-L136](../../../../packages/sdk/src/worktrees.ts#L124-L136) - `remove`: `git worktree remove`, then `git branch -d`, both writing `.git` after the folder is gone"
---

## Objective

`takes a clean worktree away with the session`, and any other case in the file that disposes a worktree session and then lets `afterEach` remove the root, waits until git has finished: the repository lists one worktree and the session's branch is gone. The wait has a wall-clock limit that fails on its own message.

## Steps

1. Reproduce `ENOTEMPTY` under load (several copies of the file at once, pinned to 2 CPUs), and record the rate.
2. Find every case in the file that disposes a worktree session before `afterEach`, and give each the wait.
3. Load rate after.

## Validation

- 0 failures under load; `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-09-29, test-only, in `packages/sdk/test/worktrees.test.ts`.
A helper, `cleared`, waits with a 4 s wall-clock limit that throws its own message until `git worktree list --porcelain` lists one worktree and `git branch --list <branch>` is empty; a probe that fails counts as not yet, because git reading `.git/worktrees` while `worktree remove` is deleting an entry fails with `failed to read .git/worktrees/<name>/commondir` or `Invalid path .../.git/worktrees`. The branch is read from the tree before disposal with `branchOf` (hoisted to file scope), `agents/tidy` for this case. Two cases dispose a clean worktree session and call it: `takes a clean worktree away with the session`, and `takes the tree down for an archived handle, keeps the branch, and puts it back`, whose own wait probed `git branch --list` unguarded and failed on that same read. The two dirty-tree cases already wait on `settled` and no removal follows. No removal retries, no timeout changes, no product change; git always finished, so there is no product fault.
Reproduction under load (copies of the file at once under `taskset -c 0,1` with busy loops): `ENOTEMPTY` did not reproduce locally, 0 in 320 file runs (10 rounds of 8 and 10 rounds of 16 with 2 busy loops, 10 rounds of 8 with 6). The race showed two ways instead: a probe after the folder wait found git not finished (branch still listed) in 24 of 80 file runs, and the archived-handle case failed on its unguarded probe 4 times in 320. After: the probe found git finished in 80 of 80, and 0 failures in 400 file runs (probe 10x8, 20x8, 10x16).
Gates: `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test` 3 times, exit 0 each (120 files, 1713 tests).

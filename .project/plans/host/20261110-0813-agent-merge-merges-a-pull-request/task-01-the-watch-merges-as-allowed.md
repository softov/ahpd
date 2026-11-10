---
title: The watch merges as allowed
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/repo/github.ts#L34](../../../../packages/sdk/src/repo/github.ts#L34) - the GitHub reads, where the merge call joins"
---

## Objective

The watch merges a ready pull request with `mergeMethod` when `mergePullRequest` is `always`, or `ifUnchanged` with no repair commit.

## Files

- `UPDATE: packages/sdk/src/host/agentmerge.ts` - the merge, from the required plan's watch.
- `UPDATE: packages/sdk/src/repo/github.ts:34` - the merge call.
- `UPDATE: packages/sdk/test` - the cases of each value.

## Steps

1. Read when VS Code's controller merges at 171e90619, and copy its conditions.
2. Merge through `gh` or a lent token with `mergeMethod`.
3. Move `ifUnchanged` to `never` for the folder when a repair turn commits.
4. End the folder's watch after a merge.

## Validation

- `always` merges, `ifUnchanged` merges only with no repair commit, and `never` does not merge.
- `pnpm typecheck`, then the sdk suite.

## Resume

- **Done so far:** the watch re-reads the pull request and merges it when `mergePullRequest` allows it and the readiness gate passes: not a draft, reviews handled, no failed or pending required check, not behind, not conflicting, `MERGEABLE` with `viewerCanMerge`, and a `mergeStateStatus` of `CLEAN`, `HAS_HOOKS` or `UNSTABLE`. `mergeMethod` resolves to the configured method only where the repository allows it, and `auto` prefers squash, then merge, then rebase. The merge pins the head commit, so a moved head is refused. `ifUnchanged` records the local HEAD when a repair turn starts and moves the folder to `never` when that commit changes, as VS Code does; selecting `ifUnchanged` again clears the baseline. A merged pull request ends the folder's watch. `repo/github.ts` merges over a lent token's REST `PUT` or `gh api -X PUT`, and answers `merged`, `refused` or `indeterminate`, where a 5xx and a missing `gh` are indeterminate.
- **Next action:** none; the plan's only task is implemented and waits for Softov's review.
- **Open questions:** none.
- **Watch out for:** a repository that requires a merge queue is not merged, and the watch stays. Four `worktrees.test.ts` cases fail under this session's `TMPDIR`, which is inside this checkout: a temporary folder meant to be outside a repository resolves to this worktree, and the failure names `/github/ahpd.worktrees/build-agents-35e67a6e` as its repository, so the cause is the test folder's location rather than this change.

Files changed by this task: `packages/sdk/src/host/agentmerge.ts`, `packages/sdk/src/repo/github.ts`, `packages/sdk/src/types/github.ts`, `packages/sdk/src/vscoderootconfig.ts`, `packages/sdk/test/agentmerge-watch.test.ts`, `packages/sdk/test/github.test.ts`, `docs/updates/v0_15.md`.


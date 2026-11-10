---
title: The watch merges as allowed
status: todo
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


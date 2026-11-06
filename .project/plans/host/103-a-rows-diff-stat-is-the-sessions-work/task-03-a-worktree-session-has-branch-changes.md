---
title: A worktree session has Branch Changes
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/changesets.ts#L390](../../../../packages/sdk/src/host/changesets.ts#L390) - `worktreeOf(uri)?.base`, the base branch"
  - "[code://packages/sdk/src/sessions/changes.ts#L1057-L1102](../../../../packages/sdk/src/sessions/changes.ts#L1057-L1102) - `scopes`, where the new scope goes"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/changesetUri.ts#L63-L64 - the label \"Branch Changes\""
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostGitService.ts#L647-L690 - the merge base that Branch Changes is anchored on"
---

## Objective

A session with `isolation: worktree` offers a `branch` scope, Branch Changes.
It is the diff from the merge base of the base branch to the working tree, with new files counted.

## Files

- `UPDATE: packages/sdk/src/sessions/changes.ts:1057-1102` - a `branch` scope with `changeKind: 'branch'` and the label \"Branch Changes\".
- `UPDATE: packages/sdk/src/sessions/changes.ts` - `state` and `branchSummary` for `branch`, from `git merge-base` and `git diff --numstat`.
- `UPDATE: packages/sdk/src/types/changes.ts:321-345` - `scopes` takes the base branch, and `ChangesetSource` gets `branchSummary`.
- `UPDATE: packages/sdk/src/host/changesets.ts` - pass `worktreeOf(uri)?.base` to `scopes`.
- `CREATE: packages/sdk/test/changes-branch.test.ts` - the cases in Validation.

## Steps

1. Write the tests first.
2. Offer `branch` only when the session has a worktree with a base branch.
3. Find the merge base of the base branch and `HEAD` with `git merge-base`.
4. Diff the merge base to the working tree, and count untracked files in full.
5. Write `branchSummary` from the same diff.
6. Set this task and the plan row to `implemented`.

## Validation

- A test: a worktree with two commits and one uncommitted file shows all three in Branch Changes.
- A test: a session with `isolation: folder` has no `branch` scope.
- `pnpm -s typecheck` and the sdk vitest suite pass.

## Resume

- **Done so far:** Built 2026-10-16.
  `changes.ts` has `mergeBaseOf`, which finds the fork point.
  It prefers `refs/remotes/origin/<base>`, then the local base, then `HEAD`, then the empty tree.
  `branchLook` reads `git diff --numstat` and `--name-status` against that commit, plus the `??` files from `git status`.
  The `branch` scope is offered when a base is passed and git answers for the directory.
  `branchSummary(dir, base)` is on the port.
  `read` takes a 40-hex authority, so a row's `before` side is read lazily from that commit.
  `host/changesets.ts` passes `worktreeOf(uri)?.base` into `scopes` through a new `baseOf`, which `operationContext` also uses.
  `changesetAt` carries the base, so `state` gets it in `snapshots.ts` and `contentMoved`.
  5 tests are in `test/changes-branch.test.ts`.
  The gates pass, and the sdk suite passes with 2994 tests.
- **Next action:** [task-04-a-rows-changes-are-the-sessions-summary.md](task-04-a-rows-changes-are-the-sessions-summary.md).
- **Open questions:** none of the task's own.
  Three points it did not decide are answered under Watch out for.
- **Watch out for:** The task was silent on three points, and a choice was made for each.
  (1) `state` takes the base as a fourth argument, because the source cannot read a session's base off the directory.
  The Files list names only `scopes`.
  (2) `branchSummary?(dir, base?)` has no session parameter, because a worktree holds one session.
  (3) The branch scope offers no operations and no REVERT, because every verb this source has targets the working tree or a captured turn.
  The scope is `reviewable`, which the task also did not decide.
  The scope sits after `uncommitted` and before `session`.
  Restore `packages/sdk/test/fixtures/wire.jsonl` with `git checkout -- packages/sdk/test/fixtures/wire.jsonl`; the suite dirties it.

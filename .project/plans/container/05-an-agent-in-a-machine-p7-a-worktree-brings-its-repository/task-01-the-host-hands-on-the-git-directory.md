---
title: The host knows a folder's git directory and hands it on
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/worktrees.ts#L58-L72](../../../../packages/sdk/src/worktrees.ts#L58-L72) - `gitWorktrees`, `repository` at L60-L64"
  - "[code://packages/sdk/src/host.ts#L5304-L5334](../../../../packages/sdk/src/host.ts#L5304-L5334) - `placedIn`; the maker call at L5323-L5331"
  - "[code://packages/sdk/src/types/computers.ts#L84-L85](../../../../packages/sdk/src/types/computers.ts#L84-L85) - `folder`"
  - "[code://packages/sdk/src/types/worktrees.ts#L73-L112](../../../../packages/sdk/src/types/worktrees.ts#L73-L112) - the `Worktrees` port"
---

## Objective

`Worktrees.gitDir(dir)` answers the absolute common git directory, or nothing outside a repository, and `placedIn` passes it as `gitDir` when it is not inside the folder.

## Files

- `UPDATE: packages/sdk/src/types/worktrees.ts` - `gitDir?(dir)`, optional so other ports need not have it.
- `UPDATE: packages/sdk/src/worktrees.ts` - the git call.
- `UPDATE: packages/sdk/src/types/computers.ts:84-85` - `gitDir?` beside `folder`.
- `UPDATE: packages/sdk/src/host.ts:5304-5334` - ask and pass, beside `folder` in the maker call, after `owner`, `team` and `project`.
- `UPDATE: packages/sdk/test/worktrees.test.ts` - the git call.
- `UPDATE: packages/sdk/test/host.test.ts` - what `placedIn` passes.

## Steps

1. `git rev-parse --path-format=absolute --git-common-dir` in `dir`, five-second limit like `repository`.
2. Pass only when it does not start with `folder + '/'`.

## Validation

- A real temporary repository with a linked worktree answers the main `.git`.
- The host passes `gitDir` for a worktree session and not for a session at the repository root.

## Resume

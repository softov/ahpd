---
title: The host knows a folder's git directory and hands it on
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/worktrees.ts#L47-L60](../../../../packages/sdk/src/worktrees.ts#L47-L60) - `gitWorktrees`"
  - "[code://packages/sdk/src/host.ts#L4093-L4117](../../../../packages/sdk/src/host.ts#L4093-L4117) - `placedIn`"
  - "[code://packages/sdk/src/types/computers.ts#L83-L84](../../../../packages/sdk/src/types/computers.ts#L83-L84) - `folder`"
---

## Objective

`Worktrees.gitDir(dir)` answers the absolute common git directory, or nothing outside a repository, and `placedIn` passes it as `gitDir` when it is not inside the folder.

## Files

- `UPDATE: packages/sdk/src/types/worktrees.ts` - `gitDir?(dir)`, optional so other ports need not have it.
- `UPDATE: packages/sdk/src/worktrees.ts` - the git call.
- `UPDATE: packages/sdk/src/types/computers.ts:83-84` - `gitDir?` beside `folder`.
- `UPDATE: packages/sdk/src/host.ts:4093-4117` - ask and pass.
- `UPDATE: packages/sdk/test/` the worktrees and computers tests.

## Steps

1. `git rev-parse --path-format=absolute --git-common-dir` in `dir`, five-second limit like `repository`.
2. Pass only when it does not start with `folder + '/'`.

## Validation

- A real temporary repository with a linked worktree answers the main `.git`.
- The host passes `gitDir` for a worktree session and not for a session at the repository root.

## Resume

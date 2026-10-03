---
title: The host knows a folder's git directory and hands it on
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/worktrees.ts#L58-L72](../../../../packages/sdk/src/worktrees.ts#L58-L72) - `gitWorktrees`, `repository` at L60-L64"
  - "[code://packages/sdk/src/host.ts#L5372-L5402](../../../../packages/sdk/src/host.ts#L5372-L5402) - `placedIn`; the maker call at L5391-L5398"
  - "[code://packages/sdk/src/types/computers.ts#L84-L85](../../../../packages/sdk/src/types/computers.ts#L84-L85) - `folder`"
  - "[code://packages/sdk/src/types/worktrees.ts#L73-L112](../../../../packages/sdk/src/types/worktrees.ts#L73-L112) - the `Worktrees` port"
---

## Objective

`Worktrees.gitDir(dir)` answers the absolute common git directory and the repository's root, or nothing outside a repository, and `placedIn` passes them as `gitDir` and `repository` when they are not inside the folder.

## Files

- `UPDATE: packages/sdk/src/types/worktrees.ts` - `gitDir?(dir)`, optional so other ports need not have it.
- `UPDATE: packages/sdk/src/worktrees.ts` - the git call.
- `UPDATE: packages/sdk/src/types/computers.ts:84-85` - `gitDir?` and `repository?` beside `folder`.
- `UPDATE: packages/sdk/src/host.ts:5372-5402` - ask and pass, beside `folder` in the maker call, after `owner`, `team` and `project`.
- `UPDATE: packages/sdk/test/worktrees.test.ts` - the git call.
- `UPDATE: packages/sdk/test/host.test.ts` - what `placedIn` passes.

## Steps

1. `git rev-parse --path-format=absolute --git-common-dir --show-toplevel` in `dir`, five-second limit like `repository`.
2. Pass `gitDir` only when it does not start with `folder + '/'`; pass `repository` only when it is not `folder` itself, so a session in a subfolder names the root to mount.
3. A `rev-parse` that fails or times out passes neither and logs one line naming the folder and git's reason, so a session outside a repository is quiet only when git said so.
4. For a `devcontainer://<folder>` source the same call is made for that folder, the workspace the Dev Container CLI mounts, and the answer is passed the same way.

## Validation

- A real temporary repository with a linked worktree answers the main `.git`.
- The host passes `gitDir` for a worktree session and not for a session at the repository root; it passes `repository` for a session in `repo/src`.
- A `rev-parse` that fails (a folder git refuses) logs one line and passes neither.

## Resume

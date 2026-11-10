---
title: create_session works with no git
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L506-L585](../../../../packages/sdk/src/tools/session.ts#L506-L585) - `create_session`"
---

## Objective

`create_session` with `worktree` left out makes the session in a folder that is not a git repository, as VS Code does.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:506-585` - the isolation picked when `worktree` is left out.
- `UPDATE: packages/sdk/test` - a case in a folder with no git.

## Steps

1. Pick the folder isolation when the input has no `worktree` and the folder has no git.
2. Keep the refusal when `worktree: true` names a folder with no git.

## Validation

- A folder with no git and no `worktree` makes a session there.
- The tool refuses `worktree: true` in that folder.
- `pnpm typecheck`, then the sdk suite.

## Resume


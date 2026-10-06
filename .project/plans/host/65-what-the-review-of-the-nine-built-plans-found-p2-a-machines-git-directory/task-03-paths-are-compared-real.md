---
title: Paths are compared real
status: todo
depends: [task-01-the-git-directory-is-read-only-but-what-a-commit-writes.md]
layer: "computer, sdk"
refs:
  - "[code://packages/computer/src/gitdir.ts#L160-L181](../../../../packages/computer/src/gitdir.ts#L160-L181) - `gitInside` compares strings as spelled"
  - "[code://packages/sdk/src/host/machines.ts#L184-L186](../../../../packages/sdk/src/host/machines.ts#L184-L186) - `atRoot` matches through `realpath` and passes no root"
  - "[code://packages/computer/src/plugin.ts#L926-L930](../../../../packages/computer/src/plugin.ts#L926-L930) - `withGit` takes the folder's spelling as the tree"
---

## Objective

Whether a git directory is inside the tree is answered on real paths, and every bind lands at the path the machine mounts the tree at, so a session whose folder is a symbolic link gets the same guard as one that is not.

## Files

- `UPDATE: packages/computer/src/gitdir.ts:160-181` - `gitInside`, `guardedMounts` and `runsAsHost` compare `realpath`s and translate a bind into the tree's spelling; today a root session at `/link` (a link to `/real`) has `gitDir` `/real/.git` from `rev-parse`, `machines.ts:185` drops the root because `realpath('/link')` matches, and `gitInside('/real/.git', '/link')` is false, so the binds land on `/real/.git` while the machine's `/link/.git` is writable.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the case below.

## Steps

1. Failing case first: a repository at `<tmp>/real`, a link `<tmp>/link` to it, a root session at the link. Today the binds are under `<tmp>/real/.git`; after, they are under `<tmp>/link/.git`, the path the folder is mounted at.
2. The same for a worktree reached through a link.

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-disposable.test.ts`.

## Resume

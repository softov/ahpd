---
title: A machine mounts the git directory beside its folder
status: todo
depends: [task-01-the-host-hands-on-the-git-directory.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L730](../../../../packages/computer/src/runtime.ts#L730) - the folder mount"
  - "[code://packages/computer/src/runtime.ts#L152-L159](../../../../packages/computer/src/runtime.ts#L152-L159) - `MachineSpec.folder`"
  - "[code://packages/computer/src/plugin.ts#L734-L740](../../../../packages/computer/src/plugin.ts#L734-L740) - where the folder is written into a disposable profile"
---

## Objective

A machine given `folder` and `gitDir` mounts both at their own paths, read-write, under the same profile gate as the folder, on the Docker and the dev container routes.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.gitDir` and the flag.
- `UPDATE: packages/computer/src/plugin.ts` - carried with the folder.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`.

## Steps

1. Add the mount next to the folder's.
2. A profile that refuses the folder refuses the git directory with it.

## Validation

- A disposable machine for a worktree session has both mounts in the fake's argv.
- By hand: `git commit` inside, seen on the host.

## Resume

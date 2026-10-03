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
A machine given `repository` (a session in a subfolder) mounts the repository root in place of the folder, so the rest of the tree is not missing to `git commit -a` and the index is the repository's own; the session still works in its folder.
How git inside runs against files owned by the host's user waits on the plan's open question.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.gitDir`, `MachineSpec.repository` and the flags on the Docker route; on the dev container route both go as extra binds through `overrideOf`, the override config container/03 task 09 writes, which is where container/03 routes every read-only and extra mount.
- `UPDATE: packages/computer/src/plugin.ts` - carried with the folder.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`.

## Steps

1. Add the mount next to the folder's; with `repository`, mount the root at its own path instead of the folder.
2. A profile that refuses the folder refuses the git directory and the root with it.
3. On the dev container route, `gitDir` is the one `placedIn` asked for the `devcontainer://` folder (task 01 step 4), mounted through `overrideOf`.

## Validation

- A disposable machine for a worktree session has both mounts in the fake's argv.
- A session in `repo/src` mounts `repo` and not `repo/src` alone.
- A dev container for a worktree folder has the git directory in the override config's mounts.
- By hand: `git commit` inside, seen on the host.

## Resume

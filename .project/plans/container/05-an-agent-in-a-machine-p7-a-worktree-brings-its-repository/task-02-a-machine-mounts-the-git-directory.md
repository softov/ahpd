---
title: A machine mounts the git directory beside its folder
status: done
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
When `gitDir` is mounted, the machine's commands run as the host user's uid:gid, so git accepts the repository as its owner's and every file it writes stays the host user's, with no chown step.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.gitDir`, `MachineSpec.repository` and the flags on the Docker route; on the dev container route both go as extra binds through `overrideOf`, the override config container/03 task 09 writes, which is where container/03 routes every read-only and extra mount.
- `UPDATE: packages/computer/src/plugin.ts` - carried with the folder; the exec answer in `reach` adds `--user <uid>:<gid>` for a machine with a git directory.
- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.user`, the host user's `<uid>:<gid>` from `process.getuid()` and `process.getgid()`, set when `gitDir` is; `docker run --user` on the Docker route, and the machine labelled `ahpd.user=<uid>:<gid>` so an exec after a restart reads it back.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`.

## Steps

1. Add the mount next to the folder's; with `repository`, mount the root at its own path instead of the folder.
2. A profile that refuses the folder refuses the git directory and the root with it.
3. On the dev container route, `gitDir` is the one `placedIn` asked for the `devcontainer://` folder (task 01 step 4), mounted through `overrideOf`.
4. When `gitDir` is set, `MachineSpec.user` is the host user's `<uid>:<gid>`: the Docker route adds `--user <uid>:<gid>` to `docker run`, and every `docker exec` into the machine, on either route, adds `--user` read from the machine's `ahpd.user` label (on a dev container, the record beside the config), so a command started before or after a restart runs as the host user.
5. A machine without a git directory keeps its image's user, as today.

## Validation

Write each case first and see it fail against today's code, then build until it passes.

- A disposable machine for a worktree session has both mounts in the fake's argv.
- The same machine's `docker run` and every `docker exec` in the fake's argv carry `--user <uid>:<gid>` with the test process's own ids, and the machine is labelled `ahpd.user` with them.
- A machine without a git directory has no `--user` in its `run` or its `exec` argv.
- After the plugin is loaded again, an exec into the worktree machine still carries `--user` read from its label.
- A dev container for a worktree folder passes `--user <uid>:<gid>` on each `docker exec`.
- A session in `repo/src` mounts `repo` and not `repo/src` alone.
- A dev container for a worktree folder has the git directory in the override config's mounts.
- By hand: `git commit` inside, seen on the host, with no dubious-ownership refusal, and every new object under the host's `.git` owned by the host user.

## Resume

- Built 2026-10-06 on 08f046b.
- `MachineSpec.gitDir`, `repository` and `user`; the plugin's `withGit` carries them only where the folder reaches the machine (`sessionFolder` on a disposable profile, always on a `devcontainer://` source) and sets `user` to the host's `<uid>:<gid>` whenever `gitDir` is set.
- Docker route: the root replaces the folder in the same-path `-v`, the git directory follows it, and `run` carries `--user <uid>:<gid>` and `--label ahpd.user=<uid>:<gid>`; the plugin's `how` and the runtime's `exec` add `--user` read from the label.
- Dev container route: the binds go into the override config's `mounts`, `workspaceMount` and `workspaceFolder` put the tree at its own path, the labels go in `runArgs`, and `reachOf` takes the user from `ahpd.user`, so the probe, `how`, `exec` and the relay run as the host user.
- A state volume of such a machine is seeded owned by the host user's ids.
- Tests: `computer-disposable.test.ts` (4) and `computer-devcontainer.test.ts` (1); the machine without a git directory and the profile without `sessionFolder` are guards that passed already.
- Fix turn 2026-10-06: `Profile.gitGuard` (`bind` default, `open`) in the schema, the check that names the field, `profilesOf` and `MachineSpec`; a git directory inside the tree gets no mount of its own; under `bind` the machine always runs as the host user, under `open` only where the git directory is mounted on its own. Tests: a root session under `bind` and under `open`, a worktree under `open`, and the option check.

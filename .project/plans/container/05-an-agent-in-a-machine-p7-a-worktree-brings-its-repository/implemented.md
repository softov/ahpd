---
title: A worktree reaches its machine with the repository it belongs to - implemented
date: 2026-10-06
refs:
  - git://08f046b
  - "[code://packages/sdk/src/types/worktrees.ts](../../../../packages/sdk/src/types/worktrees.ts) - `GitDir` and `Worktrees.gitDir`"
  - "[code://packages/sdk/src/repo/worktrees.ts](../../../../packages/sdk/src/repo/worktrees.ts) - the `rev-parse` call"
  - "[code://packages/sdk/src/repo/hardened.ts](../../../../packages/sdk/src/repo/hardened.ts) - `gitArgv`, the flags every host git run is given"
  - "[code://packages/sdk/src/types/computers.ts](../../../../packages/sdk/src/types/computers.ts) - `gitDir` and `repository` on `MachineSource`"
  - "[code://packages/sdk/src/host/machines.ts](../../../../packages/sdk/src/host/machines.ts) - `repositoryOf` and `placedIn`"
  - "[code://packages/computer/src/gitdir.ts](../../../../packages/computer/src/gitdir.ts) - `gitMounts`, `guardedMounts`, `runsAsHost`, the labels, `hostUser` and `releaseLock`"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - the binds and `--user` on both routes, the user on `exec`, and the lock on `remove`"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `withGit` behind the folder's gate, `gitGuard` in the profile schema and checks, and `--user` on `how`"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - `reachOf` taking the user from `ahpd.user`"
---

A session whose folder is a linked worktree, or a folder below a repository's root, gets the repository's common git directory mounted read-write at its own path beside the folder, and a subfolder session gets the tree's root mounted in place of the folder.
Under a profile's `gitGuard`, `bind` by default, wherever a git directory is in the machine - beside the folder or inside it, a root session among them - `hooks/`, `config`, `worktrees/` but the session's own entry, that entry's `config.worktree`, `commondir` and `gitdir`, `modules/` and the worktree's `.git` file are read-only, and the machine runs `docker run` and every `docker exec` as the host user's uid:gid, read back from its `ahpd.user` label, on Docker and on a dev container.
`gitGuard: "open"` is the behaviour before: no read-only binds, a worktree's git directory mounted read-write, and a root session's `.git` writable as the image's user.
The session's own `index.lock` is removed once the container is gone, and every git command ahpd runs on the host turns off the fsmonitor and submodule recursion.

## What was built

- [`code://packages/sdk/src/types/worktrees.ts`](../../../../packages/sdk/src/types/worktrees.ts) and [`code://packages/sdk/src/repo/worktrees.ts`](../../../../packages/sdk/src/repo/worktrees.ts) - `Worktrees.gitDir?(dir)` answering `{ gitDir, repository }` from `rev-parse --path-format=absolute --git-common-dir --show-toplevel` under five seconds, nothing outside a repository, and a rejection in git's words otherwise.
- [`code://packages/sdk/src/host/machines.ts`](../../../../packages/sdk/src/host/machines.ts) - `repositoryOf`, asked for the `devcontainer://` folder or the session's folder, passing `gitDir` whenever there is one, inside the folder too, and `repository` only when it is not the folder, and logging one line when git refuses.
- [`code://packages/sdk/src/repo/hardened.ts`](../../../../packages/sdk/src/repo/hardened.ts) - `gitArgv`: `-c core.fsmonitor= -c submodule.recurse=false -C <dir>`, and `--ignore-submodules` after `status`, `diff`, `diff-index` and `diff-files`; the runners in `changes.ts`, `repo/git.ts` and `repo/worktrees.ts`, the only places ahpd runs git, all go through it.
- [`code://packages/computer/src/gitdir.ts`](../../../../packages/computer/src/gitdir.ts) - the session's entry read from the tree's `.git` file, the missing `hooks/`, `worktrees/`, `modules/` and `config.worktree` made empty on the host, a symbolic link among the sources refused, the binds in the plan's order with the git directory's own mount left out where the tree holds it, `guardedMounts` and `runsAsHost` for the two guards, `ahpd.user` and `ahpd.worktree`, and `releaseLock`.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `MachineSpec.gitDir`, `repository`, `gitGuard` and `user`; on Docker the root in place of the folder, the binds as `-v`, `--user` and the labels; on a dev container the binds in the override's `mounts`, the tree at its own path as `workspaceMount` and `workspaceFolder`, and the labels in `runArgs`; `--user` on `exec`; the lock released after `rm -f`; state volumes seeded for the host user's ids.
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) and [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - `Profile.gitGuard`, its schema enum, its check refusing any other value by name, and `profilesOf`; `withGit`, giving the git directory, the root, the guard and the host user only where the folder reaches the machine; `--user` from the label on the Docker answer of `how`.
- [`code://packages/computer/src/devcontainer.ts`](../../../../packages/computer/src/devcontainer.ts) - `reachOf` puts `ahpd.user` first, so the probe, `how`, `exec` and the relay run as that user.
- `test/fixtures/docker.mjs` reads `--user` on `exec`; `test/fixtures/devcontainer.mjs` mounts a `workspaceMount`'s own source.
- `docs/COMPUTER.md` - `gitGuard` in the Profiles table, a paragraph under Disposable machines, and under Security the mounted git directory and a note to review a session's changes before running git on them.

## Verified

- `packages/sdk/test/worktrees.test.ts` (4 new), `packages/sdk/test/host-files.test.ts` (5 new), `packages/sdk/test/git-hardened.test.ts` (4, new file), `packages/computer/test/computer-disposable.test.ts` (11 new), `packages/computer/test/computer-devcontainer.test.ts` (1 new) and `packages/computer/test/computer-options.test.ts` (1 new).
- Each failed before its change, except three guards that passed already: a machine without a git directory keeping its image's user, a profile without `sessionFolder` bringing nothing, and a root session under `open` keeping today's flags.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (215 files, 3017 tests) and `pnpm build` green.
- Docker 29.6.2 on 2026-10-06, through the built runtime with `node:22`, a throwaway repository with a worktree and a `modules/lib/config`: writing `hooks/pre-commit`, `config`, `config.worktree`, `modules/lib/config`, the entry's `commondir` and `gitdir`, the worktree's `.git` file and a new entry under `worktrees/`, `git config core.hooksPath` and `git config --worktree core.fsmonitor` all failed; `git commit` worked, the commit was on `work` on the host, every file written was owned by the host's `1000:1000`, and the `index.lock` left in the entry was gone after the remove.
- `@devcontainers/cli` 0.89.0 on the same day, `devcontainer://` route: commands ran as `1000:1000`, writing `hooks/`, `config`, `commondir` and the `.git` file failed, and `git commit` worked and showed on the host.
- A root session on Docker, rechecked after the fix turn: under `bind`, writing `hooks/pre-commit` and `config` and making `modules/x/config` failed, `modules/` had been made on the host, `git commit` worked as `1000:1000`; under `open`, `config` and `modules/` were writable and git, as the image's root, refused the host user's repository as dubious ownership, which is the behaviour before.
- Nothing was left behind by any check.

## Departures from the plan

- The lock is released in the runtime's `remove`, read from the machine's `ahpd.worktree` label, rather than in the plugin, so every road a machine is removed by releases it, after a restart too; p6 put its volume removal there for the same reason.
- On a dev container the user is the `ahpd.user` label in `runArgs`, not a record beside the config: the label is on exactly the container the override made, which is the one with the git directory mounted, and an existing container `up` finds has neither.
- On a dev container with a git directory the override also sets `workspaceMount` and `workspaceFolder` to the tree at its own path, over the definition's own, because the worktree's `.git` file and the binds are at host paths and the CLI would otherwise mount the tree under `/workspaces/<name>`.
- `worktrees/` is made empty on the host when missing, like `hooks/` and `modules/`, so its bind always has a source.
- A machine is refused, with a sentence, when `commondir` or `gitdir` is missing, or when the tree's `.git` file names anything but an entry directly under `<gitDir>/worktrees`; a symbolic link among the sources is the decided row.
- Under `open`, a worktree or subfolder session still runs as the host user, since its git directory is mounted on its own and the earlier row runs a machine as the host user whenever it is.
- A dev container's `docker exec` carries the user as `-u`, as `execArgv` already spells it.
- The dev container case is in `computer-devcontainer.test.ts`, which holds that route's fixtures.
- `plans/index.md` is not updated, as this build was told not to edit it.

## Open questions

- None.

## Left for later

- Known limit: a uid with no passwd entry in the image has `HOME=/`, so an agent writing under `~` needs its config directory set, as the presets do.
- ahpd's own `git worktree add` and the changes source's `commit` still run the repository's hooks on the host, as a person's would; only the fsmonitor and submodule recursion are turned off.
- The checklist's by-hand lines are checked here against Docker; Softov's own run is not.
- The tasks stay `implemented` until Softov reviews them.

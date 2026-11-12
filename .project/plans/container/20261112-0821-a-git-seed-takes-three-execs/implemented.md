---
title: A git seed takes three execs - implemented
date: 2026-11-12
refs:
  - git://822b9aea0 - the commit the work starts from
  - "[code://packages/computer/src/machinegit.ts](../../../../packages/computer/src/machinegit.ts) - `gitConfigOf` and `configured`"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - `seedGit` and `idsOfMachine`"
  - "[code://packages/computer/src/vm.ts](../../../../packages/computer/src/vm.ts) - the VM seed, which calls `configured`"
  - "[code://packages/computer/test/computer-disposable.test.ts](../../../../packages/computer/test/computer-disposable.test.ts) - the cases for the seed and the one `id`"
  - "[code://packages/computer/test/fixtures/docker.mjs](../../../../packages/computer/test/fixtures/docker.mjs) - the scripted `id`"
---

Task-01 is implemented: a machine's git seed makes three `git` commands and one `docker cp`, and its `config` and `HEAD` arrive without a shell.

## What was built

- [`code://packages/computer/src/machinegit.ts`](../../../../packages/computer/src/machinegit.ts) - `gitConfigOf` writes the `config` text with `core.repositoryformatversion`, `core.filemode`, `core.bare`, `core.autocrlf` and the identity. `configured` writes the identity, the two reading values and `symbolic-ref HEAD` as commands. `checkedOut` keeps `update-ref` and `reset`.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `seedGit` writes one `cp -a` archive holding `config`, `HEAD` (a branch only) and `objects/info/alternates` when the host's objects are mounted. `idsOfMachine` reads `uid=` and `gid=` from one `id`.
- [`code://packages/computer/src/vm.ts`](../../../../packages/computer/src/vm.ts) - the VM seed calls `configured` before `checkedOut`, with the same command order as before.
- [`code://packages/computer/test/computer-disposable.test.ts`](../../../../packages/computer/test/computer-disposable.test.ts) - the copy seed is counted at three `git` execs and one `cp -a`.
  Its `config` is read back with `git config --file ... --get` and compared to the host's, and `HEAD` is `ref: refs/heads/main`.
  A direct `dockerRuntime` case with `user: "node"` checks one `id`, the `chown`, and the archive's owners.
- [`code://packages/computer/test/fixtures/docker.mjs`](../../../../packages/computer/test/fixtures/docker.mjs) - a bare `id` answers `uid=<n> gid=<n>`; `-u` and `-g` keep their single numbers.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` in the worktree prints nothing.
- The computer suite at review, 2026-11-12: 600 passed, 1 skipped, 2 failed. `computer-git-fetch.test.ts` passes on real Docker.
- The two failures are timeouts in `computer-devcontainer.test.ts` and `computer-libvirt.test.ts`. The devcontainer case fails on `main` too, and libvirt passes alone.
- The written `config` was checked against `git init --bare`: it holds `repositoryformatversion`, `filemode` and `bare`, and no `logallrefupdates`, which a bare init does not write.
- The alternates entry is `objects/info/alternates`: the archive lands in the git directory itself, not in its `objects/`.

## Departures from the plan

- The plan names `runtime.ts` and `machinegit.ts`. `checkedOut` is shared with the VM seed in `vm.ts`, so the four `config` calls and `symbolic-ref` became an exported `configured`, which `vm.ts` calls before `checkedOut`. A VM has no archive to write through, and without the commands it would seed on git's default `HEAD` with no identity.
- `gitConfigOf` lives in `machinegit.ts` beside `configured`, not in `runtime.ts`. Step 1 of the task names the function, not its file.

## Left for later

- The computer suite and the no-shell image check wait for Softov's run. Nothing was deferred.

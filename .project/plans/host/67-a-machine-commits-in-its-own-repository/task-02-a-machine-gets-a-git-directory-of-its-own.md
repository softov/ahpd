---
title: A machine gets a git directory of its own, and nothing of the host's is writable
status: done
depends: [task-01-gitguard-is-fetch-or-open.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/gitdir.ts](../../../../packages/computer/src/gitdir.ts) - the allowlist, `mainCheckoutBinds`, `releaseLock`, `MACHINE_WORKTREE` go; `ownOf`, `spellingOf`, `notLinked` stay"
  - "[code://packages/computer/src/runtime.ts#L2026-L2099](../../../../packages/computer/src/runtime.ts#L2026-L2099) - the Docker route's mounts"
  - "[code://packages/computer/src/runtime.ts#L1108-L1122](../../../../packages/computer/src/runtime.ts#L1108-L1122) - the dev container route's mounts and labels"
  - "[code://packages/computer/src/runtime.ts#L1919-L1921](../../../../packages/computer/src/runtime.ts#L1919-L1921) - the dev container route asks `guardedMounts`"
  - "[code://packages/computer/src/runtime.ts#L2164-L2172](../../../../packages/computer/src/runtime.ts#L2164-L2172) - `remove` and `releaseLock`"
---

## Objective

Under `fetch`, a machine with a repository mounts the host's `<gitDir>/objects` read-only at its own path and a volume `ahpd-git-<machine>` as the tree's git directory, and nothing else of the host's git directory.
A host git directory holding a symbolic link, or whose objects have alternates, refuses the machine before anything is made.

## Files

- `UPDATE: packages/computer/src/gitdir.ts` - `gitMounts` answers `{ binds, volume, gitfile? }`: the read-only `objects/` bind; the volume's target, `<root>/.git` where the tree's `.git` is a directory, else `/opt/ahpd/git`; and for a linked worktree a gitfile reading `gitdir: /opt/ahpd/git`, made by ahpd in its own state directory and bound read-only over `<root>/.git`. Delete the allowlist, `mainCheckoutBinds`, `releaseLock` and `MACHINE_WORKTREE`.
- `UPDATE: packages/computer/src/gitdir.ts` - `linksIn(gitDir, entry)`: every symbolic link in the git directory's root, under `logs/`, `refs/` and `objects/`, and in the session's worktree entry, with what each names.
- `UPDATE: packages/computer/src/runtime.ts:2026-2099` - the Docker route mounts what `gitMounts` answers, adds `-v ahpd-git-<machine>:<target>`, and labels the machine `ahpd.git=fetch`; `open` labels `ahpd.git=open` and keeps its one writable bind.
- `UPDATE: packages/computer/src/runtime.ts:1108-1122` and `1919-1921` - the dev container route the same, through the override's mounts.
- `UPDATE: packages/computer/src/runtime.ts:2164-2172` - `remove` takes the git volume with the container, after task 04's `bringBack`; no lock to release.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the mount cases.
- `CREATE: packages/computer/test/computer-git-fetch.test.ts` - real Docker, skipped without it.

## Steps

1. Failing case first, real Docker: a machine on a linked worktree runs `ln -sf /tmp/x <gitDir>/logs/HEAD`; today it succeeds.
2. Rewrite `gitMounts` and the two routes; a machine never gets a bind of the host's git directory but `objects/` read-only.
3. `linksIn` before anything is made: one link refuses with `<gitDir> holds <path>, a symbolic link to <target>, which git never makes; remove it and start the session again`.
4. A non-empty `<gitDir>/objects/info/alternates` refuses with a sentence naming it.
5. Keep `ownOf` and `spellingOf`: the volume and the gitfile land at the spelling the machine mounts the tree at.

## Validation

- `computer-disposable.test.ts`: a worktree session's mounts are the root, `objects/` read-only, the gitfile read-only over `<root>/.git` and the volume at `/opt/ahpd/git`; a main checkout's are the root, `objects/` read-only and the volume at `<root>/.git`; no other path under the git directory; a link under `logs/` refuses naming it and makes nothing; alternates refuse; `open` is unchanged.
- `computer-git-fetch.test.ts`: in the machine, `ln -sf` over `logs/HEAD` and `touch <gitDir>/config` fail on both kinds of tree, and `<root>/.git` cannot be replaced.
- `npx tsc -b` clean; `npx vitest run packages/computer` passes.

## Resume

- **Implemented** 2026-10-06 on `build/agents/c016a0e4`.
- `gitdir.ts`: `MACHINE_WORKTREE`, the allowlist, `mainCheckoutBinds` and `releaseLock` are gone; `MACHINE_GIT` (`ahpd.git`), `MACHINE_GIT_TARGET` (`/opt/ahpd/git`), `GITFILE` (`computers.gitfile`) and `gitVolumeOf` are new. `gitMounts` answers `{ binds, volume, gitfile? }`: the read-only `objects/` bind, the volume at `<root>/.git` where that is a directory and at `MACHINE_GIT_TARGET` with the gitfile bound read-only over `<root>/.git` where it is a file. `linksIn` walks the git directory's root, `logs/`, `refs/`, `objects/` and the session's worktree entry, naming every link and its target; a non-empty `objects/info/alternates` is refused naming it and its first line. Both refusals come before anything is made.
- The gitfile is written by `gitfileIn` into the directory this host keeps its own records in: the `configDir` the runtime was made with, or `tmpdir()` where it was made without one (`stateDirOf`). Its content is the same for every machine, so one file serves them all.
- `runtime.ts`: `stateDirOf`; both routes take their mounts from `guardedMounts(..., stateDirOf(options), spec.gitGuard)` and pass the volume as `own` (the Dev Container CLI route through `cliVolumeOf`, the Docker route as a `-v`); the Docker route labels `ahpd.git=<guard>` where the machine has a git directory, and the `ahpd.worktree` label is gone.
- `remove` takes the git volume with the container only where the label says `fetch`: a machine a profile leaves open mounts no volume of its own, and asking Docker to remove one that was never made fails. This was found while writing the case below and is the one place this task departs from reading the label as "has a git directory".
- `computer-git-fetch.test.ts`: two real-Docker cases, each with the plan's 120 s budget, both passing. On a linked worktree and on a main checkout, `ln -sf /tmp/x <gitDir>/logs/HEAD`, `touch` of `<gitDir>/config`, `HEAD`, `refs`, `logs` and `objects/probe` all fail, and `<root>/.git` cannot be moved aside; the host's `config` is byte-identical afterwards. The main-checkout case asserts `cat <gitDir>/HEAD` and `test -e <gitDir>/config` fail rather than a write, because the volume is created root-owned and is empty until task 03 seeds it.
- `computer-git-own.test.ts`: rewritten around the new shape, 6 cases. Refusals leave nothing made - no gitfile in the state directory, and nothing new in the host's git directory.
- `computer-disposable.test.ts`: `load` gained a trailing `configDir` parameter and `withRepository` passes the test's temporary directory, so the gitfile lands there. The mount cases are rewritten to the new layout, the two `index.lock` cases and the `modules/` case are gone with `releaseLock` and the allowlist, and one case is new: disposing a machine asks for `volume rm ahpd-git-<name>` under `fetch` and asks for no volume at all under `open`.
- `computer-git-guard.test.ts`: rewritten. What a guard leaves writable in a real container is now `open`'s alone - one real-Docker case makes a machine under `open` on a linked worktree, commits in it, and reads the commit back off the host's branch. The rest is the guard itself: the `fetch` default, `guardedMounts` and `runsAsHost` under each guard, and `gitInside` on real paths where the tree is reached through a link.
- `computer-devcontainer.test.ts`: the override's mounts are the objects bind, the gitfile bind and the volume; the label read back is `ahpd.git=fetch`.
- `npx tsc -b` clean; `npx vitest run --no-file-parallelism packages/computer` passes (21 files, 351 tests). The parallel run is not green on this machine: it reports 5 s timeouts in files this task does not touch (`computer-needs`, `computer-uptime`, `computer-state-seed`, `devcontainer` and others), with no assertion failure, under a load average of about 30. Every one of them passes on its own and in the serial run.
- **Review round** 2026-10-06: the state directory `gitfileIn` writes into is a temporary one in every suite, and the checkout is checked. The gitfile lands at whatever `configDir` names, so the suites that handed the loader this repository wrote `computers.gitfile` into it - a file left in the working tree for a person to find in `git status` afterwards. `computer-disposable`, `computer-owner`, `computer-uptime`, `computer-state-seed`, `computer-needs`, `computer-plugin`, `computer-options` and `packages/sdk/test/nested-start` each now make a `mkdtempSync` directory of their own for it and remove it after the case, and the two things an earlier run had left at the root (`computers.gitfile` and `fetch/`) are gone. `tools/test-tmpdir.ts`, the run's `globalSetup`, fails a run that leaves the file at the repository root: it removes it and throws, which is a vitest startup error and a non-zero exit, verified by hand with a file written there. It is named in the run's one setup rather than per package, so a suite that starts doing it again is caught whichever package it is in.

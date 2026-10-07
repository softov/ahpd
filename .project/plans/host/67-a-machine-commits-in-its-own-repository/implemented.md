---
title: A machine commits in a repository of its own, and ahpd fetches the work back - implemented
date: 2026-10-06
refs:
  - git://fb1f022 - the commit this work sits on; none of it is committed yet, on `build/agents/c016a0e4`
  - "[code://packages/computer/src/gitdir.ts](../../../../packages/computer/src/gitdir.ts) - the guards, the mounts, the volume and the gitfile"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - the two routes, the seed, `bringBack`, `follow` and `remove`"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `gitGuard`, `sessionTree`, `withGit` and the machines a daemon before this one left"
  - "[code://packages/sdk/src/types/computers.ts](../../../../packages/sdk/src/types/computers.ts) - `bringBack` and `follow` on `ComputerPort`"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - what a machine commits into, and what does not work in one"
---

A session's machine now commits in a git repository of its own, and ahpd fetches that work back into this host's repository.
Nothing of the host's git directory is writable in a machine, and no path inside the machine's volume is ever opened by the host's git: the commits leave as a bundle on a pipe and arrive as a fetch, with every object checked.
A profile says how the tree reaches a machine - `sessionTree: "shared"`, the default, binds this host's tree at its own path, and `copy` gives the machine a checkout of its own - and `gitGuard` is `fetch` by default and `open` for an operator who trusts a machine with the real thing, with the guard this plan removes, `bind`, read as `fetch`.

## What was built

- [`code://packages/computer/src/gitdir.ts`](../../../../packages/computer/src/gitdir.ts) - `GitGuard` is `fetch` or `open`; `guardedMounts` answers, under `fetch`, a bind of the host's `objects/` read-only at `/opt/ahpd/host-objects` and the machine's own git directory in the volume `ahpd-git-<machine>` - mounted over `<root>/.git` where that is a directory, and at `/opt/ahpd/git` with a gitfile bound read-only over the tree's `.git` where it is a file. Before any of it, a git directory holding a symbolic link under its root, `logs/`, `refs/`, `objects/` or the session's worktree entry is refused naming each link, as is a host repository whose `objects/info/alternates` names anything. `treeOf` and `copyOf` read a machine back out of its own mounts, through real Docker's `Name` as well as the scripted fixture's `Source`.
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - both routes mount the git directory, seed it from the host's tree (the branch, the commit, the index, `user.name` and `user.email`, and under `copy` a `reset --hard`), and label the machine `ahpd.git=<guard>`. `bringBack` pours `git bundle create -` out of the machine on a pipe into a private `0600` file and fetches it with `transfer.fsckObjects=true` into `refs/ahpd/machines/<machine>/<branch>` - one hidden ref per branch the machine holds, asked for rather than read off its `HEAD` - then moves the host's branch of that name to it where the old tip is an ancestor and nothing is staged, makes it at the machine's commit where the host has no branch by that name at all, and leaves the work under that ref where neither holds; under `copy` the branch the host's tree is on moves by `merge --ff-only` and any other moves as a ref. `follow` hands the host's branch and commit to the machine with `update-ref` and `reset -q`, only where the machine holds nothing the host has not fetched, both at the commit it is at and at the branch of that name it is about to re-point. `remove` fetches first, deletes the volume after, and under `copy` keeps what was never committed as a stash commit fetched to `refs/ahpd/machines/<machine>/uncommitted`.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - a profile's `gitGuard` and `sessionTree` are read, checked against their answers, and collapsed to the guard the machine is actually made with; `withGit` refuses a `copy` profile over a folder with no repository; and a machine a daemon before this one left behind is detected by the read-only git bind its mounts hold and removed rather than entered, with one sentence to the session.
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) - `Profile.sessionTree?: 'shared' | 'copy'`, documented beside `sessionFolder`.
- [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts) - `ComputerPort.bringBack(id)` and `ComputerPort.follow(id)`, both optional, with `BroughtBack` answering whether the branch moved and where the work waits.
- [`code://packages/sdk/src/host/machines.ts`](../../../../packages/sdk/src/host/machines.ts), [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts), [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), [`code://packages/sdk/src/host/resourcemethods.ts`](../../../../packages/sdk/src/host/resourcemethods.ts) - the moments. The work comes back when a turn ends or is cancelled (before the facts are re-read), before a changeset operation runs (refusing with `-32011` where it waits), when a session leaves its machine, and in `remove`; the host's branch is handed over before a turn starts and after an operation that moved it. Every failure is a log line, never a failed turn.
- [`code://packages/sdk/src/index.ts`](../../../../packages/sdk/src/index.ts) - `gitArgv` exported, so the computer package runs git the hardened way.
- [`code://docs/COMPUTER.md`](../../../../docs/COMPUTER.md) - the `gitGuard` row, a `sessionTree` row, the fetch and follow paragraphs, what does not work in a machine, the `copy` layout, and the security note: nothing of the host's git directory is writable in a `fetch` machine.

## Verified

- `pnpm build` clean; `pnpm typecheck` clean; `pnpm boundary` - nothing undeclared in any package.
- `npx vitest run` from the root - **230 files, 3377 tests, all passing**, none skipped.
- Real Docker, `packages/computer/test/computer-git-fetch.test.ts`, **22 cases at 120 s each, every one of them run rather than skipped** (136 s in all): the machine's git directory, the objects it reads, the seed's branch and identity on a linked worktree and a main checkout, the commit coming back onto the host's branch, a bundle the host's fsck refuses, the work waiting where the branch moved on or the index is staged, a branch the machine made and the host never had, every branch of a machine's coming back at once, `release_computer` fetching a machine's commit out before the machine goes, a detached host, `follow` in both directions, and the four `copy` cases (what the machine writes is not in the host's folder until the fetch; the wait where the host changed the same file; the uncommitted work kept at removal; and the machine following a host commit and refusing to move where its tree is dirty).
- Scripted and unit: `computer-git-own.test.ts` (6) and `computer-git-guard.test.ts` (5) for the mounts, the gitfile, the link and alternates refusals and the two guards; `computer-plugin.test.ts` for `bind` read as `fetch` with its line and for the `sessionTree` values, the third value refused and the non-repository folder refused; `computer-disposable.test.ts` for the `copy` mounts with the host's refs unmoved, the `ahpd.git=fetch` label and the seed's `reset --hard`; `computer-options.test.ts` (23); `packages/sdk/test/computer-bringback.test.ts` (6) and `computer-follow.test.ts` (5) for the four moments and the two directions, against a counting port.
- Each task's own run is in its `Resume`, including the red-first run of every failing case.

## Departures from the plan

- The decision's row 97 says a machine made under `bind` is detected by "a writable bind inside its session's git directory". It is detected by a **read-only** bind of a git path instead: a writable-bind test cannot tell the two old guards apart, and it would remove every old `open` machine - the one this task's own *Validation* says is entered as before. Task 07's `Resume` has the reasoning in full.
- Task 09's *Files* names both routes for `copy`. The Docker route is implemented and tested; the dev-container route's `copy` arm is implemented in `overrideOf` and unreachable today, because no route sets both `sessionTree` and `spec.devcontainer`. It is stated rather than tested, and a later task that gives a dev container a session's git directory will need a case for it.
- Task 09's `bringBack` under `copy` does not carry over the `shared` path's staged-changes check: a merge does not unstage, so the merge's own refusal is the guard.
- Task 05 puts the fetch before a changeset operation in `resourcemethods.ts` rather than `changesets.ts` as its *Files* named, since that is where the verbs are actually invoked.
- `gitdir.ts`'s `listedTree` gained the read of a named volume's `Name` beyond its `Source`. That is not a departure but a bug real Docker exposed and no scripted case could: a `shared` machine on a main checkout, whose tree only the volume's mount names, was invisible to `treeOf` under real Docker too.

## What a review found

Five defects were found in the built plan and all five are fixed, every task staying `implemented`.

- `release_computer` lost a machine's commits: it stopped the machine before removing it, and a stopped container refuses the `docker exec` the removal's fetch runs, so the volume holding the commits went with the container. The tool now calls `remove` with no stop in front of it, `computer.test.ts` asserts that nothing stops the machine, and a real-Docker case runs the tool and reads the commit off the host. The `deferred.md` row is removed.
- A branch the host did not have never landed: `rev-parse` without `--verify` answered the ref's own name, so `old` was never empty and the move was refused as a branch that had moved on. Every read of the host's refs is `rev-parse --verify --quiet`, and a branch the host has none of is made at the machine's commit with no ancestry check.
- Only the branch the machine was on came back: every branch it holds now goes through `bringBackBranch` under a hidden ref of its own, and `follow` re-points a branch of the machine's only where the host's commit leads on from it.
- The suites wrote `computers.gitfile` into this checkout by handing the loader the repository as its state directory; each now uses a temporary directory of its own, `tools/test-tmpdir.ts` fails a run that leaves the file at the root, and the two strays an earlier run left are gone.
- [`code://docs/COMPUTER.md#L440`](../../../../docs/COMPUTER.md#L440) still described a commit brought back onto one branch; it and the `follow` paragraph are corrected to what the code does.

## Left for later

- What an agent never committed is kept with plain `git stash create`, which takes tracked modifications only - see [deferred.md](deferred.md).
- No remote reaches a machine, so `git push` and Git LFS do not work in one - see [deferred.md](deferred.md).

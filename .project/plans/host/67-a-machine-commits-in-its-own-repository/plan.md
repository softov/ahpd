---
title: A machine commits in a repository of its own, and ahpd fetches the work back
domain: host
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/65-what-the-review-of-the-nine-built-plans-found-p2-a-machines-git-directory/plan.md
  - plans/container/05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md
decisions:
  - decisions/a-machine-commits-in-its-own-repository-and-the-host-fetches-it.md
  - decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md
refs:
  - "[code://packages/computer/src/gitdir.ts](../../../../packages/computer/src/gitdir.ts) - `gitMounts`, `guardedMounts`, `runsAsHost`, `releaseLock` as host/65 p2 leaves them; the allowlist goes"
  - "[code://packages/computer/src/runtime.ts#L451-L466](../../../../packages/computer/src/runtime.ts#L451-L466) - `MachineSpec.gitDir`, `repository`, `gitGuard`, `user`"
  - "[code://packages/computer/src/runtime.ts#L1108-L1122](../../../../packages/computer/src/runtime.ts#L1108-L1122) - the dev container route: the tree at its own path, the user and worktree labels"
  - "[code://packages/computer/src/runtime.ts#L1919-L1921](../../../../packages/computer/src/runtime.ts#L1919-L1921) - the dev container route asks `guardedMounts`"
  - "[code://packages/computer/src/runtime.ts#L1655-L1660](../../../../packages/computer/src/runtime.ts#L1655-L1660) - `seedState`: a volume filled and owned by the machine's user, the pattern the git volume follows"
  - "[code://packages/computer/src/runtime.ts#L2026-L2099](../../../../packages/computer/src/runtime.ts#L2026-L2099) - the Docker route: the folder or root bound, then the git binds, `--user`"
  - "[code://packages/computer/src/runtime.ts#L2164-L2172](../../../../packages/computer/src/runtime.ts#L2164-L2172) - `remove`, which releases the worktree lock today"
  - "[code://packages/computer/src/runtime.ts#L2179-L2204](../../../../packages/computer/src/runtime.ts#L2179-L2204) - `exec`, text only; a bundle needs bytes"
  - "[code://packages/computer/src/plugin.ts#L119-L123](../../../../packages/computer/src/plugin.ts#L119-L123) - the `gitGuard` schema row"
  - "[code://packages/computer/src/plugin.ts#L379-L388](../../../../packages/computer/src/plugin.ts#L379-L388) - a profile's `gitGuard` refused unless `bind` or `open`"
  - "[code://packages/computer/src/plugin.ts#L920-L937](../../../../packages/computer/src/plugin.ts#L920-L937) - `withGit`"
  - "[code://packages/computer/src/manifest.ts#L162-L167](../../../../packages/computer/src/manifest.ts#L162-L167) - `Profile.gitGuard`"
  - "[code://packages/sdk/src/host/machines.ts#L172-L187](../../../../packages/sdk/src/host/machines.ts#L172-L187) - `repositoryOf`, which hands the plugin `gitDir` and `repository`"
  - "[code://packages/sdk/src/repo/worktrees.ts#L75-L94](../../../../packages/sdk/src/repo/worktrees.ts#L75-L94) - `gitDir`, which host/65 p2 widens to the tree's own directory too"
  - "[code://packages/sdk/src/repo/hardened.ts#L11-L30](../../../../packages/sdk/src/repo/hardened.ts#L11-L30) - `gitArgv`, not exported from the sdk today"
  - "[code://packages/sdk/src/types/computers.ts#L182-L184](../../../../packages/sdk/src/types/computers.ts#L182-L184) - `ComputerPort`, which gains the call that brings the work back"
  - "[code://packages/sdk/src/host/spawn.ts#L626-L634](../../../../packages/sdk/src/host/spawn.ts#L626-L634) - a finished turn re-reads the folder's git facts"
  - "[code://packages/sdk/src/host/snapshots.ts#L158](../../../../packages/sdk/src/host/snapshots.ts#L158) - a changeset read re-reads the facts"
  - "[code://packages/sdk/src/changes.ts#L223-L345](../../../../packages/sdk/src/changes.ts#L223-L345) - the changeset operations that move the host's branch or index: commit, discard, stage, revert, create a pull request, checkout"
  - "[code://docs/COMPUTER.md#L344](../../../../docs/COMPUTER.md#L344) - the `gitGuard` row"
  - "[code://docs/COMPUTER.md#L435](../../../../docs/COMPUTER.md#L435) - a worktree brings its repository"
  - "[code://docs/COMPUTER.md#L580](../../../../docs/COMPUTER.md#L580) - a mounted git directory"
  - https://git-scm.com/docs/git-bundle - `bundle create -` writes to standard output; prerequisites with `--not`
  - https://git-scm.com/docs/gitrepository-layout - `objects/info/alternates`, and the gitfile a linked worktree uses
---

## Goal

A machine with a repository commits in a git directory of its own, and nothing of the host's git directory is writable in it.
ahpd brings the machine's commits back into the host's repository by fetch, so the session's branch on the host holds the agent's work as before, without any path a machine could plant a link in.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "guardedMounts|runsAsHost|releaseLock|MACHINE_WORKTREE" packages/computer/src` - the two routes in `runtime.ts`, `withGit` in `plugin.ts`, the lock in `remove`.
- `rg -n "refreshFacts|readFacts" packages/sdk/src/host` - a finished turn (`spawn.ts`) and a changeset read (`snapshots.ts`) are where the host looks at a folder's git again.
- `rg -n "gitArgv|hardened" packages/sdk/src/index.ts` - not exported; the computer package cannot use it yet.
- The build of host/65 p2 in `/github/ahpd.worktrees/build-agents-87ecab31` (uncommitted): `gitdir.ts` with the allowlist, `mainCheckoutBinds`, `ownOf`, `spellingOf`, and its `implemented.md`.
- By the reviewer, git 2.47.3: a machine replaces `logs/HEAD` with a link and the host's next commit appends to its target; `refs/` links are refused by git.

### Runtime path

```
today:  placedIn -> repositoryOf -> withGit -> MachineSpec { folder, gitDir, repository }
          -> -v <root> + allowlist binds of <gitDir> -> git in the machine writes the host's git directory
after:  ... -> -v <root> + <gitDir>/objects:ro + volume ahpd-git-<machine> as the tree's .git
          -> git in the machine commits into the volume
        turn end -> ComputerPort.bringBack(id) -> docker exec git bundle create - > private file
          -> host git fetch (fsck) -> refs/ahpd/machines/<machine>/<branch> -> fast-forward the branch, reset the index
```

### Gaps

- Every writable bind of the host's git directory is a place for a link the host's own git writes through.
- The machine has no git directory but the host's, so there is nothing to commit into once that is read-only.
- No port call brings a machine's commits back, and `exec` answers text, not bytes.
- Machines made under `bind` are adopted and entered as they are after a restart.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A machine commits in a git directory of its own, and ahpd fetches the work into the host's repository](../../../decisions/a-machine-commits-in-its-own-repository-and-the-host-fetches-it.md) | Softov, 2026-10-06, "Host fetches from machine", and "configurable shared bound read-write as default, copy as opt" for `sessionTree`; its name, the changes view under `copy`, the read-only alternates, the bundle on a pipe, the fast-forward and `bind` read as `fetch` are defaulted in the file |
| 2 | [A session folder reaches a machine only where its profile allows](../../../decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md) | unchanged: a folder below a repository's root gets a git directory only where the profile says `sessionRepository` |

| What | Source | Task |
| --- | --- | --- |
| The machine's git directory is a volume `ahpd-git-<machine>`: mounted as `<root>/.git` where the tree's `.git` is a directory, and at `/opt/ahpd/git` with a read-only gitfile naming it bound over `<root>/.git` where the tree's `.git` is a file | `(defaulted: a volume cannot be mounted over a file, and a gitfile is how git already finds a linked worktree's directory)` | 02 |
| A host git directory holding a symbolic link under its root, `logs/`, `refs/`, `objects/` or the session's worktree entry refuses the machine, naming each link and what it points at; nothing is removed | `(defaulted: git makes no link there, so one is planted or a person's; a person should see it before it goes)` | 02 |
| A host repository whose `objects/info/alternates` names anything refuses the machine | `(defaulted: those paths are not mounted, so the machine's git would fail on the first missing object)` | 02 |
| The machine's branch is the branch checked out in the host's tree when the machine is made, at the same commit, with the same name; a detached host HEAD gives a detached machine, whose work is fetched to the hidden ref only | `(defaulted: a worktree session's branch is already the session's own)` | 03 |
| The seed copies the host's `user.name` and `user.email`, as `git config --get` answers them in the tree, into the machine's repository config, and nothing else | `(defaulted: a commit needs an identity, and no other host setting is safe to carry)` | 03 |
| Under `copy`, the machine's volume is mounted at the tree's root path, holding the working tree and `.git` together, and seeded with `reset --hard`; no git-ignored file (`.env`, `node_modules`) is copied in | `(defaulted: the same path keeps an agent's history keyed the same; carrying ignored files is the worktree include list's job, not this plan's)` | 09 |
| Under `copy`, a fetch that fast-forwards updates the host's tree with `merge --ff-only`, which refuses rather than overwrite a local change; `follow` in the machine does the same | `(defaulted: the host's tree holds no agent edits to keep, so it moves with the branch)` | 09 |
| Under `copy`, `remove` keeps uncommitted work as `git stash create` in the machine, fetched to `refs/ahpd/machines/<machine>/uncommitted` | `(defaulted: nothing the agent wrote is lost with the volume)` | 09 |
| ahpd brings the work back when a turn ends or is cancelled, before a changeset operation runs, when a session leaves its machine, and in `remove` before the container goes | `(defaulted: the four moments a commit in the machine matters on the host; a changeset read does not fetch, since it runs on every look and the turn's end has fetched already)` | 05 |
| The bundle covers the machine's branch `--not` the host's last fetched commit, or the seed's commit before the first fetch; "Refusing to create empty bundle" is nothing new | the bundle documentation | 04 |
| After a fast-forward the hidden ref is deleted; while it waits it is kept, and `remove` keeps it too | `(defaulted: the hidden ref is the only copy once the machine is gone)` | 04 |
| A host change to the branch is handed to the machine before its next turn, and after a changeset operation, only where the machine holds nothing the host has not fetched: `update-ref` and `reset -q` in the machine, the objects already reachable through the alternates | `(defaulted: the machine's branch never loses a commit)` | 06 |
| A machine is labelled `ahpd.git=fetch` or `ahpd.git=open`; one with neither label whose mounts hold a writable bind inside its session's git directory is a `bind` machine, never adopted or entered, removed, and the session is told one sentence and gets a new machine on its next start | `(defaulted: its commits are already in the host's repository, since it wrote there)` | 07 |

## Proposed architecture

- **Data flow** - host `objects/` read-only into the machine; machine commits into its volume; `git bundle create -` out through `docker exec` into a private file on the host; host `git fetch` from that file.
- **Event flow** - `chat/turnComplete` and `chat/turnCancelled` in `spawn.ts`, a changeset operation, a session leaving its machine, and `remove` call `bringBack`; a turn starting and a finished operation call `follow`.
- **State flow** - the last fetched commit is `refs/ahpd/machines/<machine>/<branch>` in the host's repository while work waits, else the host branch's own tip; the machine keeps no record of what was fetched.
- **Layer responsibilities** - computer: `sessionTree`, the volume, the mounts, the seed, `bringBack` and `follow` against Docker and the host's git, the migration · sdk: the two port calls on `ComputerPort`, the moments that call them, `gitArgv` exported · docs: `COMPUTER.md`.
- **Source-of-truth files** - [`code://packages/computer/src/gitdir.ts`](../../../../packages/computer/src/gitdir.ts), [`code://packages/sdk/src/types/computers.ts`](../../../../packages/sdk/src/types/computers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - gitGuard is fetch or open](task-01-gitguard-is-fetch-or-open.md) | done | - |
| [02 - A machine gets a git directory of its own](task-02-a-machine-gets-a-git-directory-of-its-own.md) | done | 01 |
| [03 - The machine's repository is seeded from the host's](task-03-the-machines-repository-is-seeded-from-the-hosts.md) | done | 02 |
| [04 - ahpd brings the work back by fetch](task-04-ahpd-brings-the-work-back-by-fetch.md) | done | 03 |
| [05 - The work comes back when it matters](task-05-the-work-comes-back-when-it-matters.md) | done | 04 |
| [06 - The machine follows the host's branch](task-06-the-machine-follows-the-hosts-branch.md) | done | 04 |
| [07 - A machine made under bind is replaced](task-07-a-machine-made-under-bind-is-replaced.md) | done | 02 |
| [08 - COMPUTER.md says how a machine commits](task-08-docs.md) | done | 05, 06, 07, 09 |
| [09 - A profile can give a machine a copy of the folder](task-09-a-profile-can-give-a-machine-a-copy-of-the-folder.md) | done | 04, 06 |

## Risks and tradeoffs

- A machine's commit reaches the host's branch at the turn's end, not at once; a person reading the branch mid-turn sees the work as uncommitted changes - stated in the docs.
- ahpd now moves the host's branch and index, which on a main checkout is the person's own checkout - only as a fast-forward with nothing staged, else the work waits under the hidden ref.
- The machine's alternates read the host's objects live; a host `git gc` after a person rewrote the branch can prune an object the machine still needs - the machine's git then fails in its own words, and a new machine fixes it.
- Under `copy` the changes view shows only what was fetched, so a person sees an agent's work turn by turn and nothing uncommitted - stated in the docs.
- No remote, submodule or filter driver reaches the machine, so `git push` and LFS do not work in it - in `deferred.md` once built, and named in the docs now.
- host/65 p2's binds land first and are then removed; this plan is written against its build, so line numbers in `gitdir.ts` are left off.

## Resume state

- **Built 2026-10-07:** every task done; one review found five defects, all fixed in one round and verified.
- **Done so far:** tasks 01, 02, 03, 04 and 05: `gitGuard` is `fetch` or `open` with `bind` read as `fetch`; under `fetch` a machine mounts the host's `objects/` read-only at `/opt/ahpd/host-objects` and gets a git directory of its own in the volume `ahpd-git-<machine>`; once the machine is up that git directory is seeded from the host's tree, so git in the machine is clean, on the tree's branch, at the tree's commit, with the identity a commit needs; `ComputerPort.bringBack(id)` carries the machine's commits to the host - a bundle poured out of `docker exec` into a private `0600` file, read by the host's `git fetch` with fsck on, into `refs/ahpd/machines/<id>/<branch>`, then a fast-forward of the host's branch and a `reset -q` of the tree where the old tip is an ancestor and nothing is staged, and the hidden ref where it waits; and the four moments call it: a turn ending or cancelled (`spawn.ts`, before the facts are re-read), an operation on the changeset (`resourcemethods.ts`, before it runs, refusing with `-32011` where the work waits), a session leaving its machine (`machines.ts`, before the port's `leave`), and `remove` before the container goes (`runtime.ts`, a failure logged and the removal going on). The objects' target is `/opt/ahpd/host-objects` and not `<gitDir>/objects`, because on a main checkout the machine's own git directory is a volume at `<root>/.git` and a bind inside a mount would shadow the machine's object store - task 03's Resume has it in full.
  And task 06 closes the other direction: `ComputerPort.follow(id)` (`ComputerRuntime.follow`, `followOfMachine` in the runtime) reads the host's branch and commit in the tree with the hardened argv and hands them to the machine - `update-ref`, `symbolic-ref HEAD` for a branch the host switched to, `reset -q`, or `update-ref --no-deref HEAD` for a detached host - and only where the machine holds nothing the host has not fetched, which is two checks in the host's repository (`cat-file -e` for a commit never fetched, `merge-base --is-ancestor` for a branch that does not lead on from it), each a log line and a return, and nothing written when the machine is already on the host's branch at its commit. The two moments are a turn starting - in `lifecycle.ts`'s `beginOrRun`, the single road every turn takes, and not for a message queued behind a running turn - and a changeset operation that has run (`resourcemethods.ts`, after `contentMoved`); `spawn.ts`'s hook is the backend's own `chat/turnStarted`, which is after the turn has begun. A port that throws is a log line and the turn still starts. That change surfaced a hole it had to close with it: `beginTurn` now refuses a promise that rejects, in the error's own words, where a synchronous throw had reached the dispatch's own catch.
  And task 07 closes the machines a daemon before this one left behind: `madeUnderBind` reads a machine whose labels hold no `ahpd.git` whose mounts hold a read-only bind of a path in a git directory, the startup listing removes such a machine before anything is adopted or entered with the sentence in the log, and a session asking for one through `how` has it removed and is told the sentence - the read-only bind and not the writable one, which the task's *Resume* has in full, because the old `open` guard mounted the git directory writable and nothing else.
  And task 09 closes the other shape a session's tree can take: a profile's `sessionTree` is `shared`, the default, or `copy`, and under `copy` the machine's volume is mounted at the tree's own root path holding the working tree and `.git` together, nothing of the host's tree is bound, the guard collapses to `fetch`, the seed ends `reset --hard -q`, `bringBack` moves the host's tree with `merge --ff-only` and leaves the work under the hidden ref where that refuses, `follow` merges into the machine only where its tree is clean, and `remove` keeps what was never committed in `refs/ahpd/machines/<machine>/uncommitted`; a folder with no repository is refused under `copy` in one sentence. Task 09's Resume has it in full, `listedTree` reading real Docker's `Name` among it.
  And task 08 is the docs: `docs/COMPUTER.md`'s `gitGuard` row rewritten for `fetch` and `open` with `bind` read as `fetch`, a `sessionTree` row beside it, the "A worktree brings its repository." paragraph rewritten with the allowlist gone and the fetch, the follow, what does not work in a machine and the `copy` layout in paragraphs after it, and the security note rewritten to say that nothing of the host's git directory is writable in a `fetch` machine and that a link under its root refuses one.
  And a review of the built plan found five defects, all five fixed: `release_computer` removes a machine without stopping it first, so the fetch in `remove` can run at all; the host's refs are read with `rev-parse --verify --quiet`, so a branch the host does not have is made at the machine's commit rather than never landing; every branch a machine holds comes back, each under a hidden ref of its own, and `follow` re-points a branch of the machine's only where the host's commit leads on from it; the suites hand the loader a temporary state directory instead of this repository, with the run's `globalSetup` failing a run that leaves `computers.gitfile` at the root; and the two paragraphs of `docs/COMPUTER.md` that still spoke of one branch are corrected.
- **Next action:** the plan is built end to end - all nine tasks `implemented` - and it waits on the review that closes it. `implemented.md` and `deferred.md` are written; what waits is the plain `git stash create` of task 09 keeping tracked modifications only, and no remote reaching a machine, so `git push` and LFS do not work in one.
- **Open questions:** none; Softov chose "Host fetches from machine", and every other choice is a defaulted row above.
- **Watch out for:** never let the host's git open a path inside the machine's volume, not even to read; everything from the machine arrives on a pipe. `bringBack` takes the tree from the machine's own mounts (`treeOf`), since nothing else names the folder of a `docker run` machine, and it answers `undefined` for a machine with no record - the four moments of task 05 have to live with that.
  `docker exec` today answers text through `ran`, which would corrupt a pack; the bundle needs its own byte stream.
  A dev container is reached through `reachedDevContainer`, not plain `docker exec`; `bringBack` has to take both roads, as `exec` does.

## Final verification checklist

- [ ] In a real machine on a linked worktree and on a main checkout, `ln -sf /tmp/x <gitDir>/logs/HEAD` fails, and so does any write under the host's git directory.
- [ ] A commit in the machine is on the host's branch after the turn ends, and the host's `git status` in the folder is clean.
- [ ] A host commit between turns reaches the machine before its next turn.
- [ ] A machine made under `bind` is not entered after a restart.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm boundary` clean; `npx vitest run` from the root passes, with the real-Docker cases in `computer-git-fetch.test.ts` run rather than skipped.
- [ ] `plans/index.md` updated.

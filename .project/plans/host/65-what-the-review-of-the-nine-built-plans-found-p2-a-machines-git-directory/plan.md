---
title: A machine cannot change what git on the host runs, or reach another repository
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/65-what-the-review-of-the-nine-built-plans-found/plan.md
  - plans/container/05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md
decisions:
  - decisions/a-machines-git-directory-is-read-only-but-what-a-commit-writes.md
  - decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md
refs:
  - "[code://packages/computer/src/gitdir.ts#L115-L150](../../../../packages/computer/src/gitdir.ts#L115-L150) - `gitMounts`: the git directory read-write, four parts read-only over it"
  - "[code://packages/computer/src/gitdir.ts#L160-L181](../../../../packages/computer/src/gitdir.ts#L160-L181) - `gitInside`, `guardedMounts`, `runsAsHost`, comparing paths as spelled"
  - "[code://packages/computer/src/gitdir.ts#L197-L203](../../../../packages/computer/src/gitdir.ts#L197-L203) - `releaseLock`"
  - "[code://packages/computer/src/runtime.ts#L2026-L2030](../../../../packages/computer/src/runtime.ts#L2026-L2030) - the Docker route asks `guardedMounts`"
  - "[code://packages/computer/src/runtime.ts#L2080-L2091](../../../../packages/computer/src/runtime.ts#L2080-L2091) - the repository root mounted in place of the folder"
  - "[code://packages/computer/src/runtime.ts#L1108-L1116](../../../../packages/computer/src/runtime.ts#L1108-L1116) - the dev container route's workspace mount"
  - "[code://packages/computer/src/runtime.ts#L1919-L1921](../../../../packages/computer/src/runtime.ts#L1919-L1921) - the dev container route asks `guardedMounts`"
  - "[code://packages/computer/src/runtime.ts#L2164-L2171](../../../../packages/computer/src/runtime.ts#L2164-L2171) - `remove`, which releases the lock"
  - "[code://packages/computer/src/plugin.ts#L920-L937](../../../../packages/computer/src/plugin.ts#L920-L937) - `withGit`"
  - "[code://packages/sdk/src/host/machines.ts#L172-L187](../../../../packages/sdk/src/host/machines.ts#L172-L187) - `repositoryOf`: the git directory as git answers it, the root dropped when the folder is it through a realpath"
  - "[code://packages/sdk/src/repo/worktrees.ts#L75-L94](../../../../packages/sdk/src/repo/worktrees.ts#L75-L94) - `gitDir`, `rev-parse --git-common-dir --show-toplevel`"
  - "[code://packages/computer/test/computer-disposable.test.ts#L1366-L1515](../../../../packages/computer/test/computer-disposable.test.ts#L1366-L1515) - the git directory cases to extend"
  - "[code://docs/COMPUTER.md#L435](../../../../docs/COMPUTER.md#L435) - a worktree brings its repository"
  - "[code://docs/COMPUTER.md#L580](../../../../docs/COMPUTER.md#L580) - a mounted git directory"
  - https://git-scm.com/docs/gitrepository-layout - per-worktree and shared files
---

## Goal

A machine with a repository's git directory can commit in its worktree and cannot write anything git on the host reads as config or as a path, cannot be pointed at another repository on the host, and gets the repository's root only where its profile allows it.
A lock host git holds is never removed for it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "guardedMounts|runsAsHost|releaseLock" packages/computer/src` - the two routes in `runtime.ts` and `withGit` in `plugin.ts`.
- By hand, git 2.47.3: a linked worktree whose common directory's root, `config`, `hooks/`, `info/` and `worktrees/` are not writable still runs `add`, `commit` and `checkout -b`; a main checkout locked the same way fails `add` and `commit` on `.git/index.lock`. See the decision.

### Runtime path

```
placedIn -> repositoryOf(folder) -> worktrees.gitDir -> { gitDir, repository? }
  -> plugin withGit -> MachineSpec { folder, gitDir, repository, gitGuard }
  -> runtime: -v <repository ?? folder> + guardedMounts(gitDir, root).binds
```

### Gaps

- The git directory's root is writable, so `commondir`, `config.worktree` and `info/` are too (finding B1).
- Nothing checks that the git directory git answers is the folder's own; an agent's `commondir` or a fake `.git` points the next session at another repository, which is then mounted read-write (B2).
- `repository` replaces the folder in the mount with no bound of its own (B3).
- Paths are compared as spelled, so a symlinked root session puts its binds on the real path and leaves the link's `.git` writable (B4).
- In a root session `.git` is not a mount point, so `mv .git .old && mkdir .git` replaces it (B5).
- `releaseLock` removes `index.lock` whoever holds it (B6).

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A machine's git directory is read-only, except the objects, refs and logs a commit writes and the session's own worktree entry](../../../decisions/a-machines-git-directory-is-read-only-but-what-a-commit-writes.md) | Softov, 2026-10-06, "Allowlist writable"; for a main checkout "Also allow the root index" and "Writable root, pinned files" |
| 2 | [A session's folder reaches a machine only where its profile allows it](../../../decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md) | Softov, 2026-09-26, the gate task 04 extends to the repository root |

| What | Source | Task |
| --- | --- | --- |
| A session's git directory is the folder's own: `<root>/.git`, or the common directory of the worktree its `.git` file names, with no `commondir` leading anywhere else | the review, container/05 p7 | 02 |
| Paths are compared after `realpath`, and binds land at the spelling the machine mounts | the review, container/05 p7 | 03 |
| A profile's `sessionRepository: true`, beside `sessionFolder`, lets the repository root be mounted; without it the root is not mounted, the folder alone is, with no git directory, and the log says why | Softov, 2026-10-06, asked "Where may a session's repository root be mounted from?": "sessionRepository flag" | 04 |
| A worktree's `index.lock` is removed only when it is older than the machine's stop | `(defaulted: an index.lock names no holder, and its time is the one thing that tells the machine's from host git's)` | 05 |

## Proposed architecture

- **Layer responsibilities** - computer: 01, 03, 04, 05 (`gitdir.ts`, `runtime.ts`, `plugin.ts`) · sdk: 02 (`machines.ts`, `repo/worktrees.ts`).
- **Source-of-truth files** - [`code://packages/computer/src/gitdir.ts`](../../../../packages/computer/src/gitdir.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The git directory is read-only but what a commit writes](task-01-the-git-directory-is-read-only-but-what-a-commit-writes.md) | todo | - |
| [02 - A session's git directory is its folder's own](task-02-a-sessions-git-directory-is-its-folders-own.md) | todo | - |
| [03 - Paths are compared real](task-03-paths-are-compared-real.md) | todo | 01 |
| [04 - A repository root is mounted only where the profile allows it](task-04-a-repository-root-is-mounted-only-where-allowed.md) | todo | - |
| [05 - A lock is removed only when it is the machine's](task-05-a-lock-is-removed-only-when-it-is-the-machines.md) | todo | - |

## Risks and tradeoffs

- A main checkout's writable root lets an agent make a new file there that a later git might read; the decision names it.
- Task 01 makes a commit print `Unable to create .../packed-refs.lock` on git 2.47, from the ref packing git tries after a ref update; it is not fatal and the docs say so.
- Task 02 refuses a layout git accepts (a `commondir` in a main checkout's `.git`); nobody writes one by hand, and the refusal names it.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-git-directory-is-read-only-but-what-a-commit-writes.md](task-01-the-git-directory-is-read-only-but-what-a-commit-writes.md).
- **Open questions:** none. The main checkout is answered in the decision: its root is writable, with `commondir`, `config.worktree`, `config`, `packed-refs`, `info/` and `hooks/` pinned read-only.
- **Watch out for:** p7's tests in `computer-disposable.test.ts:1366-1515` pin today's binds; change them with the decision, not around it.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] By hand, a disposable session with `isolation: worktree` commits in its machine, and `echo x > <gitDir>/commondir` in the machine fails.
- [ ] `docs/COMPUTER.md` says what is writable.
- [ ] `plans/index.md` updated.

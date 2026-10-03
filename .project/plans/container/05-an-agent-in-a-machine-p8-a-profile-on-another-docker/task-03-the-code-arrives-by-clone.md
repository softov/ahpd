---
title: The session's code arrives by bundle and returns as a branch
status: todo
depends: [task-02-no-bind-mount-on-another-docker.md]
layer: "computer | sdk"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L84-L85](../../../../packages/sdk/src/types/computers.ts#L84-L85) - `MachineSource.folder`, the session's folder on this host"
  - "[code://packages/sdk/src/worktrees.ts](../../../../packages/sdk/src/worktrees.ts) - the worktrees port, where the session's branch is"
---

## Objective

A machine on another Docker made for a session holds a clone of the session's branch at its working directory, and what the session committed there reaches this host's repository as that branch.
This task builds the default route, `code: "bundle"`: no credential reaches the box; task 07 adds `code: "clone"` behind the same interface.

## Files

- `CREATE: packages/computer/src/clone.ts` - `codeRouteOf(profile)`, answering `bundle` for now; `bringIn(route, machine, session)` and `bringBack(machine, session)`, so a route is one branch in `bringIn`.
- `UPDATE: packages/computer/src/plugin.ts:672-779` - `create` clones after the machine starts, for a remote runner.
- `UPDATE: packages/computer/test/computer-disposable.test.ts`.

## Steps

1. In: `git bundle create` of the session's branch on this host, `docker cp` into the machine, `git clone` of it to the machine's `workdir` on that branch, then `git remote set-url origin <the repository's own origin URL>`, so the clone looks like a normal checkout; no credential is sent.
2. Back: `git bundle create` of the branch inside, `docker cp` out, `git fetch` of it into a ref of its own (`refs/ahpd/back/<session>`), then `git merge --ff-only` of that ref in the session's worktree, when the session leaves the machine and before a disposable machine is removed; git refuses a fetch straight into a branch checked out in a worktree. This host fetches, the machine never pushes.
6. A session with `isolation: folder` on a remote profile has no worktree of its own to merge into; what happens then waits on the plan's open question.
7. A bring-back that fails keeps the machine: a disposable machine is not removed while its work has not come back, and the log says which machine holds it.
3. A folder that is not a repository is refused with a sentence.
4. Nothing here is Docker-specific but the copy; keep the copy behind the runtime so p11 can use `scp`.
5. A fetch back that is not a fast-forward of the session's branch stays under its own ref and is said in the log, not forced over the branch.

## Validation

- With the fake Docker recording `cp`, a disposable session's create copies a bundle in and runs `git clone` inside, then sets `origin` to the repository's URL; its leave copies one out and fetches it into the session's branch.
- With a fake whose bundle-out fails, a disposable machine is not removed and the log names it.
- A real temporary repository with a linked worktree on a branch: the bring-back fetches into `refs/ahpd/back/<session>` and fast-forwards the worktree's branch.
- By hand on dev86 in task 05.

## Resume

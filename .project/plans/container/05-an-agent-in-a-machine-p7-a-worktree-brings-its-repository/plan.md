---
title: A worktree reaches its machine with the repository it belongs to
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-10-04
requires:
  - plans/plugin/16-a-disposable-machine/plan.md
  - plans/container/03-a-dev-container-is-a-computer/plan.md
changes: []
creates: []
decisions:
  - decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md
refs:
  - "[code://packages/sdk/src/host/machines.ts#L182-L212](../../../../packages/sdk/src/host/machines.ts#L182-L212) - `placedIn`, which hands the folder, already the worktree, to the machine maker beside the owner, team and project"
  - "[code://packages/sdk/src/host/lifecycle.ts#L457-L459](../../../../packages/sdk/src/host/lifecycle.ts#L457-L459) - `isolated`, which makes the worktree"
  - "[code://packages/sdk/src/repo/worktrees.ts#L58-L64](../../../../packages/sdk/src/repo/worktrees.ts#L58-L64) - `gitWorktrees`, whose `repository` already asks git with `rev-parse` under a five-second limit"
  - "[code://packages/sdk/src/types/worktrees.ts#L73-L112](../../../../packages/sdk/src/types/worktrees.ts#L73-L112) - the `Worktrees` port"
  - "[code://packages/sdk/src/changes.ts#L1196-L1200](../../../../packages/sdk/src/changes.ts#L1196-L1200) - the same `rev-parse --path-format=absolute --git-common-dir` call, already made to watch a worktree's refs"
  - "[code://packages/sdk/src/types/computers.ts#L84-L85](../../../../packages/sdk/src/types/computers.ts#L84-L85) - `folder` on what a machine maker is asked"
  - "[code://packages/computer/src/runtime.ts#L730](../../../../packages/computer/src/runtime.ts#L730) - the folder mounted at the same path"
  - https://git-scm.com/docs/git-worktree - a linked worktree's `.git` is a file naming the main repository's `.git/worktrees/<name>` by absolute path
---

## Goal

A session whose folder is a worktree, or a folder below a repository's root, can run git inside its machine: the repository's git directory is mounted at its own path beside the folder, and a subfolder session gets the repository root mounted rather than the subfolder alone.
Where the git directory is mounted, the machine's commands run as the host user, so git accepts the repository and every file it writes stays the host user's.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "gitDir" packages/sdk/src packages/computer/src` - only a local variable in `changes.ts`; no port method, no field on `MachineSource`, no mount.
- `rg "placedIn" packages/sdk/src/host` - one maker call, `machines.ts:201-209`, which passes `owner`, `team`, `project`, `folder` and `needs`; `gitDir` goes beside `folder`.

### Runtime path

```
createSession(isolation: worktree) -> isolated() -> worktree path -> placedIn(folder)
  -> [new] worktrees.gitDir(folder) -> /repo/.git
  -> machine: -v /repo/.git/worktrees/x... (folder) + [new] -v /repo/.git:/repo/.git
```

### Gaps

- Inside a machine, `git status` in a worktree fails: its `.git` file names a path the machine cannot see.
- The same for a session in a subfolder of a repository.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A session's folder reaches a machine only where its profile allows it](../../../decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| The git directory is mounted read-write, because a commit writes objects and refs there | git's own layout | 02 |
| The whole common git directory, not only the worktree's entry under it | git needs the objects and refs, which are shared | 02 |
| A git directory already inside the folder adds no mount | nothing to add | 01 |
| `hooks/`, `config`, `worktrees/` but the session's own entry, that entry's `config.worktree` and the worktree's `.git` file are read-only in the machine; no per-file bind for another worktree | the worktree review of 2026-09-26: hooks and `core.hooksPath` in a shared git directory run on the host's next commit; a per-file bind of a pruned entry makes a root-owned directory on the host | 03 |
| A session in a subfolder mounts the repository root, not the subfolder and `.git` alone | (defaulted: a subfolder alone makes the rest of the tree look deleted to `git commit -a` and rewrites the shared index) | 01, 02 |
| On the dev container route, the git directory and its read-only binds go through `overrideOf`, and `gitDir` is asked for the `devcontainer://` folder | (defaulted: container/03 delivers every read-only and extra mount through its override config) | 01, 02, 03 |
| A failed `rev-parse` logs one line and mounts nothing | (defaulted: a quiet failure looks like a folder outside a repository) | 01 |
| When `gitDir` is mounted, the machine's commands run as the host user's uid:gid, so git accepts the repository and every file it writes stays the host user's; there is no chown step | Softov, 2026-10-04, asked "git in the machine runs as root, so it refuses the host user's repository as dubious ownership, or leaves root-owned objects in the host's `.git`: run the machine's commands as the host user's uid:gid whenever `gitDir` is mounted, or mark the directories safe with `safe.directory` and chown what the machine wrote back when the session leaves?": run them as the host user's uid:gid, with no chown step | 02, 04 |
| A crashed agent's `index.lock` in its own worktree entry is removed after the container is gone | same review: a stale lock stops every git command until a person removes it | 03 |

## Proposed architecture

- **Data flow** - `Worktrees.gitDir(dir)` answers `git rev-parse --path-format=absolute --git-common-dir`; the host passes it as `gitDir` beside `folder`; the computer mounts it where the folder is allowed.
- **Layer responsibilities** - `@ahpd/sdk`: the port method and handing it on · `@ahpd/computer`: the mount.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host knows a folder's git directory and hands it on](task-01-the-host-hands-on-the-git-directory.md) | todo | - |
| [02 - A machine mounts the git directory beside its folder](task-02-a-machine-mounts-the-git-directory.md) | todo | 01 |
| [03 - The machine cannot change what git runs on the host](task-03-the-machine-cannot-change-what-git-runs-on-the-host.md) | todo | 02 |
| [04 - Docs](task-04-docs.md) | todo | 03 |

## Risks and tradeoffs

- The machine can write any branch of the repository, not only its own - the same as a person in the worktree on the host; limiting it needs a git proxy, which is not planned.
- A hook path that points into the worktree itself (a `core.hooksPath` of `.husky`, say) is files the agent may edit - that is true of any agent editing a repository, container or not; the docs say to review hook changes like any other.

## Resume state

- **Done so far:** nothing; revalidated against main 2026-10-02.
- **Next action:** [task-01-the-host-hands-on-the-git-directory.md](task-01-the-host-hands-on-the-git-directory.md).
- **Watch out for:**
  - plugin 16 task 10, not yet built, gates the folder by the profile; the git directory must go through the same gate.
  - This plan is for a machine on this host; a machine on another box gets the session's code by a clone, which is p8 to p10's.

## Final verification checklist

- [ ] A disposable session with `isolation: worktree` runs `git commit` in its machine, and the commit is on the worktree's branch on the host.
- [ ] A session in `repo/src` runs `git status` in its machine.
- [ ] After a commit in the machine, every file it wrote under the host's `.git` and the worktree is owned by the host user.
- [ ] Inside the machine, `.git/hooks` and `.git/config` cannot be written, and a commit still works.
- [ ] `pnpm test`, `pnpm typecheck` green.
- [ ] `docs/COMPUTER.md`, `plans/index.md` updated.

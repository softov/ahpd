---
title: A machine's git directory is read-only, except the objects, refs and logs a commit writes and the session's own worktree entry
status: superseded
superseded-by: decisions/a-machine-commits-in-its-own-repository-and-the-host-fetches-it.md
date: 2026-10-06
refs:
  - "[code://packages/computer/src/gitdir.ts#L191-L212](../../packages/computer/src/gitdir.ts#L191-L212) - `mainCheckoutBinds`: the root writable with the names git reads pinned read-only over it"
  - "[code://packages/computer/src/gitdir.ts#L235-L277](../../packages/computer/src/gitdir.ts#L235-L277) - `gitMounts`: the read-only git directory and the data directories bound writable over it"
  - "[code://packages/computer/src/gitdir.ts#L314-L320](../../packages/computer/src/gitdir.ts#L314-L320) - `guardedMounts`, which leaves the git directory's own mount out for a root session"
  - git://b677360 - container/05 p7, the guard this replaces
  - https://git-scm.com/docs/gitrepository-layout - which files are per worktree and which are shared, and what git reads for config and paths
---

## Context

container/05 p7 mounted a repository's git directory read-write in a machine and bound `hooks/`, `config`, `worktrees/` and `modules/` read-only over it.
That is a list of what to close, and git reads more than that list: an agent writes `<gitDir>/commondir` naming a directory it fills with a `config` that sets `core.fsmonitor`, and the host user's next git in the main checkout runs it.
`config.worktree` with `extensions.worktreeConfig`, `info/`, and anything a later git version reads are the same hole.
The rows this replaces are in p7's second table, not in a decision file: "The git directory is mounted read-write", and the rows that bind `hooks/`, `config`, `worktrees/` and `modules/` read-only.

What git writes was read from the layout and checked with git 2.47.3 on a linked worktree whose common directory's root, `config`, `hooks/`, `info/` and `worktrees/` were not writable: `git add`, `git commit` and `git checkout -b` succeeded; the commit printed one non-fatal error, `Unable to create .../packed-refs.lock`, from the ref packing git now tries after a ref update.
The same lock-down on a main checkout failed `git add` and `git commit` with `Unable to create .git/index.lock`: there, `index`, `HEAD`, `ORIG_HEAD` and `COMMIT_EDITMSG` live in the git directory's root, and git writes each as `<name>.lock` beside it and renames it into place, which needs the root itself writable.

## Decision

Under `gitGuard: "bind"`, a machine's git directory is mounted read-only, `.git` itself included, so it is a mount point that cannot be renamed or replaced.
Read-write over it, and nothing else:

- `objects/`, with `objects/info/` read-only again over it, since `objects/info/alternates` names where git reads objects from;
- `refs/` and `logs/`, where a commit moves a branch and appends its reflog;
- the session's own worktree entry `worktrees/<name>/`, which holds its `HEAD`, `index`, `ORIG_HEAD`, `COMMIT_EDITMSG`, its own `refs/` and `logs/`, with its `commondir`, `gitdir` and `config.worktree` bound read-only again over it.

A session on a main checkout is the one exception: its per-worktree files (`index`, `HEAD`, `ORIG_HEAD`, `COMMIT_EDITMSG`, `FETCH_HEAD`, `MERGE_*`, `AUTO_MERGE`) live in the git directory's root, and git writes each as `<name>.lock` there and renames it over, so for that session only the root is writable, with read-only binds pinned over `commondir` (holding `.`, which points git at the directory itself; an empty one breaks git), `config.worktree` (empty), `config`, `packed-refs`, `info/`, `hooks/`, `worktrees/` and `objects/info/`, each made on the host first where missing.
`worktrees/` and `objects/info/` are pinned for the same reason as the names above them and one level down: a sibling worktree's `commondir` is a file a machine could rewrite to point that worktree at a directory of its own, whose `config` sets `core.fsmonitor` and is run by the host user's next git there, and `objects/info/alternates` names where git reads objects from.
Both are read-only in a linked worktree already, and a main checkout pins them with the rest.

For every other session, everything else stays read-only: the root and every file in it (`config`, `packed-refs`, `shallow`, and any `commondir` or `config.worktree` an agent would create there), `info/`, `hooks/`, `modules/`, `remotes/`, `branches/`, and every other worktree's entry.
Whatever of these is missing and is bound on its own is made on the host first, as today.

Source: Softov, 2026-10-06, asked "How should a machine's git directory be guarded, given the commondir hole?" and chose "Allowlist writable". For a main checkout he was asked "Under the git allowlist, a machine on a main checkout can read git but cannot add, commit or checkout. Keep that?" and answered "Also allow the root index", then "For a session on a main checkout to commit, the git directory's root must be writable. How?" and answered "Writable root, pinned files". The list itself is `(defaulted: what git 2.47 writes for add, commit and checkout in a linked worktree, read from the layout and checked by hand)`; its last two main-checkout names, `worktrees/` and `objects/info/`, came from his review of 2026-10-06, which reproduced the sibling worktree's `commondir` with git 2.47.3, and are under host/65 p2.

## Consequences

- What git on the host reads for config or paths cannot be written in a machine, whatever a later git adds to that set, because only named data directories are writable.
- In a linked worktree, `add`, `commit`, `checkout`, `switch`, `reset` and `stash` work; deleting a packed branch, `git gc`, `git worktree add` and changing the config do not, and a commit prints the `packed-refs.lock` error.
- A session on a main checkout (at the repository's root, or in a folder below it, with no worktree) can `add`, `commit` and `checkout`, because its git directory's root is writable.
- Residual risk: a new file an agent creates in that root is one a later git might read, as `commondir` and `config.worktree` were; the pinned files close the names known today, and `remotes/` and `branches/`, which an older git reads remotes from, are among the names not pinned.
- `gitGuard: "open"` is unchanged: no read-only binds.

## Options

- **Keep the denylist and add `commondir`, `config.worktree` and `info/` to it.** Lost: Softov chose the allowlist; a denylist has to know every file git reads, now and in later versions.
- **Mount nothing of the git directory, and commit on the host.** Lost: git in the machine is the reason p7 exists.

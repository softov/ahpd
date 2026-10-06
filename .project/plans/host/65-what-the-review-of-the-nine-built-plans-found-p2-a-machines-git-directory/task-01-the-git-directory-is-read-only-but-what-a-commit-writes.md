---
title: The git directory is read-only but what a commit writes
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/gitdir.ts#L115-L150](../../../../packages/computer/src/gitdir.ts#L115-L150) - `gitMounts`"
  - "[code://packages/computer/src/gitdir.ts#L170-L174](../../../../packages/computer/src/gitdir.ts#L170-L174) - `guardedMounts`, which leaves `.git` unmounted for a root session"
  - "[code://packages/computer/test/computer-disposable.test.ts#L1366-L1515](../../../../packages/computer/test/computer-disposable.test.ts#L1366-L1515) - the cases that pin today's binds"
  - "[code://docs/COMPUTER.md#L435](../../../../docs/COMPUTER.md#L435) - what the docs say is read-only"
  - "[code://docs/COMPUTER.md#L580](../../../../docs/COMPUTER.md#L580) - a mounted git directory"
---

## Objective

Under `gitGuard: "bind"`, the git directory is mounted read-only, `.git` itself included, with read-write binds over it for `objects/` (and `objects/info/` read-only again), `refs/`, `logs/` and the session's own worktree entry (its `commondir`, `gitdir` and `config.worktree` read-only again), and, for a session on a main checkout only, the git directory's root read-write with `commondir` (holding `.`), `config.worktree`, `config`, `packed-refs`, `info/` and `hooks/` bound read-only over it, as decision [a-machines-git-directory-is-read-only-but-what-a-commit-writes](../../../decisions/a-machines-git-directory-is-read-only-but-what-a-commit-writes.md) says.

## Files

- `UPDATE: packages/computer/src/gitdir.ts:115-150` - the binds above; today the git directory is `readOnly: false` (line 127) with `hooks/`, `config`, `worktrees/` and `modules/` read-only over it, so the machine can write `<gitDir>/commondir` naming a directory whose `config` sets `core.fsmonitor`, and the host user's next git in the main checkout runs it. The same holds for `config.worktree` with `extensions.worktreeConfig`, `core.hooksPath` and `core.pager`.
- `UPDATE: packages/computer/src/gitdir.ts:170-174` - `guardedMounts` mounts the git directory read-only whether or not the tree holds it; today a root session gets no mount for `.git`, so `.git` is not a mount point and `mv .git .old && mkdir .git` replaces it with a directory the agent fills (finding B5).
- `UPDATE: packages/computer/src/gitdir.ts:1-11,97-114` - the comments say what is writable rather than what is closed.
- `UPDATE: packages/computer/test/computer-disposable.test.ts:1366-1515` - the cases below; the cases pinning today's order change with them.
- `UPDATE: docs/COMPUTER.md:435,580` - what is writable, what git cannot do in a machine (deleting a packed branch, `gc`, `worktree add`, the config), the `packed-refs.lock` line a commit prints, and that a main checkout's root is writable with six paths pinned.

## Steps

1. Failing cases first, on `gitMounts` and `guardedMounts`: the first bind is the git directory with `readOnly: true`, in a worktree session and in a root session; there is no writable bind whose path is the git directory's root or any file in it. Today the first is `readOnly: false` and a root session has no git directory bind at all.
2. A docker-backed case beside `computer-parts-mount.test.ts`'s, skipped where Docker is not: a machine on a linked worktree commits, and `touch <gitDir>/commondir`, `touch <gitDir>/config.worktree`, `touch <gitDir>/info/attributes` and `mv <root>/.git <root>/.old` all fail in it. Today the `touch` of `commondir` succeeds.
3. Make `logs/`, `objects/info/` and every other directory that is bound on its own on the host first, as `hooks/` is today; refuse a symbolic link among them, as today.
4. Order the binds so each read-only bind comes after the read-write one it sits inside.
5. A main checkout: a case that the root is writable and the six pinned paths are read-only, each made on the host first where missing (`commondir` written as `.`, `config.worktree` empty), and a docker-backed case that `git add` and `git commit` work there while `touch <gitDir>/commondir` fails.
6. `gitGuard: "open"` is unchanged.

## Validation

- The cases in steps 1 and 2 fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/computer/test/computer-disposable.test.ts packages/computer/test/computer-devcontainer.test.ts`.
- By hand: `git commit` in a worktree session's machine lands on the host's branch.

## Resume

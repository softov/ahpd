---
title: The git watch sees the checked-out branch move, not only the index and HEAD
status: done
depends: [task-06-the-git-watch-closes-with-its-directory.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L1016-L1133](../../../../packages/sdk/src/changes.ts#L1016-L1133) - the source's `watch`, which covers the index, `HEAD`, the branch's ref and `packed-refs`"
---

## Objective

A ref that moves without the index or `HEAD` being written, as `git reset --soft HEAD~1` or `git commit --allow-empty` in another program does, moves the uncommitted changeset like a staging does.

## Files

- `UPDATE: packages/sdk/src/changes.ts:1016-1133` - the watch also covers the checked-out branch's ref and `packed-refs`.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the case below.

## Steps

1. Find the branch with `git symbolic-ref -q HEAD` (nothing on a detached `HEAD`) and the directory refs live in with `git rev-parse --git-common-dir`, since a worktree keeps its `index` and `HEAD` in its own git directory and its refs in the common one.
2. Watch the directory that holds the branch's ref file (`refs/heads/` or a subdirectory of it for a name with `/`), non-recursively, firing on the ref's own name, and the common directory for `packed-refs`.
3. When `HEAD` fires, read the branch again and move the ref watch if it changed.
4. Every watch goes through the same debounce and the same stop function, and each gets the error handling of task 06.

## Validation

- `changes-refresh.test.ts`: a host watching the uncommitted changeset of a repository with one staged file, then `git commit -m x` followed by `git reset --soft HEAD~1` run outside the host, and the changeset shows the file staged again without any other trigger.
  Also `git commit --allow-empty -m y` moves the changeset's summary or operations when it changes them.
  Today the reset arrives only if it also rewrote the index.
- A branch named `feature/x`: the watch is on `refs/heads/feature/`.
- A linked worktree: its ref watch is in the common directory.
- `node_modules/.bin/vitest run packages/sdk/test/changes-refresh.test.ts` green; `pnpm typecheck` green.

## Resume

Implemented 2026-09-27. The source's `watch` reads the checked-out branch with `git symbolic-ref -q HEAD` and the refs' directory with `git rev-parse --path-format=absolute --git-common-dir`. It watches the git directory for `index` and `HEAD`, the directory holding the branch's ref file, which is `refs/heads/feature/` for `feature/x`, and the common directory for `packed-refs` where that is a different directory. When `HEAD` fires it reads the branch again and moves the ref watch only if it changed, so a checkout follows. Every handle goes through the one debounce, the one stop and its own `error` listener.

The branch-move case failed first: after `git reset --soft HEAD~1` nothing arrived, because only the index and `HEAD` were watched and that reset writes neither. It passes now, and the same case shows `git commit --allow-empty` taking the staged file and clearing the changeset. The `feature/x` case asserts the watch on `join(gitDir, 'refs', 'heads', 'feature')`, and the linked-worktree case asserts the ref watch under the common directory while `index` and `HEAD` stay under the worktree's own. `changes-refresh.test.ts` has 13 cases green.

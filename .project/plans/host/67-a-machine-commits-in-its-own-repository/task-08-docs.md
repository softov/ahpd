---
title: COMPUTER.md says how a machine commits
status: todo
depends: [task-05-the-work-comes-back-when-it-matters.md, task-06-the-machine-follows-the-hosts-branch.md, task-07-a-machine-made-under-bind-is-replaced.md, task-09-a-profile-can-give-a-machine-a-copy-of-the-folder.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md#L344](../../../../docs/COMPUTER.md#L344) - the `gitGuard` row"
  - "[code://docs/COMPUTER.md#L435](../../../../docs/COMPUTER.md#L435) - a worktree brings its repository"
  - "[code://docs/COMPUTER.md#L580](../../../../docs/COMPUTER.md#L580) - a mounted git directory"
---

## Objective

The docs say that a machine commits in a git directory of its own, that the commit reaches the host's branch when the turn ends, when it waits under `refs/ahpd/machines/`, what `fetch` and `open` are, what `sessionTree: "copy"` changes and what the changes view shows under it, that `bind` is read as `fetch`, and what does not work in a machine: `git push`, submodules, filter drivers such as LFS, and a repository whose objects have alternates.

## Files

- `UPDATE: docs/COMPUTER.md:344` - the `gitGuard` row, and a `sessionTree` row beside it.
- `UPDATE: docs/COMPUTER.md:435` - the paragraph rewritten for `fetch`.
- `UPDATE: docs/COMPUTER.md:580` - the security note: nothing of the host's git directory is writable under `fetch`, and a link in it refuses a session.

## Steps

1. Rewrite the three places; short, one sentence per line.

## Validation

- Read against the built behaviour and the tests of tasks 02-07 and 09; no claim the tests do not show.

## Resume

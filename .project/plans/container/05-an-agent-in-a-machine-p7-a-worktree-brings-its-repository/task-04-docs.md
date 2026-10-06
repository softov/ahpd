---
title: The docs say a worktree session commits from inside
status: done
depends: [task-03-the-machine-cannot-change-what-git-runs-on-the-host.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - \"Disposable machines\""
---

## Objective

`docs/COMPUTER.md` says a session's worktree and its repository's git directory are mounted, and what that lets a machine write.
It says a machine with a git directory mounted runs its commands as the host user's uid:gid, so the image's own user is not used there.

## Files

- `UPDATE: docs/COMPUTER.md`.

## Steps

1. One paragraph under Disposable machines, and one line under Security.

## Validation

- Read by hand against the code.

## Resume

- Built 2026-10-06 on 08f046b.
- `docs/COMPUTER.md`: a paragraph under Disposable machines and one under Security, read against the code.
- Fix turn 2026-10-06: `gitGuard` in the Profiles table and the Disposable machines paragraph, and a Security paragraph saying to review a session's changes before running git on them, and why.

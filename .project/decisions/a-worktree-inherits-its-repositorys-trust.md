---
title: A worktree the host made is trusted when its repository is
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/repo/worktrees.ts#L46-L49](../../packages/sdk/src/repo/worktrees.ts#L46-L49) - `worktreesOf`, which puts the worktree beside the repository"
  - "[code://packages/sdk/src/host/spawn.ts#L441-L443](../../packages/sdk/src/host/spawn.ts#L441-L443) - `trustedBy`, which reads a worktree as its repository"
  - "[code://packages/sdk/src/host/lifecycle.ts#L644-L655](../../packages/sdk/src/host/lifecycle.ts#L644-L655) - `moveSession`, which asks about the repository alone"
  - git://fb1f022 - the build this was found in
---

## Context

An isolated session runs in `<repo>.worktrees/<branch>`, which is beside the repository and never under it.
A window's `trustedUris` names the repository and not the worktree, so the worktree was a folder nobody had vouched for.
The host asked the window about it and named the repository as `trustedParent`.

## Decision

A worktree the host made is trusted exactly when the repository it was cut from is, and no window is asked about the worktree.
A move asks about the repository only when the folder the move names is not the repository.

Source: Softov, 2026-10-06, asked "A worktree session lives at `<repo>.worktrees/<branch>`, so it is never under the trusted repo. How should its trust be decided?" and chose "Inherit from its repository".

## Consequences

- One question per move, about a folder a window has or can name, and none about a folder only the host has seen.
- A backend started in the worktree is told the repository's answer, which the host keeps on the connection that answered.
- Isolation never widens a session's reach: a repository nobody trusted makes an untrusted worktree.

## Options

- **Ask the window about the worktree.** Lost: the window cannot vouch for a path only the host has seen.
- **A worktree is untrusted.** Lost: an isolated session would load no project file even where the repository is trusted.

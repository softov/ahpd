---
title: Worktrees can live under one root, as an option beside the reference's default
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/repo/worktrees.ts#L31-L41](../../packages/sdk/src/repo/worktrees.ts#L31-L41) - `worktreesOf`, `<repo>.worktrees` beside the repository"
  - "[code://packages/sdk/src/host/lifecycle.ts#L612](../../packages/sdk/src/host/lifecycle.ts#L612) - the one place a session's worktree path is made"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/worktreePaths.ts#L11-L20 - the reference fixes the location at `<repo>.worktrees` and offers no setting
---

## Context

A session made with `isolation: worktree` gets its tree at `<repo>.worktrees/<name>`, beside the repository, which is where VS Code's agent host puts it too.
On a machine with many repositories under one folder, that is one extra `<repo>.worktrees` folder beside each of them.
Softov keeps his Claude Code worktrees under `/github/.worktrees/<repo>/<name>` and wants ahpd's in the same place.

## Decision

The host takes an optional worktrees root; with it, a session's tree is `<root>/<repo>/<name>`, where `<repo>` is the repository folder's name.
Left out, the tree stays at `<repo>.worktrees/<name>`, the reference's location.
The daemon sets it from `worktreesRoot` in its config file or `--worktrees-root <dir>`.

Source: Softov, 2026-10-06, asked "Should ahpd move to /github/.worktrees too?" and chose "Plan an option": a configurable worktrees root, the default staying `<repo>.worktrees`.

## Consequences

- A tree made under a root is not where VS Code's host would look for it, so a worktree one of them makes is found by the other only at the default location.
- Two repositories with the same folder name share `<root>/<repo>`; their session branches differ, so their trees do, and git refuses a path already taken. (defaulted: the folder name rather than a slug of the whole path, so the layout matches `/github/.worktrees/<repo>/<name>`.)
- A tree made before the root changed stays where it was made, since a session keeps the path it was given.

## Options

- **Fixed `/github/.worktrees` for every repository.** Lost: every install would get one machine's layout.
- **Leave ahpd as it is.** Lost: Softov's worktrees would sit in two layouts.

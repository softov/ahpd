---
title: The commit operation commits the index when anything is staged, and everything when nothing is
status: accepted
date: 2026-09-27
refs:
  - "[code://packages/sdk/src/changes.ts#L121-L129](../../packages/sdk/src/changes.ts#L121-L129) - `COMMIT`, described as committing the working tree"
  - file:///github/externals/vscode - `src/vs/platform/agentHost/node/agentHostGitService.ts` `commitAll`: the reference host always runs `git add -A -- :/` before committing
---

## Context

The reference host's `commit` stages the whole working tree with `add -A` and commits it, whatever the index held.
VS Code's session view has no staging: it lists one changeset per kind and never reads a staging mark on a file.
VS Code's own Source Control view on the same folder stages and unstages files in git's index.

## Decision

`commit` on an `uncommitted` changeset runs `git commit` on the index as it is when the index holds any change.
When the index holds none, it stages everything with `add -A`, untracked files included, and commits it all.
Its confirmation says which of the two it will do.

Source: Softov, 2026-09-27, asked "What should ahpd's Commit take when you have already staged something (in VS Code's Source Control)?": "Staged if any".

## Consequences

A person stages in VS Code's Source Control and commits from the session, and exactly what they staged is committed.
With nothing staged the operation behaves as the reference host's.
A client that sends a file selection in `_meta` has nothing to select with: staging is the selection.

## Options

- **Always everything, as the reference host**: parity, but what a person staged by hand is swept in with the rest.

---
title: Changesets and git and GitHub facts are files of their own, and the repository ports live in repo/ - implemented
---

## What exists

- `host/changesets.ts` and `host/facts.ts` hold changesets and the git, GitHub, pull request and artifact facts; `git.ts`, `github.ts` and `worktrees.ts` are in `packages/sdk/src/repo/`, as renames with only their import paths changed.

## Verified

- A pure move: every line removed from `host.ts` reappears in `packages/sdk/src/host/` (an `export`, a `ctx.` prefix or a reflowed comment aside).
- After rebasing onto main: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2672 tests) pass. `host.ts` is 8,871 lines after p1-p4, from 11,658.

## Departures

- The build session could not delete files, so the three originals were removed by the reviewer.

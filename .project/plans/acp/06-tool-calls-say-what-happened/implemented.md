---
title: Tool calls say what happened, and an agent's edits reach review - implemented
date: 2026-10-02
---

A call is readied only once the agent starts it, keeps its arguments from whichever update carried them, closes even when it arrives finished, and is never marked as needing no approval while a person is asked; terminal and diff content reach the call, and an agent's write or diff reaches the turn's changeset with its before side.

## What was built

- `packages/agent-acp/src/mapping.ts` - the shared completion branch, held input, the `asked` flag; `session.ts` - `askPermission` registers its call, `writeTextFile` awaits both sides; `packages/sdk` - the before text a diff carries.
- `agent-acp-turn.test.ts` and `agent-acp-ports.test.ts` cases; `docs/PLUGINS.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 166 files and 2488 tests, twice, after the rebase onto main.
- Read against the plan and reviewed by one reader per plan; the defects found were fixed in the same worktree before close.

## Departures from the plan

- Review fixed a call arriving finished, arguments lost while pending, a late `not-needed`, an edit shown as a new file, and the before read racing the write.

## Left for later

- none.

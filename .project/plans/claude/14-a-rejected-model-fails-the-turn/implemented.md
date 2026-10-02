---
title: A model the CLI rejects fails the turn that asked for it - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `beginTurn`, `take`, `refuseTurn`, `busy`"
---

A turn naming a model the CLI refuses ends with `The harness would not take model <id>: <reason>`, sends nothing, and leaves the session on the model it was on.

## What was built

- `beginTurn` is async and awaits `setModel` before the turn is built or its prompt goes out; `chosen` moves only when the CLI takes the model.
- `refuseTurn` is the started-then-failed turn, shared with the exited-CLI path.
- `beginning` marks a turn waiting on its switch, and `busy()` (that or `active`) is what `startNext`, a typed `!command` and `resume` ask, so nothing starts beside a switching turn.
- A refused turn calls `startNext`, so the queue goes on.

## Verified

- `packages/agent-claude/test/agent-claude-model-refusal.test.ts`: a refused model, an accepted one, and a message queued during a slow switch held until the turn ends; the last fails with the old `active`-only guard.
- `pnpm exec tsc --noEmit` clean; `pnpm test` 140 files, 2079 tests passed; `pnpm boundary` clean.

## Departures from the plan

- The first build serialised switches on a promise chain; review found a queued turn naming no model could still pass it, so the chain became the `beginning` marker.

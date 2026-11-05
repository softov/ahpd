---
title: A background row outlives its turn - implemented
date: 2026-11-04
refs:
  - git://16bf971c
  - "[code://packages/agent-claude/src/session/workers.ts](../../../../packages/agent-claude/src/session/workers.ts)"
---

A Claude session keeps a row for each background task that still runs after the turn that started it ends. A stop of one shell, or one shell that ends, removes only that shell's row.

## What was built

- [`code://packages/agent-claude/src/session/workers.ts`](../../../../packages/agent-claude/src/session/workers.ts) - `TaskInfo` keeps `chat` and `command`, read while the task's call is open, and a later reconcile uses them. A `task_started` for the same call keeps them.

## Verified

- `agent-claude-background-work.test.ts` has two cases that end the turn with two shells running. Both fail without the change.
- The gates passed on 2026-11-04: sdk 4209 tests, agent-claude 547. #221 merged with CI green.
- Softov ran `claude-0745-background-row-checks.md` on 2026-11-04, and it passed.

## Departures from the plan

- None.

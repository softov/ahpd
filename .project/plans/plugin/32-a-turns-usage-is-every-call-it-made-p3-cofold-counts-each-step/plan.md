---
title: cofold counts each step, and sends the run's cost
domain: plugin
status: planned
priority: high
created: 2026-10-01
revalidated: 2026-10-01
requires:
  - plans/plugin/32-a-turns-usage-is-every-call-it-made/plan.md
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L308-L329](../../../../packages/agent-cofold/src/mapping.ts#L308-L329) - `model.completed` used for text only; its comment says step usage is not there, which is wrong"
  - "[code://packages/agent-cofold/src/mapping.ts#L566-L581](../../../../packages/agent-cofold/src/mapping.ts#L566-L581) - `run.finished` sends `outcome.usage`, never `outcome.cost`"
  - npm://@cofold/agents@^0.1.2 - `model.completed { usage }` per step; `RunTally.cost` on the outcome when the model has pricing
---

## Goal

Each cofold step adds its usage to the turn and sends the running total; `run.finished` sends the run's aggregate as the final total, with `outcome.cost` when present.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Running total per call, cost in `_meta.cost` | [plugin 32](../32-a-turns-usage-is-every-call-it-made/plan.md) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - cofold counts each step](task-01-steps.md) | todo | - |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-steps.md](task-01-steps.md).
- **Open questions:** none.
- **Watch out for:** awaiting and cancelled outcomes send no final usage today (`mapping.ts` 573-578); the running totals already sent stand.

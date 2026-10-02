---
title: cofold counts each step
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L308-L329](../../../../packages/agent-cofold/src/mapping.ts#L308-L329) - the step event"
  - "[code://packages/agent-cofold/src/mapping.ts#L566-L581](../../../../packages/agent-cofold/src/mapping.ts#L566-L581) - the run's end"
---

## Objective

`model.completed` adds its `usage` to the turn's sum and sends it; `run.finished` sends `outcome.usage` with `outcome.cost`.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:308-329` - sum `usage` per step and emit `chat/usage`; correct the comment.
- `UPDATE: packages/agent-cofold/src/mapping.ts:566-581` - add `outcome.cost` as `_meta.cost`.

## Steps

1. Read `RunTally.cost` in `@cofold/agents` to find its currency; USD unless it says otherwise.

## Validation

- new `packages/agent-cofold/test/agent-cofold-usage.test.ts`: two steps send two growing totals; `run.finished` sends the aggregate with cost.
- `pnpm -F @ahpd/agent-cofold test`.

## Resume

---
title: cofold counts each step
status: done
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

- **Done so far:** 2026-10-01. `model.completed` adds the step's `usage` to a `spent` total held per turn in `mapTurn` and sends it as `chat/usage`; `run.finished` sends `outcome.usage` with `outcome.cost` as `_meta.cost`. `usageOf` grew a third `cost` argument and its comment now names the cost beside the cache write and the reasoning tokens.
- **Next action:** nothing in this task. p4 is the other half of the parent plan.
- **Open questions:** none.
- **Watch out for:**
  - The sum is cofold's own `addUsage`, exported from `@cofold/agents`, rather than a hand-rolled total, so the running total and the run's `RunTally.usage` are summed by the same rules and cannot drift.
  - The currency is USD and nothing else: `ModelPricing.currency` is the literal type `'USD'` and `costOf` returns a plain number, so the amount is a dollar figure with no conversion anywhere in the path.
  - `cost` rides `_meta` and is absent, not zero, when the adapter has no `pricing`. A zero would read as a call that was free.
  - Steps send counts only. The cost is the run's own tally and arrives once, at `run.finished`; a mid-turn total has nothing to price it with.
  - `mapTurn` is built once per turn, so the total starts from nothing on the next turn with nothing extra to reset. The resume path at `session.ts` 1049 replays a run's events through the same mapping, so the total rebuilds as the replay goes and the resumed turn ends on the whole of it.
  - Awaiting and cancelled outcomes still send no final total (`mapping.ts` 574-580). The running totals already sent stand, as the plan said they would.
- **Tests:** `packages/agent-cofold/test/agent-cofold-usage.test.ts` - a two-step turn sends three growing totals (one per step, one for the run) and the last `chat/usage` goes out before `chat/turnComplete`; the run's total carries `cost: { amount, currency: 'USD' }` and the steps' totals carry none; an unpriced adapter sends no `_meta` at all; a second turn counts from nothing rather than on the first turn's use. `pnpm -F @ahpd/agent-cofold test` - 13 files, 156 tests, all passing. `pnpm typecheck` clean.
- **The plan did not know:** `packages/agent-cofold/test/agent-cofold-approval.test.ts` fails on a clean checkout with `ENOENT: tools/ahp.strict.schema.json`. That file is generated, and the root `pnpm test` runs `node tools/schema.mjs` first while the package's own `test` script does not. `pnpm schema` before the package test makes it pass; nothing to do with this change.

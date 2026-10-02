---
title: cofold counts each step, and sends the run's cost - implemented
date: 2026-10-01
refs:
  - git://usage-p3-cofold - the branch it was built on
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts)"
---

A cofold turn now sends a running usage total after each step, from `model.completed.usage`, and ends on the run's own tally with `outcome.cost` in USD when the adapter has a price row.

## What was built

- [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts) - the turn's `spent`, summed with cofold's `addUsage` per step and sent; `usageOf` carries the cost in `_meta.cost`.
- [`code://packages/agent-cofold/test/agent-cofold-usage.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-usage.test.ts) - four cases through a real host with a scripted adapter.

## Verified

- Root `pnpm test`: 130 files, 1953 tests passed; `pnpm exec tsc --noEmit` clean.

## Departures from the plan

- The steps send counts only: cofold prices the run, not the step, so the cost arrives once at `run.finished`, as with claude.
- A step that reports all zeros still sends a total; pi skips such a call.

## Left for later

- `pnpm -F @ahpd/agent-cofold test` alone fails `agent-cofold-approval.test.ts` on a clean checkout, because the package script does not generate `tools/ahp.strict.schema.json` first; the root `pnpm test` does.

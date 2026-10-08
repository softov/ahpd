---
title: pi sends its cost split into sent and received
status: implemented
depends: [task-01-the-meter-writes-both-costs.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L205-L240](../../../../packages/agent-pi/src/mapping.ts#L205-L240) - `addUsage`, which sums `cost.total` only"
---

## Objective

A pi turn's `_meta.cost` has `input`, the sum of pi's `cost.input`, `cacheRead` and `cacheWrite`, and `output`, pi's `cost.output`, beside the total.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts:205-240` - `addUsage` sums the two parts over the calls as it sums the total.
- `UPDATE: packages/agent-pi/test/` - the cases below.

## Steps

1. Write the tests.
2. Sum the parts. A part pi did not send stays absent.

## Validation

- A test: two calls with `cost {input: 1, cacheRead: 0.5, output: 2, total: 3.5}` give `input: 3`, `output: 4`, `amount: 7`.
- A test: a call with only `cost.total` gives the amount and no split.
- `npx vitest run packages/agent-pi` passes.

## Resume

2026-10-08. Two cases in `packages/agent-pi/test/agent-pi-usage.test.ts`, beside the four already there. Two calls priced at `{input: 1, cacheRead: 0.5, output: 2}` send `input: 3`, `output: 4` and `amount: 7`, so the sent side is pi's three sent parts added together. A call priced as a bare total sends the amount and no split. `addUsage` sums the parts the way it sums the counts, and leaves a part no call sent absent. The test helper now builds a price in pi's own shape - four parts with `total` their sum, as `models.js` computes it - and a bare number is still a call that reported a total alone.


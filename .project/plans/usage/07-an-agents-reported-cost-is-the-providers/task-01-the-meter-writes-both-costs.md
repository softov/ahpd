---
title: The meter writes a harness's cost as both costs, with its split
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/meter.ts#L97-L105](../../../../packages/sdk/src/meter.ts#L97-L105) - `costOf`"
  - "[code://packages/sdk/test/usage-meter.test.ts](../../../../packages/sdk/test/usage-meter.test.ts) - what a turn is charged"
---

## Objective

An agent record has `cost` and `providerCost`, both the harness's figure, with `input` and `output` when the harness sent them.
A harness cost of 0 on a record with no token counted is no cost.

## Files

- `UPDATE: packages/sdk/src/meter.ts:97-105` - `costOf` reads `input` and `output` from `_meta.cost` beside `amount`. A part that is not a count is left out.
- `UPDATE: packages/sdk/src/meter.ts` - where the record is built, `providerCost` is the same value as `cost`; an amount of 0 with no token counted gives neither.
- `UPDATE: packages/sdk/test/usage-meter.test.ts` - the cases below.

## Steps

1. Write the tests.
2. Read the split in `costOf`.
3. Write both costs, and drop a cost of 0 on a record with no tokens.

## Validation

- A test: `_meta.cost {amount: 1, currency: "USD", input: 0.4, output: 0.6}` gives `cost` and `providerCost` with both parts.
- A test: `_meta.cost {amount: 0}` with every token count 0 gives no cost.
- A test: `_meta.cost {amount: 0}` with tokens gives a cost of 0.
- `npx vitest run packages/sdk` passes.

## Resume

2026-10-08. The four cases are in `packages/sdk/test/usage-meter.test.ts`, beside the fourteen already there. A harness cost of `{amount: 1, currency: "USD", input: 0.4, output: 0.6}` is written as `cost` and `providerCost`, both the harness's figure with both parts. A part that is not a count is left out. A cost of 0 on a turn that counted no token gives neither cost, and a cost of 0 on a turn that counted tokens is kept as 0. `costOf` reads the split, and the record is built from one value shared by both fields.


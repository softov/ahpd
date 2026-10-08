---
title: A record and a total carry both costs and their split
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/usage.ts#L21-L29](../../../../packages/sdk/src/types/usage.ts#L21-L29) - `Cost`"
  - "[code://packages/sdk/src/types/usage.ts#L50-L51](../../../../packages/sdk/src/types/usage.ts#L50-L51) - `UsageBase.cost`"
  - "[code://packages/sdk/src/types/usage.ts#L90-L111](../../../../packages/sdk/src/types/usage.ts#L90-L111) - `UsageTotal`"
  - "[code://packages/sdk/src/usage.ts#L22-L33](../../../../packages/sdk/src/usage.ts#L22-L33) - `Measured` and `none`"
  - "[code://packages/sdk/src/usage.ts#L118-L144](../../../../packages/sdk/src/usage.ts#L118-L144) - `measured`"
  - "[code://packages/sdk/src/usage.ts#L261-L293](../../../../packages/sdk/src/usage.ts#L261-L293) - the range total"
---

## Objective

A record has `cost`, what its pools are charged, and `providerCost`, what the provider or harness reported.
Each `Cost` can say what was sent and what was received.
A total has `providerUsd`, `inputUsd` and `outputUsd` beside `usd`.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts:21-29` - `input?` and `output?` on `Cost`, the amounts for sent and received, each with a one-line comment. `from` stays.
- `UPDATE: packages/sdk/src/types/usage.ts:50-51` - `providerCost?: Cost` beside `cost`. The comment on `cost` says it is what the pools are charged.
- `UPDATE: packages/sdk/src/types/usage.ts:90-111` - `providerUsd?`, `inputUsd?` and `outputUsd?` on `UsageTotal`.
- `UPDATE: packages/sdk/src/usage.ts` - `Measured`, `none`, `measured`, the per-day charge and the range total carry the three amounts.
- `UPDATE: packages/sdk/test/usage.test.ts` - the cases below.
- `UPDATE: generated schema` - rerun `node tools/schema.mjs`.

## Steps

1. Write the tests.
2. Add the fields.
3. In `measured`, `providerUsd` reads `providerCost`.
   An old record has no `providerCost`: its cost with `from: "harness"` counts as the provider's.
4. `inputUsd` and `outputUsd` read `cost.input` and `cost.output` in US dollars. A record with no split adds nothing to them.
5. A measure that is zero is absent from the total, as every other measure is.

## Validation

- A test: a record with `cost {amount: 3, input: 1, output: 2}` and `providerCost {amount: 2}` gives `usd: 3`, `inputUsd: 1`, `outputUsd: 2`, `providerUsd: 2`.
- A test: an old record with `cost {from: "harness", amount: 1}` and no `providerCost` gives `usd: 1` and `providerUsd: 1`.
- A test: an old record with `cost {from: "price", amount: 1}` gives `usd: 1` and no `providerUsd`.
- A test: a record with no cost gives no `usd` and no `providerUsd`.
- `pnpm build`, `pnpm typecheck` and `npx vitest run packages/sdk` pass.

## Resume


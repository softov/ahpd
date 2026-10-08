---
title: The proxy reads the provider's cost and never prices a missing side as 0
status: implemented
depends: [task-01-a-record-and-a-total-carry-both-costs.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/dialects.ts#L153-L230](../../../../packages/server/src/proxy/dialects.ts#L153-L230) - `openaiUsage`, `anthropicUsage`, `usageIn` and `usageReader`"
  - "[code://packages/server/src/proxy/listener.ts#L225-L238](../../../../packages/server/src/proxy/listener.ts#L225-L238) - `costOf`"
  - "[code://packages/server/src/proxy/listener.ts#L655-L690](../../../../packages/server/src/proxy/listener.ts#L655-L690) - `record`"
  - "[code://packages/server/src/proxy/providers.ts#L40-L56](../../../../packages/server/src/proxy/providers.ts#L40-L56) - `ModelPrice`"
  - "[code://docs/PROXY.md#L103](../../../../docs/PROXY.md#L103) - what a proxy record holds"
---

## Objective

A proxy record has `providerCost` when the provider reported a cost.
Its `cost` comes from the entry's price, else from the provider.
A price side with no value never charges as 0.

## Files

- `UPDATE: packages/server/src/proxy/dialects.ts:153-230` - the reader keeps a cost beside the tokens: `usage.cost` as the amount, and `cost_details.upstream_inference_prompt_cost` and `upstream_inference_completions_cost` as `input` and `output`. `UsageReader` gains `cost(): Cost | undefined`. Both dialects read it, because OpenRouter sends it in both.
- `UPDATE: packages/server/src/proxy/listener.ts:225-238` - `costOf` returns a `Cost` with `input` and `output`. It returns nothing when a side has tokens and its price is absent.
- `UPDATE: packages/server/src/proxy/listener.ts:655-690` - `record` writes `providerCost` from the reader, and `cost` from the price, else from the provider with `from: "harness"`.
- `UPDATE: packages/server/test/` - the proxy usage tests, with the cases below.
- `UPDATE: docs/PROXY.md:103` - a record's two costs, and the rule between them.

## Steps

1. Write the tests, from the OpenRouter answer in the plan's searches.
2. Read the cost in the usage reader. A non-number or a negative amount is not a cost.
3. Fix `costOf`: `input` is the sent tokens, cache included, times `price.input`; `output` is the received tokens times `price.output`. A side with tokens and no price makes the whole cost absent.
4. Write the two costs in `record`.

## Validation

- A test: provider cost, no price - `cost` and `providerCost` both hold the provider's figure and split.
- A test: provider cost and a price - `cost` is the price's result with `from: "price"`; `providerCost` is the provider's.
- A test: a price, no provider cost - `cost` only.
- A test: neither - no cost.
- A test: `price: {output: 2}` and a call with input tokens - no `cost`.
- A test: `price: {input: 0, output: 0}` - `cost.amount` is 0.
- A test: the proxy reads `usage.cost` from the last chunk of a streamed OpenRouter answer.
- `npx vitest run packages/server` passes.

## Resume

Every case the validation names is in `packages/server/test/proxy-policy-usage.test.ts`, over the OpenRouter answer the plan's reconnaissance read. A provider cost with no price puts the provider's figure and split in both `cost` and `providerCost`. A price beside a provider cost puts the price in `cost` with `from: "price"` and the provider's figure in `providerCost`. A price with no provider cost gives `cost` alone. Neither gives no cost at all. `price: {output: 2}` and a call with input tokens gives no `cost`, and `price: {input: 0, output: 0}` gives an amount of 0. One case reads `usage.cost` out of the last chunk of a streamed answer.

`costIn` in `packages/server/src/proxy/dialects.ts` reads `usage.cost` as the amount and `cost_details.upstream_inference_prompt_cost` and `upstream_inference_completions_cost` as `input` and `output`, in either dialect. `UsageReader` gained `cost(): Cost | undefined`, and `usageReader` keeps the cost beside the tokens, later report wins. `costOf` in `packages/server/src/proxy/listener.ts` returns a `Cost` with `input` and `output` and nothing when a side has tokens and its price is absent. `record` writes `providerCost` from the reader and `cost` from the price, else from the provider with `from: "harness"`. `docs/PROXY.md` names both costs and the rule between them.

Found: `costOf` reads the cache counts as sent tokens at the input price. It returns nothing when a side with tokens has no price. `price: {input: 0, output: 0}` stays a real cost of 0, because that side is priced and free.


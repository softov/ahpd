---
title: A usage record keeps the provider's cost beside the cost it charges, each split into sent and received
domain: usage
status: planned
priority: high
created: 2026-10-07
revalidated: 2026-10-07
requires:
  - plans/usage/05-a-total-says-tokens-sent-and-received/plan.md
changes: []
creates: []
decisions:
  - decisions/a-record-keeps-the-providers-cost-beside-the-charged-one.md
refs:
  - "[code://packages/sdk/src/types/usage.ts#L21-L29](../../../../packages/sdk/src/types/usage.ts#L21-L29) - `Cost`, one amount and `from`"
  - "[code://packages/sdk/src/types/usage.ts#L50-L51](../../../../packages/sdk/src/types/usage.ts#L50-L51) - `UsageBase.cost`"
  - "[code://packages/sdk/src/types/usage.ts#L90-L111](../../../../packages/sdk/src/types/usage.ts#L90-L111) - `UsageTotal`, with `usd` only"
  - "[code://packages/sdk/src/usage.ts#L118-L144](../../../../packages/sdk/src/usage.ts#L118-L144) - `measured`, which reads `cost` into `usd`"
  - "[code://packages/server/src/proxy/listener.ts#L225-L238](../../../../packages/server/src/proxy/listener.ts#L225-L238) - `costOf`, which prices a missing side as 0"
  - "[code://packages/server/src/proxy/listener.ts#L655-L690](../../../../packages/server/src/proxy/listener.ts#L655-L690) - `record`, which writes the price as the only cost"
  - "[code://packages/server/src/proxy/dialects.ts#L153-L230](../../../../packages/server/src/proxy/dialects.ts#L153-L230) - the usage reader, which reads tokens and no cost"
  - "[code://packages/server/src/proxy/providers.ts#L40-L56](../../../../packages/server/src/proxy/providers.ts#L40-L56) - `ModelPrice` and `ModelEntry`"
  - https://openrouter.ai/docs/use-cases/usage-accounting - OpenRouter's `usage.cost` and `cost_details`
---

## Goal

A usage record keeps two costs: what its pools are charged, and what the provider reported.
Each is split into what was sent and what was received, as the tokens are.
A cost nobody reported or priced is absent, never 0.
The proxy reads the cost a provider sends, so a call through OpenRouter has a cost with no price in the configuration.

## Reconnaissance

### Searches performed

- 2026-10-07: `rg "costOf|from: 'price'" packages/server/src/proxy` - the proxy writes a cost only from `price`, and `price.input ?? 0` charges a side with no price as free.
- 2026-10-07: a call to `anthropic/claude-opus-5-5` through OpenRouter answered `usage.cost: 0.000204` with `cost_details.upstream_inference_prompt_cost: 0.000104` and `upstream_inference_completions_cost: 0.0001`. The record has no cost, because the entry has no price.
- 2026-10-07: `~/.config/ahpd/usage/2026-10-model.jsonl` - proxy records for `openai/gpt-5.5` carry `from: "price"`; none carries a provider figure.

### What each source reports

| Source | What it reports | Split |
| --- | --- | --- |
| Proxy, OpenRouter (both dialects) | `usage.cost`, dollars | `cost_details` prompt and completions |
| Proxy, OpenAI and Anthropic APIs | tokens only | - |
| Proxy, DeepSeek's API | tokens, with `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` | - |
| Claude agent | `modelUsage[model].costUSD`, cumulative; `costBasis: unknown` when the CLI has no price | none |
| pi agent | `usage.cost.total` per call | `cost.input`, `output`, `cacheRead`, `cacheWrite` |
| cofold agent | one dollar figure per turn | none |
| ACP agent | `cost {amount, currency}` from the agent's update | none |

The agents are usage/07.

### Runtime path

```
provider answer -> usageReader (tokens, and now cost) -> record: cost from price, else provider; providerCost from provider -> usage.record -> measured -> UsageTotal (usd, providerUsd, inputUsd, outputUsd)
```

### Gaps

- `Not found: a provider-reported cost in the proxy - searched "cost" in packages/server/src/proxy/dialects.ts`.
- `Not found: a second cost on a record - searched "cost" in packages/sdk/src/types/usage.ts`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A record keeps the provider's cost beside the cost it charges, and a configured price is what it charges](../../../decisions/a-record-keeps-the-providers-cost-beside-the-charged-one.md) | Softov, 2026-10-07 |

| What | Source | Task |
| --- | --- | --- |
| A missing price or cost is absent, never 0 | Softov, 2026-10-07: "no price need to be diff from 0. no prices means not informed... do not means free" | 01, 02 |
| A cost is split into sent and received | Softov, 2026-10-07: "there is also a up and down cost description" | 01, 02 |
| `usd` and the policy limits count `cost`; `providerUsd` is beside it | Softov, 2026-10-07, asked "Which amount should a pool total and a policy spending limit count?" and answered "Our cost; provider cost beside it" | 01 |
| The proxy prices only its own calls; agents keep the cost their harness reports | Softov, 2026-10-07, asked "Should agent records also get our price?" and answered "Proxy now, agents later" | 02 |
| Anthropic-dialect and DeepSeek calls are checked | Softov, 2026-10-07: "maybe needed to validated anthropic calls. deepseek ones" | 03 |
| `Cost` gains `input?` and `output?`, the amounts for what was sent and received | (defaulted: the names `ModelCall` uses for tokens) | 01 |
| `inputUsd` and `outputUsd` in a total add only the records that carry the split | (defaulted: a record with no split adds to `usd` only) | 01 |
| A price with no `input` or no `output` gives no cost when that side has tokens; a side priced at 0 is free | (defaulted: from the rule that absent is not 0) | 02 |
| Cache tokens are charged at the input price, and count as sent | (defaulted: what `costOf` does today) | 02 |
| A provider cost of 0 on a call that used tokens is kept, as a free model | (defaulted: OpenRouter reports 0 for its free models) | 02 |

## Proposed architecture

- **Data flow** - The usage reader returns `cost` beside `tokens`, read from `usage.cost` and `usage.cost_details` in either dialect. `record` sets `providerCost` from it, and sets `cost` from the price when the entry has one, else from the provider.
- **State flow** - `Measured` and the range total add `providerUsd`, `inputUsd` and `outputUsd` the way they add `usd`.
- **Layer responsibilities** - sdk: the record type and the totals · server: the proxy's reading and pricing.
- **Source-of-truth files** - [`code://packages/sdk/src/types/usage.ts`](../../../../packages/sdk/src/types/usage.ts), [`code://packages/server/src/proxy/listener.ts`](../../../../packages/server/src/proxy/listener.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A record and a total carry both costs and their split](task-01-a-record-and-a-total-carry-both-costs.md) | implemented | - |
| [02 - The proxy reads the provider's cost and never prices a missing side as 0](task-02-the-proxy-reads-the-providers-cost.md) | implemented | 01 |
| [03 - Anthropic-dialect and DeepSeek answers are checked from captured replies](task-03-anthropic-and-deepseek-answers-are-checked.md) | todo | 02 |

## Risks and tradeoffs

- Records written before this plan have one `cost`. An old cost with `from: "harness"` counts as both costs.
  An old cost with `from: "price"` counts as the charged cost only.
  Old totals keep their `usd`.
- ahpapp draws `usd` today. A plan in ahpapp draws `providerUsd` and the split; until then the new fields are unseen.

## Resume state

- **Done so far:** 2026-10-07 - task 01, where `Cost` carries `input` and `output`, `UsageBase` carries `providerCost`, and a total carries `providerUsd`, `inputUsd` and `outputUsd`. 2026-10-07 - task 02, where the proxy reads a provider's cost in both dialects and never prices a missing side as 0.
- **Next action:** [task-03-anthropic-and-deepseek-answers-are-checked.md](task-03-anthropic-and-deepseek-answers-are-checked.md). Its step 1 is the captures, which Softov runs. Task 03 waits on him.
- **Open questions:** none.
- **Watch out for:** `0` and absent are different everywhere in this plan. `?? 0` on a price or a cost is the defect being fixed. The full suite flakes on a loaded box: the machine tests in `packages/computer/test/` time out at 5 s, and each file passes on its own.

## Final verification checklist

- [x] A test for each row of the rule: provider only, price only, both, neither.
- [x] A test: a price with no `input` and a call with input tokens gives no `cost`.
- [x] `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass.
- [x] `docs/PROXY.md` says what a record's two costs are.
- [x] `plans/index.md` updated.

---
title: An agent's reported cost is kept as the provider's, and a record says nothing it was not told
domain: usage
status: planned
priority: high
created: 2026-10-07
revalidated: 2026-10-07
requires:
  - plans/usage/06-a-record-keeps-the-providers-cost-beside-ours/plan.md
changes: []
creates: []
decisions:
  - decisions/a-record-keeps-the-providers-cost-beside-the-charged-one.md
  - decisions/an-agent-says-whose-cost-report-counts.md
refs:
  - "[code://packages/sdk/src/meter.ts#L97-L105](../../../../packages/sdk/src/meter.ts#L97-L105) - `costOf`, which reads a harness's `_meta.cost`"
  - "[code://packages/agent-claude/src/session/parts.ts#L163-L190](../../../../packages/agent-claude/src/session/parts.ts#L163-L190) - Claude's cost, the change in `modelUsage` since the last `result`"
  - "[code://packages/agent-pi/src/mapping.ts#L205-L240](../../../../packages/agent-pi/src/mapping.ts#L205-L240) - pi's `addUsage`, which sums only `cost.total`"
  - "[code://packages/agent-claude/src/models.ts#L30-L39](../../../../packages/agent-claude/src/models.ts#L30-L39) - `ranOn`, which drops `<synthetic>` as a model name since 2026-10-04"
---

## Goal

An agent record keeps the cost its harness reported as both `cost` and `providerCost`, as usage/06 sets for a provider with no price.
A record says only what the harness reported.
A turn that spent nothing has no cost of 0, and a turn whose input was not counted has no input of 0.
pi's cost keeps its split into sent and received.

## Reconnaissance

### Searches performed

2026-10-07, over `~/.config/ahpd/usage/2026-10-model.jsonl`:

- `claude-deepseek-build` on `deepseek-flash`: 75 records, 16.1M in, 8.1M out, and no cost. The Claude CLI has no price for the model, so `costBasis` is `unknown` and the cost is left out. That is correct: unknown, not free.
- `claude-deepseek-build`, 2026-10-07 20:43: a record with an empty model name, every token count 0, and `cost {amount: 0}`. `costOf` in `parts.ts` returns amount 0 when no model's `costUSD` changed.
- `claude`, 2026-10-02: two `<synthetic>` records with every token count 0 and costs of $0.68 and $1.36. The name is fixed by `ranOn` (git 7cdaf4c, 2026-10-04); a cost on a turn with no tokens is not explained yet.
- `claude-openrouter` and `claude-openrouter-build`: 77 records with `input: 0` and outputs in the millions. The input was not counted, so 0 is wrong.
- `claude` on `claude-opus-5`: costs from `costUSD`. On a subscription this is what the calls would cost on the API, not money paid.

### Runtime path

```
harness usage -> agent mapping (_meta.cost) -> meter costOf -> ModelUse { cost, providerCost } -> usage.record
```

### Gaps

- `Not found: a split of a harness cost - searched "cost" in packages/sdk/src/meter.ts`.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A record keeps the provider's cost beside the cost it charges, and a configured price is what it charges](../../../decisions/a-record-keeps-the-providers-cost-beside-the-charged-one.md) | Softov, 2026-10-07 |
| 2 | [Each agent says whether its cost comes from the harness or the provider](../../../decisions/an-agent-says-whose-cost-report-counts.md) | Softov, 2026-10-02 |

| What | Source | Task |
| --- | --- | --- |
| An agent record's cost is the harness's, written as both costs | Softov, 2026-10-07: "if a provider price is informmed use that in both" | 01 |
| Agents do not get a price from `proxy.models` in this plan | Softov, 2026-10-07, asked "Should agent records also get our price?" and answered "Proxy now, agents later" | - |
| The cost on a zero-token record and the input of 0 are each a task with a test | Softov, 2026-10-07, asked "Should defects 3 and 4 go in this plan?" and answered "Yes, as their own tasks" | 02, 04 |
| A harness's cost of 0 with no token counted is no cost | (defaulted: the turn spent nothing, so there is nothing to report) | 01, 02 |

## Proposed architecture

- **Data flow** - The meter reads `_meta.cost` with its optional `input` and `output`, and writes it as `cost` and `providerCost`. pi sends the split.
- **Layer responsibilities** - sdk: the meter · agent-claude: the cost of a `result` · agent-pi: the split.
- **Source-of-truth files** - [`code://packages/sdk/src/meter.ts`](../../../../packages/sdk/src/meter.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The meter writes a harness's cost as both costs, with its split](task-01-the-meter-writes-both-costs.md) | todo | - |
| [02 - Claude sends no cost for a result that spent nothing](task-02-claude-sends-no-cost-for-nothing-spent.md) | todo | - |
| [03 - pi sends its cost split into sent and received](task-03-pi-sends-its-cost-split.md) | todo | 01 |
| [04 - A turn's tokens are what the provider counted](task-04-a-turns-tokens-are-what-was-counted.md) | todo | - |

## Risks and tradeoffs

- A Claude subscription's `costUSD` is an API price, not a bill. It is still the harness's figure and is kept as such; decision 2's per-agent setting is where a host says it does not count.
- Task 04 starts from records, not a reproduction. If the cause is in the Claude CLI, the fix is to record the input as absent, not to correct it.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-meter-writes-both-costs.md](task-01-the-meter-writes-both-costs.md), after usage/06 task 01.
- **Open questions:** none.
- **Watch out for:** a record written as `0` by a harness and a record with the field absent mean different things. Keep both kinds in the tests.

## Final verification checklist

- [ ] A test per defect, from the records in the searches.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass.
- [ ] `plans/index.md` updated.

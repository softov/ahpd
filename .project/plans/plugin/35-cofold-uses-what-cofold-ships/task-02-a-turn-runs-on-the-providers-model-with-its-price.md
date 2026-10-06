---
title: A turn runs on the provider's model, with the listed price
status: done
depends: [task-01-the-catalogue-is-read-through-cofolds-provider.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L354-L377](../../../../packages/agent-cofold/src/agent.ts#L354-L377) - `modelOf`, one `openaiCompat()` per call"
  - "[code://packages/agent-cofold/src/turnagent.ts#L178-L181](../../../../packages/agent-cofold/src/turnagent.ts#L178-L181) - where `agentOf` calls `modelOf` for every turn"
  - "[code://packages/agent-cofold/src/mapping.ts#L617-L620](../../../../packages/agent-cofold/src/mapping.ts#L617-L620) - `outcome.cost` sent as `_meta.cost`"
  - "[code://packages/agent-cofold/test/agent-cofold-usage.test.ts](../../../../packages/agent-cofold/test/agent-cofold-usage.test.ts) - the cost cases, over an adapter with a price row"
  - npm://@cofold/agents@0.1.2 - `ModelProvider.model({ id, features, params, pricing })`; `outcome.cost` is set only when the adapter has `pricing`
  - file:///github/cofold/.project/decisions/pricing-on-adapter.md - decision 108
---

## Objective

A turn's model is `provider.model({ id, params, pricing })` on the backend's one provider for that endpoint and key, with the price the catalogue listed for that model, so a real endpoint's turn ends with `outcome.cost` and plugin 32 p3 sends it as `_meta.cost`.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:354-377` - `modelOf` takes what the backend holds and builds through it.
- `UPDATE: packages/agent-cofold/src/agent.ts` - `create` hands the session a way to reach the provider and the listed `ModelInfo` for a reference.
- `UPDATE: packages/agent-cofold/src/session.ts`, `context.ts`, `turnagent.ts:178-181` - the turn agent passes them to `modelOf`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-usage.test.ts` or `agent-cofold-models.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail.
2. Give `modelOf` an optional last parameter, `held?: { providerOf(connection): ModelProvider; infoOf(reference): ModelInfo | undefined }`, so the exported signature still works for a caller that passes nothing; with nothing it builds a provider of its own, as today.
3. With `held`, `modelOf` resolves the connection strictly as today, then returns `held.providerOf(connection).model({ id: connection.model, params, features, pricing })`.
   `params` and `features` are exactly today's: `{ reasoning: { effort } }` and `{ reasoning: true }` only when an effort is chosen.
   `pricing` is `held.infoOf(connection.reference)?.pricing`, read from the cache without waiting.
4. `cofoldAgent` builds `held` from task 01's `providers` and `catalogues`, finding the `ModelInfo` whose id is the reference in the catalogue for that connection, and passes it to `cofoldSession` beside the `catalogue` callback; the session puts it on its context and `agentOf` passes it to `modelOf`.
5. A caller-passed `adapter` still wins over all of it.

## Validation

- Written first, failing today because no real endpoint's turn carries a price:
  - with `GET /models` stubbed to list `m1` with OpenRouter-shaped `pricing` and `POST /chat/completions` stubbed to answer with usage, a turn on `<provider>/m1` ends with a `chat/usage` whose `_meta.cost` is the amount `costOf` gives for that usage.
  - a turn on a model the list has no price for ends with no `_meta.cost`, as `agent-cofold-usage.test.ts` "sends no cost for a model with no price row" says for an adapter.
  - two turns on the same endpoint and key build one provider: a spy on `openaiCompatProvider`, or a counter in the stubbed fetch for the provider's id, sees one.
- The existing usage, models and modes cases stay green; the effort cases still send `reasoning` only when a level is chosen.
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-cofold`.

## Resume

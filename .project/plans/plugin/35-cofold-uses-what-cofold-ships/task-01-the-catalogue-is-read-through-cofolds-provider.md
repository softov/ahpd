---
title: The catalogue is read through cofold's provider
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L292-L337](../../../../packages/agent-cofold/src/agent.ts#L292-L337) - the hand-rolled `listModels` that goes"
  - "[code://packages/agent-cofold/src/agent.ts#L500-L535](../../../../packages/agent-cofold/src/agent.ts#L500-L535) - `catalogues`, `catalogueOf`, `knownCatalogue`"
  - "[code://packages/agent-cofold/src/agent.ts#L609-L616](../../../../packages/agent-cofold/src/agent.ts#L609-L616) - `probe`"
  - "[code://packages/agent-cofold/src/session.ts#L60-L68](../../../../packages/agent-cofold/src/session.ts#L60-L68) - the `catalogue` callback's type"
  - "[code://packages/agent-cofold/src/session.ts#L217-L221](../../../../packages/agent-cofold/src/session.ts#L217-L221) - `models()`"
  - "[code://packages/agent-pi/src/models.ts#L95-L109](../../../../packages/agent-pi/src/models.ts#L95-L109) - the sibling's `maxContextWindow` and `maxOutputTokens`"
  - "[code://packages/agent-cofold/test/agent-cofold-models.test.ts](../../../../packages/agent-cofold/test/agent-cofold-models.test.ts) - the catalogue cases to keep green and extend"
  - npm://@cofold/model-openai-compat@0.1.1 - `openaiCompatProvider`, `listModels({ signal })`
---

## Objective

The models a cofold backend offers come from `openaiCompatProvider(...).listModels()`, with the same `<provider>/<model>` ids, the same cache and the same fallback as today, and each row also says its context window and output limit when the endpoint published them.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:292-337` - the `fetch` goes; a `providerOf(connection)` and a `listModels(connection)` over it come in its place.
- `UPDATE: packages/agent-cofold/src/agent.ts:500-535` - `catalogues` holds `ModelInfo[]` with each `id` already the reference; a `providers` map beside it, keyed by `cacheKey`.
- `UPDATE: packages/agent-cofold/src/agent.ts:609-616` - `probe` maps the held `ModelInfo` to rows.
- `UPDATE: packages/agent-cofold/src/session.ts:60-68,217-221` - the `catalogue` callback answers the held `ModelInfo[]`; `models()` maps them to rows.
- `UPDATE: packages/agent-cofold/test/agent-cofold-models.test.ts` - the cases below.

## Steps

1. Write the new cases first and see them fail.
2. In `cofoldAgent`, add `providers: Map<string, ModelProvider>` beside `catalogues`, and `providerOf(connection)` that builds `openaiCompatProvider({ baseUrl, apiKey, headers })` once per `cacheKey(connection)` and returns the held one after.
3. Replace the module-level `listModels` with one that calls `providerOf(connection).listModels({ signal: AbortSignal.timeout(CATALOGUE_TIMEOUT_MS) })`, rewrites each `ModelInfo.id` to `${connection.prefix}/${id}` as the decision says, and answers `[]` for anything it throws.
   `providerOf` is inside `cofoldAgent`, so this function moves there too or takes the provider as a parameter.
4. `catalogueOf` and `knownCatalogue` keep their rules: one call per endpoint and key, an empty answer not cached.
5. One `rowOf(info)` gives `{ id, name }` plus `maxContextWindow` from `contextTokens` and `maxOutputTokens` from `maxOutputTokens`, each only when it is a positive number, as pi's `offered` does.
   `probe` and the session's `models()` send only `rowOf`'s fields, never `pricing` or `features`.
6. The configured model that the list does not carry is still offered first, as `{ id, name }` alone.

## Validation

- In `agent-cofold-models.test.ts`, written first:
  - a stubbed `GET /models` whose entries carry `context_length` and `top_provider.max_completion_tokens` gives rows with `maxContextWindow` and `maxOutputTokens`, and a row with neither carries neither; fails today because the rows have only `id` and `name`.
  - a stubbed entry with `pricing` gives a row with no `pricing` and no `features` key.
  - a stub that never answers gives the configured model alone within about 5 s (use fake timers or a short injected limit).
- Every existing case in the file stays green unchanged: the prefixed ids, the configured default first, the refusal and wrong-shape fallbacks, the ids resolving back through `modelOf`, the backend's own prefix, no call with an `adapter`, and the root channel's list.
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-cofold`.

## Resume

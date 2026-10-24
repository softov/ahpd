---
title: An adapter lists its models
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L110-L125](../../../../packages/sdk/src/types/connectors.ts#L110-L125) - `ModelProvider`, which gets `prefix`"
  - "[code://packages/sdk/src/types/connectors.ts#L226-L291](../../../../packages/sdk/src/types/connectors.ts#L226-L291) - `Adapter`, which gets `models`"
  - https://openrouter.ai/docs/api-reference/list-available-models - the field names `ProviderModel` copies
---

## Objective

A provider adapter can answer the models a connector serves, in OpenRouter's field names.
A provider can name the first segment of its fetched model names.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - the `ProviderModel` and `ModelPricing` types, `ModelProvider.prefix` and `Adapter.models`.
- `UPDATE: packages/sdk/src/types/index.ts` - export the new types.
- `UPDATE: packages/sdk/src/index.ts` - export the new types.

## Steps

1. Add `ModelPricing { prompt?: string; completion?: string }`, with a comment that each is dollars per token, as OpenRouter writes it.
2. Add `ProviderModel { id: string; name?: string; context_length?: number; pricing?: ModelPricing }`.
3. Add `prefix?: string` to `ModelProvider`, with a comment that it is the adapter name when absent.
4. Add `models?(connector: Connector): Promise<ProviderModel[]>` to `Adapter`, with a comment that it reads the connector's resolved config.
5. Export the new types from both index files.

## Validation

- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

- **Done so far:** `ModelPricing` and `ProviderModel` are in `packages/sdk/src/types/connectors.ts`, with `ModelProvider.prefix` and `Adapter.models(connector)`. Both index files export the new types. The refs' line numbers are corrected to this tree after proxy 04.
- **Next action:** none for this task.
- **Open questions:** none.
- **Watch out for:** `models` takes a `Connector`, so it reads the resolved config. `providers()` binds each row's `models()` to that open connector, so the catalog never holds one. Softov answered that on 2026-10-24, and task 03 builds it.

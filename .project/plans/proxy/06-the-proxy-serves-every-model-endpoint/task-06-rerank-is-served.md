---
title: Rerank is served
status: done
depends: [task-01-tokens-are-counted.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/dialects.ts#L156-L172](../../../../packages/server/src/proxy/dialects.ts#L156-L172) - the usage readers"
  - https://docs.cohere.com/reference/rerank - the request and `meta.billed_units`
  - https://openrouter.ai/openapi.json - `POST /rerank` and its `usage`
---

## Objective

`POST /rerank`, `/v1/rerank` and `/v2/rerank` answer in the Cohere shape through a connector that accepts `rerank`.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - `rerank` in `MODEL_DIALECTS`.
- `UPDATE: packages/server/src/proxy/dialects.ts` - the `rerank` row, and its usage reader.
- `UPDATE: packages/server/src/proxy/adapters.ts` - `openrouter` accepts `rerank`.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - a rerank call at the three paths, and its usage.

## Steps

1. Add `rerank` to `MODEL_DIALECTS`.
2. Add its row: the three paths in, `/rerank` out, family `openai`.
3. Read `usage.total_tokens` or `meta.billed_units.input_tokens` as input.
4. Read OpenRouter's `usage.cost` as a chat call does.
5. Make `openrouter` accept `rerank`.
6. Test that a rerank call answers at each path and its record has its tokens.

## Validation

- `proxy-listener.test.ts` passes.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

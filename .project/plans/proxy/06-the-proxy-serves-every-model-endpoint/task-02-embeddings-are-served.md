---
title: Embeddings are served
status: done
depends: [task-01-tokens-are-counted.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/dialects.ts#L156-L172](../../../../packages/server/src/proxy/dialects.ts#L156-L172) - `openaiUsage`, which reads `prompt_tokens`"
  - "[code://packages/server/src/proxy/dialects.ts#L226](../../../../packages/server/src/proxy/dialects.ts#L226) - `usageReader`"
  - https://github.com/openai/openai-openapi - `POST /embeddings` and its `usage`
---

## Objective

`POST /embeddings` and `POST /v1/embeddings` answer through a connector that accepts `openai-embeddings`, and the call is charged for its input tokens.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - `openai-embeddings` in `MODEL_DIALECTS`.
- `UPDATE: packages/server/src/proxy/dialects.ts` - the `openai-embeddings` row, and its usage reader.
- `UPDATE: packages/server/src/proxy/adapters.ts` - `openai` and `openrouter` accept `openai-embeddings`.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - an embeddings call at both paths, and its usage record.

## Steps

1. Add `openai-embeddings` to `MODEL_DIALECTS`.
2. Add its row: `/embeddings` and `/v1/embeddings` in, `/embeddings` out, family `openai`.
3. Read `usage.prompt_tokens` as input, with no output.
4. Read OpenRouter's `usage.cost` as a chat call does.
5. Make `openai` and `openrouter` accept `openai-embeddings`.
6. Test that an embeddings call answers at both paths, and that its record has input tokens and a cost.

## Validation

- `proxy-listener.test.ts` passes.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

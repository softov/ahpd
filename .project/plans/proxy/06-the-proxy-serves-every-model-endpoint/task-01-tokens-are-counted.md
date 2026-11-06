---
title: Tokens are counted
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L66-L90](../../../../packages/sdk/src/types/connectors.ts#L66-L90) - `MODEL_DIALECTS` and `ModelProvider`"
  - "[code://packages/server/src/proxy/dialects.ts#L16-L46](../../../../packages/server/src/proxy/dialects.ts#L16-L46) - `CALLER_PATHS`, `UPSTREAM_PATHS` and `dialectAt`"
  - "[code://packages/server/src/proxy/dialects.ts#L91-L105](../../../../packages/server/src/proxy/dialects.ts#L91-L105) - `refusalBody` and `keyHeader`"
  - "[code://packages/server/src/proxy/route.ts](../../../../packages/server/src/proxy/route.ts) - the 404 that names another dialect"
  - "[code://packages/server/src/proxy/adapters.ts#L198-L286](../../../../packages/server/src/proxy/adapters.ts#L198-L286) - the host adapters' `accepts`"
  - https://platform.claude.com/docs/en/api/messages/count_tokens - the request and the `input_tokens` answer
---

## Objective

`POST /v1/messages/count_tokens` and `POST /responses/input_tokens` answer through a connector that has a counter.
A dialect becomes a row with its caller paths, upstream path and family, so later tasks add one row each.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - `anthropic-count-tokens` and `openai-input-tokens` in `MODEL_DIALECTS`, and `ModelProvider.paths`.
- `UPDATE: packages/server/src/proxy/dialects.ts` - one row per dialect, with its caller paths, upstream path and family; `dialectAt`, `refusalBody` and `keyHeader` read the row.
- `UPDATE: packages/server/src/proxy/route.ts` - the upstream URL reads `provider.paths` first, and the 404 hint names only a dialect of the same kind.
- `UPDATE: packages/server/src/proxy/listener.ts` - a count call writes no usage record.
- `UPDATE: packages/server/src/proxy/adapters.ts` - `anthropic` and `openai` accept their counters, and the compatible form lists the new dialects.
- `UPDATE: packages/server/test/proxy-route.test.ts` - a count call routes, and a connector with no counter is a 404.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - both count paths, the root and `/v1` forms, and no usage record.

## Steps

1. Add `anthropic-count-tokens` and `openai-input-tokens` to `MODEL_DIALECTS`.
2. Add `paths?: Partial<Record<ModelDialect, string>>` to `ModelProvider`, which replaces an upstream path.
3. Replace `CALLER_PATHS` and `UPSTREAM_PATHS` with one row per dialect.
4. Give each row its caller paths, its upstream path and its family, `openai` or `anthropic`.
5. Make `dialectAt`, `refusalBody` and `keyHeader` read the row.
6. Serve `/v1/messages/count_tokens` under `/v1` only.
7. Serve `/responses/input_tokens` at the root and under `/v1`.
8. Make the upstream URL use `provider.paths[dialect]` when the connector names one.
9. Keep the 404 hint in `route` to a dialect of the same kind as the call.
10. Write no usage record for a count call.
11. Make `anthropic` accept `anthropic-count-tokens` and `openai` accept `openai-input-tokens`.
12. List the new dialects in the `openai-compatible` form, and keep its default.
13. Test that a count call reaches the connector and answers its `input_tokens`.
14. Test that a count call to `openrouter` alone is a 404.

## Validation

- `proxy-route.test.ts` and `proxy-listener.test.ts` pass, and the chat tests pass unchanged.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

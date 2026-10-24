---
title: The host adapters list their models
status: implemented
depends: [task-01-an-adapter-lists-its-models.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/route.ts#L105](../../../../packages/server/src/proxy/route.ts#L105) - `namedBy`, the rule a `prefix` is matched beside"
  - https://openrouter.ai/docs/api-reference/list-available-models - OpenRouter's `GET /models`
  - https://docs.anthropic.com/en/api/models-list - Anthropic's `GET /v1/models`, paged with `after_id`
  - https://platform.openai.com/docs/api-reference/models/list - OpenAI's `GET /models`, ids only
---

## Objective

Each of the four host adapters answers `models(connector)` from its vendor's list.
The `openai-compatible` adapter answers its connector id as `prefix`.

## Files

- `UPDATE: packages/server/src/proxy/adapters.ts` - `models` on each adapter, and `prefix` on the `openai-compatible` provider.
- `UPDATE: packages/server/test/proxy-adapters.test.ts` - a case for each adapter's list, with a fake `fetch`.

## Steps

1. Give `openrouter` a `models` that calls `GET <endpoint>/models` with the key.
2. Keep `id`, `name`, `context_length` and `pricing.prompt` and `pricing.completion` from each OpenRouter model.
3. Give `anthropic` a `models` that calls `GET <endpoint>/v1/models?limit=1000` with the key and the version header.
4. Follow `has_more` with `after_id` until the list ends.
5. Map Anthropic's `display_name` to `name` and `max_input_tokens` to `context_length`.
6. Give `openai` a `models` that calls `GET <endpoint>/models` and keeps `id` only.
7. Give `openai-compatible` a `models` that calls `GET <endpoint>/models`, with the key when the connector has one.
8. Keep `id`, and keep `name` and `context_length` when an entry holds them under those names.
9. Make the `openai-compatible` provider answer `prefix: connector.id`.
10. Send each call through the adapter's `fetch`, with `redirect: 'error'` and the check's time limit.
11. Make a list call throw with the HTTP status when the answer is not 2xx.
12. Skip an entry with no string `id`.
13. Test each adapter with a fake `fetch`, Anthropic's two pages included.

## Validation

- `proxy-adapters.test.ts` passes, with a case per adapter and a case for a refused list.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

- **Done so far:** the four host adapters answer `models`. OpenRouter keeps `name`, `context_length`, `pricing.prompt` and `pricing.completion`. Anthropic pages on `after_id` and maps `display_name` and `max_input_tokens`. OpenAI keeps ids alone. `openai-compatible` keeps `name` and `context_length`, and answers `prefix: connector.id`. A refused list throws `HTTP <status>`. `proxy-adapters.test.ts` has 20 cases.
- **Next action:** none for this task.
- **Open questions:** none.
- **Watch out for:** each `models` reads the key from `connector.config`, not from the `ModelProvider` the adapter answers. A catalog built from `ProviderConnector` rows cannot call it as it stands.

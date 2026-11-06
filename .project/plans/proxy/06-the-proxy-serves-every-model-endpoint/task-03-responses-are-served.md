---
title: Responses are served
status: done
depends: [task-01-tokens-are-counted.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/route.ts](../../../../packages/server/src/proxy/route.ts) - `route` and `usableFor`, which a follow-up reads to check the caller"
  - "[code://packages/server/src/proxy/listener.ts#L720-L734](../../../../packages/server/src/proxy/listener.ts#L720-L734) - the path dispatch"
  - "[code://packages/server/src/proxy/dialects.ts#L226](../../../../packages/server/src/proxy/dialects.ts#L226) - `usageReader`, which reads SSE line by line"
  - https://github.com/openai/openai-openapi - the Responses paths, `previous_response_id` and `response.completed`
  - https://openrouter.ai/openapi.json - OpenRouter serves `POST /responses` only
---

## Objective

`POST /responses` and `POST /responses/compact` answer as a model call.
A Responses id that the proxy sends holds its connector.
`GET`, `DELETE`, `cancel` and `input_items` on that id go to that connector.
A body with `previous_response_id` goes to that connector only.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - `openai-responses` in `MODEL_DIALECTS`.
- `CREATE: packages/server/src/proxy/responseids.ts` - the id encode and decode, and the rewrite of a JSON answer and an SSE stream.
- `UPDATE: packages/server/src/proxy/dialects.ts` - the `openai-responses` row, and its usage reader.
- `UPDATE: packages/server/src/proxy/route.ts` - a call pinned to one connector, with the caller's tier check and no fallback.
- `UPDATE: packages/server/src/proxy/listener.ts` - the follow-up paths, the pinned route for `previous_response_id`, and the id rewrite on each answer.
- `UPDATE: packages/server/src/proxy/adapters.ts` - `openai` and `openrouter` accept `openai-responses`.
- `CREATE: packages/server/test/proxy-responses.test.ts` - ids, follow-ups, a forged id, and usage.

## Steps

1. Add `openai-responses` to `MODEL_DIALECTS`.
2. Add its row: `/responses` and `/responses/compact`, at the root and under `/v1`, family `openai`.
3. Encode an id as `resp_` and then the base64url of `<connector id>:<the provider's id>`.
4. Rewrite the `id` of a JSON answer before it goes to the caller.
5. Rewrite `response.id` in each SSE event, line by line, as the stream passes.
6. Serve `GET` and `DELETE` on `/responses/{id}`, and `POST` on `/responses/{id}/cancel`.
7. Serve `GET` on `/responses/{id}/input_items`.
8. Decode the id of a follow-up, and send the provider's id to that connector.
9. Answer a 404 for an id that does not decode, or whose connector the caller may not use.
10. Send a body with `previous_response_id` to that id's connector only, with the decoded id.
11. Keep the table, the policy and the usage record for a pinned call as for any other call.
12. Read usage from `response.usage` in `response.completed`, and in a JSON answer.
13. Take cached tokens out of input, as for a chat call.
14. Make `openai` and `openrouter` accept `openai-responses`.
15. Test that a create and its follow-up reach the same connector.
16. Test that a forged id and another person's id both answer the same 404.
17. Test that a streamed create writes its usage record.

## Validation

- `proxy-responses.test.ts` passes.
- No answer sends a provider's id that is not rewritten.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

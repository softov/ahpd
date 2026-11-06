---
title: Images are served
status: done
depends: [task-01-tokens-are-counted.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/listener.ts#L166-L196](../../../../packages/server/src/proxy/listener.ts#L166-L196) - `bodyOf`, which reads JSON only"
  - "[code://packages/server/src/proxy/dialects.ts#L156-L172](../../../../packages/server/src/proxy/dialects.ts#L156-L172) - the usage readers"
  - https://github.com/openai/openai-openapi - `generations`, `edits` and `variations`, and their bodies
  - https://openrouter.ai/openapi.json - `POST /images`, OpenRouter's one image path
---

## Objective

`POST /images/generations`, `/images/edits` and `/images/variations` answer through a connector that accepts `openai-images`.
A multipart body is read, its model is rewritten, and it is sent on.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - `openai-images` in `MODEL_DIALECTS`.
- `UPDATE: packages/server/src/proxy/listener.ts` - `bodyOf` reads a multipart body, and the call sends it again as `FormData`.
- `UPDATE: packages/server/src/proxy/dialects.ts` - the `openai-images` row, and a reader for `input_tokens` and `output_tokens`.
- `UPDATE: packages/server/src/proxy/adapters.ts` - `openai` and `openrouter` accept `openai-images`, and `openrouter` names `/images` in `paths`.
- `CREATE: packages/server/test/proxy-images.test.ts` - a JSON generation, a multipart edit, the OpenRouter path, and usage.

## Steps

1. Add `openai-images` to `MODEL_DIALECTS`.
2. Add its row: the three paths, at the root and under `/v1`, family `openai`.
3. Give each caller path its own upstream path in the row.
4. Read a `multipart/form-data` body with `Request.formData()`, under the 32 MiB limit.
5. Take `model` from its form field, and refuse a form with no model, as for a JSON body.
6. Set the provider's model id in the form, and send the form as `FormData`.
7. Leave `content-type` to `fetch`, so the boundary is the new form's.
8. Read `usage.input_tokens` and `usage.output_tokens`, and the chat shape.
9. Make `openai` and `openrouter` accept `openai-images`.
10. Make `openrouter` send `/images/generations` to `/images`.
11. Test that a multipart edit arrives with the provider's model id and its file unchanged.
12. Test that an OpenRouter generation goes to `/images`.

## Validation

- `proxy-images.test.ts` passes, and the JSON calls of other dialects pass unchanged.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.

## Resume

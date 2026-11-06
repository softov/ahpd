---
title: The proxy serves every model endpoint
domain: proxy
status: built
priority: high
created: 2026-10-24
revalidated: 2026-10-24
requires: [plans/proxy/05-a-providers-own-models-are-callable/plan.md]
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L66](../../../../packages/sdk/src/types/connectors.ts#L66) - `MODEL_DIALECTS`, which gets one value per endpoint"
  - "[code://packages/sdk/src/types/connectors.ts#L78](../../../../packages/sdk/src/types/connectors.ts#L78) - `ModelProvider`, which gets `paths`"
  - "[code://packages/server/src/proxy/dialects.ts#L16-L46](../../../../packages/server/src/proxy/dialects.ts#L16-L46) - `CALLER_PATHS`, `UPSTREAM_PATHS` and `dialectAt`, one path per dialect"
  - "[code://packages/server/src/proxy/dialects.ts#L91-L105](../../../../packages/server/src/proxy/dialects.ts#L91-L105) - `refusalBody` and `keyHeader`, which pick the error shape and the key header by dialect"
  - "[code://packages/server/src/proxy/dialects.ts#L156-L172](../../../../packages/server/src/proxy/dialects.ts#L156-L172) - `openaiUsage` and `anthropicUsage`, the two usage readers"
  - "[code://packages/server/src/proxy/dialects.ts#L226](../../../../packages/server/src/proxy/dialects.ts#L226) - `usageReader`, which reads SSE and JSON and gives no tokens for anything else"
  - "[code://packages/server/src/proxy/listener.ts#L166-L196](../../../../packages/server/src/proxy/listener.ts#L166-L196) - `bodyOf`, which reads a JSON body and its `model`"
  - "[code://packages/server/src/proxy/listener.ts#L273-L284](../../../../packages/server/src/proxy/listener.ts#L273-L284) - `costOf`, which prices tokens per million"
  - "[code://packages/server/src/proxy/listener.ts#L720-L734](../../../../packages/server/src/proxy/listener.ts#L720-L734) - the path dispatch"
  - "[code://packages/server/src/proxy/providers.ts#L24-L29](../../../../packages/server/src/proxy/providers.ts#L24-L29) - `ModelPrice`, which gets `characters` and `minutes`"
  - "[code://packages/server/src/proxy/adapters.ts#L198-L286](../../../../packages/server/src/proxy/adapters.ts#L198-L286) - what each host adapter `accepts`"
  - "[code://packages/server/src/proxy/route.ts](../../../../packages/server/src/proxy/route.ts) - `route`, which a Responses follow-up pins to one connector"
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - the proxy's guide"
  - https://github.com/openai/openai-openapi - OpenAI's paths, bodies and usage fields
  - https://openrouter.ai/openapi.json - OpenRouter's paths, which differ for images and lack Responses follow-ups
  - https://platform.claude.com/docs/en/api/messages/count_tokens - Anthropic's token counter
  - https://docs.cohere.com/reference/rerank - the rerank shape that OpenRouter, Jina and LiteLLM follow
---

## Goal

The proxy answers every model endpoint that a common SDK calls, not only chat.
Those are token counts, embeddings, Responses, images, audio and rerank, each at the root and under `/v1`.
Each call goes through the same table, policy, connector tiers and usage record as a chat call.
Batches are proxy plan 07.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The line numbers are from the proxy 04 build, and are checked again after proxy 05 merges.

### Searches performed

- `rg -n "MODEL_DIALECTS|CALLER_PATHS|UPSTREAM_PATHS" packages` - a dialect is one path in and one path out, and a connector's `accepts` lists dialects.
- `rg -n "formData|multipart" packages/server/src` - nothing reads a multipart body today.
- `rg -n "content-type" packages/server/src/proxy` - `usageReader` gives no tokens for a binary answer.

### Runtime path

```
POST /embeddings | /v1/embeddings -> dialectAt: openai-embeddings
  -> bodyOf: JSON or multipart, model -> route: connectors that accept openai-embeddings
  -> upstream path: provider.paths[dialect] ?? UPSTREAM_PATHS[dialect] -> fetch
  -> usageReader(dialect) -> costOf -> ModelUse
GET /responses/{id} -> decode id -> connector, original id -> may the caller use it? -> fetch
```

### Gaps

- Only `/v1/chat/completions` and `/v1/messages` are called, so an embeddings or audio SDK call is a 404.
- A multipart body is refused as not JSON.
- A binary answer, such as speech, writes no usage.
- A Responses id says nothing of the connector that made it, so a follow-up has nowhere to go.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The endpoints come in size order: count tokens, embeddings, Responses, images, audio, rerank | Softov, 2026-10-24 | 01-06 |
| Batches are their own plan, proxy 07 | Softov, 2026-10-24 | - |
| A Responses id that the proxy sends carries the connector, and a follow-up is sent to that connector | Softov, 2026-10-24 | 03 |
| A count call to a connector with no counter is a 404 | Softov, 2026-10-24 | 01 |
| A speech call is charged by the characters of its `input`, at a per-character price from the table | Softov, 2026-10-24 | 05 |
| Each OpenAI endpoint answers at the root and under `/v1` | Softov, 2026-10-23 (proxy 05) | 01-06 |
| Anthropic's count path stays under `/v1` only | Softov, 2026-10-23 (proxy 05) | 01 |
| Each endpoint is one more value of `MODEL_DIALECTS`, and a connector's `accepts` lists the ones it serves | (defaulted: the existing seam, and a connector says what it serves) | 01-06 |
| A dialect has a family, `openai` or `anthropic`, which picks its error body and its key header | (defaulted: each new dialect speaks one of the two wire shapes) | 01 |
| A dialect may answer at more than one caller path | (defaulted: images, audio and rerank have more than one) | 01 |
| `ModelProvider.paths` replaces an upstream path for one dialect. OpenRouter's images path is `/images` | (defaulted: OpenRouter's openapi.json) | 01, 04 |
| A count call writes no usage record, because it costs nothing | (defaulted: Anthropic does not charge for it) | 01 |
| The counters are `anthropic-count-tokens` at `/v1/messages/count_tokens` and `openai-input-tokens` at `/responses/input_tokens` | (defaulted: the two providers that have one) | 01 |
| `anthropic` accepts the count dialect, and `openai` accepts `openai-input-tokens`. `openrouter` accepts neither | (defaulted: OpenRouter has no counter) | 01 |
| Embeddings read `usage.prompt_tokens` as input, and `openai` and `openrouter` accept them | (defaulted: OpenAI's and OpenRouter's shape) | 02 |
| A Responses id is `resp_` and then the base64url of `<connector id>:<the provider's id>` | (defaulted: LiteLLM's way, and the `resp_` prefix SDKs expect) | 03 |
| The id is rewritten in a JSON answer and in each SSE event that carries it | (defaulted: a streamed call is the common one) | 03 |
| A follow-up reaches a connector only when the caller may use it. Any other id is the same 404 | (defaulted: an id must not show another person's connector) | 03 |
| A body with `previous_response_id` goes only to that id's connector, with no fallback | (defaulted: the state is at that provider only) | 03 |
| Responses usage is read from `response.usage` in `response.completed`, and cached tokens are taken out of input as for chat | (defaulted: OpenAI's shape) | 03 |
| `openai` accepts Responses with every follow-up. `openrouter` accepts the create call, and its own 404 answers a follow-up | (defaulted: OpenRouter serves `POST /responses` only) | 03 |
| A multipart body is read with the built-in `Request.formData()`, its `model` field is rewritten, and it is sent again as `FormData` | (defaulted: no new dependency) | 04 |
| A multipart body has the same 32 MiB limit as a JSON body | (defaulted: `MAX_BODY_BYTES`) | 04 |
| Image usage reads `input_tokens` and `output_tokens`, and also the chat shape that OpenRouter sends | (defaulted: gpt-image and OpenRouter) | 04 |
| An image priced per image is not charged. The table has no per-image price | (defaulted: OpenAI does not list the DALL-E price) | 04 |
| `ModelPrice.characters` is dollars per million characters, and `ModelPrice.minutes` is dollars per minute of audio | (defaulted: tts-1 and whisper units) | 05 |
| Speech bytes pass through as they arrive | (defaulted: as a chat stream does) | 05 |
| Transcription and translation share one dialect, and their usage is tokens or seconds | (defaulted: one body shape, two paths) | 05 |
| Rerank is the Cohere shape at `/rerank`, `/v1/rerank` and `/v2/rerank`, and `openrouter` accepts it | (defaulted: LiteLLM's paths, and the shape OpenRouter and Jina follow) | 06 |
| Rerank usage reads `usage.total_tokens` or `meta.billed_units.input_tokens` as input. A search unit has no price yet | (defaulted: Cohere's unit is not confirmed) | 06 |
| The `openai-compatible` form lists every new dialect, and its `accepts` default stays `["openai-chat"]` | (defaulted: a local server says what it serves) | 01-06 |

## Proposed architecture

- **Data flow** - a dialect is a row: caller paths, upstream path, family, body kind and usage reader. The listener reads the row for the path, and the route picks connectors that accept the dialect.
- **Event flow** - unchanged: one call, fallback before the first byte, one usage record. A Responses follow-up has no fallback.
- **State flow** - nothing is stored. A Responses id holds its own connector.
- **Layer responsibilities** - sdk: the new dialects and `ModelProvider.paths`.
  server: the dialect rows, the multipart body, the usage readers, the id rewrite and the adapters' `accepts`.
  docs: the proxy guide.
- **Source-of-truth files** - [`code://packages/server/src/proxy/dialects.ts`](../../../../packages/server/src/proxy/dialects.ts) and [`code://packages/server/src/proxy/listener.ts`](../../../../packages/server/src/proxy/listener.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Tokens are counted](task-01-tokens-are-counted.md) | done | - |
| [02 - Embeddings are served](task-02-embeddings-are-served.md) | done | 01 |
| [03 - Responses are served](task-03-responses-are-served.md) | done | 01 |
| [04 - Images are served](task-04-images-are-served.md) | done | 01 |
| [05 - Audio is served](task-05-audio-is-served.md) | done | 04 |
| [06 - Rerank is served](task-06-rerank-is-served.md) | done | 01 |
| [07 - The docs list every endpoint](task-07-the-docs-list-every-endpoint.md) | done | 01-06 |

## Risks and tradeoffs

- A Responses id is not the provider's own id, so a caller that reads it at the provider's dashboard does not find it. The decoded id is in the usage record.
- The root takes more paths: `/embeddings`, `/responses`, `/images`, `/audio` and `/rerank`. Plugin routes stay under `/plugins`, so none clashes.
- A multipart body is held in memory up to 32 MiB to rewrite its model.
- An endpoint a provider does not serve answers with the provider's own 404 when its connector says it accepts it.

## Resume state

- **Done so far:** all seven tasks are implemented. A dialect is one row: caller paths, upstream path, family, kind and usage reader. The proxy answers count tokens, embeddings, Responses and their follow-ups, images, speech, transcriptions and rerank.
An OpenAI endpoint answers at the root as well. A Responses id holds its connector and is rewritten in JSON and SSE. `ModelPrice` carries `characters` and `minutes`. The two docs and `00-proxy.md` list the endpoints. The plan's final checklist is still open because no task is `done`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** a dialect is now more than chat. The 404 hint in `route` stays among dialects of the same kind, so a chat refusal never names `/rerank`.
## Final verification checklist

- [ ] The OpenAI SDK, with base URL `http://host:port`, answers embeddings, Responses with a follow-up, images, speech and a transcription through a real `openai` connector.
- [ ] The Anthropic SDK counts tokens through a real `anthropic` connector.
- [ ] A rerank call answers through a real `openrouter` connector.

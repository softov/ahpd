---
title: The model picker lists what the endpoint serves, with the configured model as the default
status: done
depends: []
layer: packages/agent-facio
refs:
  - code://packages/agent-facio/src/agent.ts - `connectionOf`, `listModels`, the catalogue cache and `probe`
  - code://packages/agent-facio/src/session.ts - `models()`, which answers the same list
  - code://packages/agent-facio/src/config.ts#L111-L115 - `splitModel`, the rule a listed id satisfies
  - code://packages/agent-claude/src/probe.ts#L50-L120 - the backend whose probe already offers every model
  - https://openrouter.ai/docs/api-reference/list-available-models - `GET /api/v1/models` and its `id`/`name`
  - code://.project/decisions/listed-models-are-provider-references.md - why a listed id carries the provider prefix
  - code://test/agent-facio-models.test.ts - the cases
---

## Objective

A facio backend offers every model its configured endpoint serves, each as the reference `<provider>/<model id>` the harness itself writes, with the configured `model` first when the endpoint's list does not carry it.
When the endpoint cannot be asked, the offered list is the configured model alone, and a session whose endpoint and key were named with it answers the same list as the backend's probe.

## Files

- `UPDATE: packages/agent-facio/src/agent.ts` - `connectionOf` extracted from `modelOf`, `listModels`, the per-endpoint catalogue cache, `probe` reading it, and the catalogue handed to `facioSession`.
- `UPDATE: packages/agent-facio/src/session.ts` - `models()` answering the catalogue for the session's connection, falling back to the configured id.
- `UPDATE: docs/PLUGINS.md` - the list is the endpoint's; the configured `model` is the default.
- `CREATE: test/agent-facio-models.test.ts` - the cases below.

## Steps

1. Extract the endpoint resolution `modelOf` already does into `connectionOf(options, settings, credentials, harness)`, answering the resolved model id, the spelling it came from, the base URL, key, headers and the provider prefix a listed model is selected under, and let `modelOf` keep the two refusals for a call that actually builds a model.
2. Accept this backend's own provider id as a prefix for the endpoint it was configured with, so a catalogue read from an endpoint no harness entry names is still selectable; an unknown prefix is still refused by name.
3. `listModels(connection)`: `GET <baseUrl>/models` with the key and headers, bounded by `AbortSignal.timeout`, answering `[{ id: '<prefix>/<id>', name }]` and `[]` for anything that fails or is not shaped like the OpenAI-compatible list.
4. Cache the list by endpoint and key for the life of the backend, never caching an empty answer; have `probe` await the configured connection's catalogue, prepend the configured model when the list does not carry it, and skip the call entirely when `options.adapter` is set.
5. Hand the cache to `facioSession` and answer `models()` from it for the session's current settings and credentials, falling back to the configured id when it is not there yet.
6. Name the behaviour in `docs/PLUGINS.md` beside the harness configuration.

## Validation

- `test/agent-facio-models.test.ts`:
  - a stubbed `GET /models` with three models offers all three, each `<provider>/<id>`, in the endpoint's order, and the request carried the key.
  - a configured `model` the list does not carry is offered first, and one it does carry is not repeated.
  - an endpoint that refuses, times out or answers a wrong shape offers the configured model alone.
  - every offered id resolves through `modelOf` to that provider's endpoint and key.
  - an endpoint named only by `options.baseUrl` offers ids under this backend's provider id and they resolve to that endpoint.
  - an `adapter` is never asked over the network.
- `test/agent-facio.test.ts`, `test/agent-facio-config.test.ts` and `test/agent-facio-turn.test.ts` still pass.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-20.
`agent.ts` gained `connectionOf`, the endpoint resolution `modelOf` already did, now answering the resolved model id, the spelling it came from, the base URL, key, headers and the provider prefix a listed model is selected under; `modelOf` is a strict call on it that keeps its two refusals, and an endpoint with no harness entry is selectable under this backend's own provider id.
`listModels` reads `GET <baseUrl>/models` with the key and headers under `AbortSignal.timeout(5000)`, offering each model as `<provider>/<id>` with its `name` or its id, and answers `[]` for a refusal, a wrong status or a shape that is not a catalogue.
The backend caches the list by endpoint and key, never caching an empty answer, and `probe` offers it with the configured model first when the list does not carry it; a caller that passed an `adapter` is never asked over the network.
`facioSession` takes the same cache and answers `models()` from it for the endpoint and key in force, falling back to the configured id until the endpoint has answered.
`test/agent-facio-models.test.ts` is nine cases: the catalogue with the key sent, the configured default first and not repeated, the configured model alone when the endpoint refuses (and the endpoint asked again rather than remembered as empty), the same for a bad status or shape, every offered id resolving through `modelOf` to that provider's endpoint and key, an endpoint no harness entry owns under this backend's own prefix, no call at all with an `adapter`, a session answering the catalogue, and the root channel advertising all of it with `provider` on each row.
Verified: the nine facio test files 68 passed, the full suite 799 passed, `pnpm typecheck` green, `pnpm boundary` green.
Departure from the plan: one real bug was found by the tests rather than by reading - `connectionOf` first returned the whole reference as the model id when the prefix was the backend's own, which would have sent `facio/qwen/qwen3-8b` to the endpoint verbatim; the model id is the part after the first slash whenever there is a slash at all.
Also updated beyond the task's files: `test/agent-facio.test.ts`'s probe case now passes an `adapter`, because it asserted the single-row fallback while reaching for whatever endpoint the machine running the suite happened to have.

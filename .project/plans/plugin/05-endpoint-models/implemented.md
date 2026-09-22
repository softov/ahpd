---
title: The facio backend offers every model the endpoint serves - implemented
date: 2026-09-20
refs:
  - git://713cd5e
  - code://packages/agent-cofold/src/agent.ts
  - code://packages/agent-cofold/src/session.ts
  - code://packages/agent-cofold/src/config.ts
  - code://test/agent-cofold-models.test.ts
  - code://packages/agent-claude/src/probe.ts
  - code://docs/PLUGINS.md
  - https://openrouter.ai/docs/api-reference/list-available-models
---

A facio backend now offers the models its configured endpoint serves rather than the one the harness configuration named.
The configuration's `model` is what it was meant to be: the default a session starts on, offered first when the endpoint's list does not carry it, and the only row when the endpoint cannot be asked.
A person on OpenRouter chooses among OpenRouter's models in the window, and each listed id carries the provider prefix, so choosing one selects that provider's endpoint, key and headers along with the model.

## What was built

- `code://packages/agent-cofold/src/agent.ts` - `connectionOf`, the endpoint resolution `modelOf` already performed, answering the resolved model id, the spelling it came from, the base URL, key, headers and the prefix a listed model is offered under; `modelOf` is the strict call on it, keeping the refusal for a model that was never chosen and for a reference naming a provider the harness file does not carry, and accepting this backend's own provider id for the endpoint it was configured with.
- `code://packages/agent-cofold/src/agent.ts` - `listModels`, one OpenAI-compatible `GET <baseUrl>/models` with the key and headers under `AbortSignal.timeout(5000)`, offering `[{ id: '<provider>/<id>', name }]` and `[]` for a refusal, a wrong status or a shape that is not a catalogue; a per-backend cache by endpoint and key that never stores an empty answer; `probe` awaiting it and prepending the configured model when the list does not carry it, and skipping the call entirely when an `adapter` was passed.
- `code://packages/agent-cofold/src/session.ts` - `models()` answers the same cache for the endpoint and key in force, falling back to the configured id until the endpoint has answered, so a session cannot shrink the list a picker was drawn from.
- `code://docs/PLUGINS.md` - "The models a session can run on": the endpoint's catalogue, the `<provider>/<model id>` reference, the configured model as the default, and the `adapter` that is never asked.

## Verified

- `test/agent-cofold-models.test.ts` - nine cases: the catalogue with the key sent, the configured default first and not repeated, the configured model alone when the endpoint refuses and asked again rather than remembered as empty, the same for a bad status or shape, every offered id resolving through `modelOf` to that provider's endpoint and key, an endpoint no harness entry owns under this backend's own prefix, no call at all with an `adapter`, a session answering the catalogue and its own model until then, and the root channel advertising all of it with `provider` on each row.
- `npx vitest run` - 57 files, 799 tests, all passed.
- `tsc -p tsconfig.json --noEmit` green; `node scripts/boundary.mjs` green.
- Not run: a probe against the real OpenRouter, which needs the machine's key; the endpoint contract is exercised with a stubbed `GET /models` in the OpenAI-compatible shape OpenRouter publishes.

## Departures from the plan

- The plan's open question was settled as proposed: a model listed under the backend's own provider id resolves to the endpoint this backend was configured with, and an unknown prefix is still refused by name.
- One bug was found by the tests and not by reading: `connectionOf` first answered the whole reference as the model id when the prefix was the backend's own, which would have sent `facio/qwen/qwen3-8b` to the endpoint verbatim. The model id is the part after the first slash whenever there is one.
- `test/agent-cofold.test.ts`'s probe case now passes an `adapter`, because it asserted the single-row fallback while reaching for whatever endpoint the machine running the suite happened to have - a real OpenAI-compatible server on the default port would have changed the answer.

## Left for later

- The catalogue is read once per endpoint and key and cached, so a model the endpoint adds after startup is listed only after a restart or a change of endpoint; a refresh on a timer is not built and nothing asked for one.
- Per-model `configSchema` is not offered, because facio has no per-model options the way Claude's thinking levels are; a model row carries `id` and `name` only.

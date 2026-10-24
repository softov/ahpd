---
title: The docs name a model by its provider
status: implemented
depends: [task-03-a-fetched-model-is-callable.md, task-04-the-models-list-carries-openrouter-fields.md, task-05-the-openai-paths-answer-at-the-root.md]
layer: "docs"
refs:
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - the proxy's guide"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - the adapter section, which gets `models` and `prefix`"
  - "[code://.project/plans/proxy/00-proxy.md](../../00-proxy.md) - what exists in the proxy domain"
---

## Objective

The guide says that a provider's models are callable as `<provider>/<id>`, what the list carries, and that `http://host:port` is one base URL.

## Files

- `UPDATE: docs/server/PROXY.md` - fetched names, the table as aliases, the list's fields and the base URL.
- `UPDATE: docs/plugins/PLUGINS.md` - `Adapter.models` and `ModelProvider.prefix`.
- `UPDATE: .project/plans/proxy/00-proxy.md` - the catalog, the root paths and the runtime path.

## Steps

1. Write in `PROXY.md` that each model a provider lists is callable as `<provider>/<id>`.
2. Give the `openrouter/anthropic/claude-sonnet-5.5` and `local/llama-3` examples.
3. Write that the table is for an alias over one or more providers, and wins over a fetched name.
4. Write the list's fields, `pricing` in dollars per token, and that a file price wins.
5. Write that `http://host:port` is the base URL for an OpenAI SDK and an Anthropic SDK.
6. Add `models` and `prefix` to the adapter section of `PLUGINS.md`.
7. Update `00-proxy.md`, and run lint-prose on it.

## Validation

- Each example in `PROXY.md` matches a test in `proxy-route.test.ts` or `proxy-listener.test.ts`.
- `node <skill-dir>/scripts/lint-prose.mjs .project/plans/proxy/00-proxy.md` passes.

## Resume

- **Done so far:** `docs/server/PROXY.md` says each model a provider lists is callable as `<provider>/<id>`. It gives the OpenRouter and local examples, and the table as an alias that wins. It covers the routing of a fetched name, and the list's fields with `pricing` per token. It says a file price wins, names both root paths, and gives `http://host:port` as one base URL. `docs/plugins/PLUGINS.md` gives `ProviderConnector.models` and `ModelProvider.prefix` in the adapter section. `.project/plans/proxy/00-proxy.md` names the catalog, the root paths, the fetched name in the runtime path and the catalog's test.
- **Next action:** none for this task.
- **Open questions:** none.
- **Watch out for:** `PROXY.md` keeps sentences it had before this plan that the prose linter reports as long. Only the sentences this plan wrote were shortened.
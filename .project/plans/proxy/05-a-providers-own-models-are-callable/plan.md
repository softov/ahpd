---
title: A provider's own models are callable, and the proxy answers at the root
domain: proxy
status: active
priority: high
created: 2026-10-24
revalidated: 2026-10-24
requires: [plans/proxy/04-providers-are-connectors/plan.md]
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L110-L125](../../../../packages/sdk/src/types/connectors.ts#L110-L125) - `ModelProvider`, which gets `prefix`"
  - "[code://packages/sdk/src/types/connectors.ts#L226-L291](../../../../packages/sdk/src/types/connectors.ts#L226-L291) - `Adapter`, which gets `models`"
  - "[code://packages/sdk/src/connectors/channel.ts#L157](../../../../packages/sdk/src/connectors/channel.ts#L157) - `providers()`, the open provider connectors"
  - "[code://packages/server/src/proxy/route.ts#L105](../../../../packages/server/src/proxy/route.ts#L105) - `namedBy`, which finds the connectors an entry names"
  - "[code://packages/server/src/proxy/route.ts#L234](../../../../packages/server/src/proxy/route.ts#L234) - `route`, which reads a name the table does not hold as `<prefix>/<id>`"
  - "[code://packages/server/src/proxy/providers.ts#L111](../../../../packages/server/src/proxy/providers.ts#L111) - `MODEL_NAME`, one slash in a table name"
  - "[code://packages/server/src/proxy/dialects.ts#L16-L47](../../../../packages/server/src/proxy/dialects.ts#L16-L47) - `CALLER_PATHS`, `MODELS_PATH` and `ROOT_PATHS`"
  - "[code://packages/server/src/proxy/dialects.ts#L328](../../../../packages/server/src/proxy/dialects.ts#L328) - `modelList`, which sends the names and their fields"
  - "[code://packages/server/src/proxy/listener.ts#L279](../../../../packages/server/src/proxy/listener.ts#L279) - `costOf`, which prices a call from the entry"
  - "[code://packages/server/src/proxy/listener.ts#L727-L796](../../../../packages/server/src/proxy/listener.ts#L727-L796) - the models list and the path dispatch"
  - "[code://packages/server/src/http.ts#L128-L150](../../../../packages/server/src/http.ts#L128-L150) - `PROXY_PREFIX` and `withoutApi`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L124](../../../../packages/sdk/src/plugins/plugins.ts#L124) - `ROUTE_ROOT`, so a plugin route is always under `/plugins`"
  - "[code://packages/sdk/src/access/decide.ts#L68](../../../../packages/sdk/src/access/decide.ts#L68) - a policy value with `*`, so `openrouter/*` names every OpenRouter model"
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - the proxy's guide"
  - file:///github/ahp-review/briefs/model-proxy.md - answers 2, 3 and 4, which this plan builds
  - https://openrouter.ai/docs/api-reference/list-available-models - OpenRouter's list and the names of its fields
---

## Goal

A model that a provider lists is callable as `<provider>/<id>`, with no line in the file.
`GET /models` lists those models with OpenRouter's fields: `name`, `context_length`, `pricing`, and `total_count` at the top.
The OpenAI paths also answer at the root, so `http://host:port` is one base URL for every SDK.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The line numbers are from the proxy 04 build, and are checked again after proxy 04 merges.

### Searches performed

- `rg -n "PROXY_PREFIX|MODELS_PATH|CALLER_PATHS" packages/server/src` - the proxy answers only under `/v1`, and `withoutApi` sends `/v1` to the API handler.
- `rg -n "ROUTE_ROOT" packages/sdk/src` - every plugin route is under `/plugins`, so no plugin route can take `/models` or `/chat/completions`.
- `rg -n "MODEL_NAME" packages/server/src/proxy` - a table name holds one slash, and a fetched name such as `openrouter/anthropic/claude-sonnet-5.5` holds two.

### Runtime path

```
connector opens -> adapter.models(connector) -> catalog, kept in memory, again each hour
POST /chat/completions | /v1/chat/completions, model openrouter/anthropic/claude-sonnet-5.5
  -> table name? the entries : first segment is a provider prefix -> entry { provider: prefix, id: the rest }
  -> route by tier as proxy 04 -> fetch upstream
GET /models | /v1/models -> table names + catalog names the caller may use, with name, context_length, pricing
```

### Gaps

- OpenRouter serves 469 models, and none is callable until the file names it.
- `/v1/models` sends the names only.
- An OpenAI SDK needs `http://host:port/v1` and an Anthropic SDK needs `http://host:port`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A provider's own list is fetched, and its ids are callable as `<provider>/<id>`. The table stays only for an alias | Softov, 2026-10-23 | 03 |
| `<provider>` is the adapter name, such as `openrouter/anthropic/claude-sonnet-5.5`. An `openai-compatible` connector has no vendor name, so its models are `<connector id>/<id>`, such as `local/llama-3` | Softov, 2026-10-24 | 01, 02, 03 |
| The models list carries OpenRouter's fields: `name`, `context_length`, `pricing`, and `total_count` at the top | Softov, 2026-10-23 | 04 |
| The fields come from the first provider the name routes to, and a price written in the file wins over the fetched one | Softov, 2026-10-23 | 04 |
| `/v1` stays. The OpenAI paths are also served at the root, as LiteLLM does | Softov, 2026-10-23 | 05 |
| Anthropic paths stay under `/v1` only | Softov, 2026-10-23 | 05 |
| A plugin route cannot take one of those root paths | Softov, 2026-10-23; [code://packages/sdk/src/plugins/plugins.ts#L124](../../../../packages/sdk/src/plugins/plugins.ts#L124) already keeps every route under `/plugins` | 05 |
| An adapter lists its models through `Adapter.models(connector)`, and answers them in OpenRouter's field names | (defaulted: each vendor's list has its own shape, and the adapter knows it) | 01, 02 |
| Each `providers()` row carries a `models()` bound to its open connector, so the connector and its key never leave the channel | Softov, 2026-10-24 | 03 |
| `ModelProvider.prefix` is the first segment of a fetched name, and is the adapter name when absent | (defaulted: the `openai-compatible` adapter answers its connector id there) | 01, 02 |
| The host fetches a connector's list when the connector first opens, and again each hour. A failed fetch keeps the last list and writes one line to the log | (defaulted: a list changes slowly, and a failure must not empty it) | 03 |
| A name in the table wins over a fetched name with the same spelling | (defaulted: the table is what a person wrote) | 03 |
| A `<provider>/<id>` call is sent even when the list does not hold `<id>` yet, and the provider answers it | (defaulted: a call works before the first fetch ends, and the provider's 404 names the model) | 03 |
| A `model` policy names the whole name, such as `openrouter/*` | (defaulted: no change to the policy shape) | 03 |
| A fetched name with no price in the file is charged at the fetched `pricing` | (defaulted: the list and the record show one price) | 03 |
| `pricing` is OpenRouter's shape: dollars per token, as strings. A price in the file is per million tokens, and is divided for the list | (defaulted: OpenRouter's field names mean OpenRouter's units) | 04 |
| The Anthropic shape of the list gets the same three fields on each model | (defaulted: one list, two shapes) | 04 |
| Root `/models` is answered in the dialect of the headers, as `/v1/models` is | (defaulted: as today) | 05 |
| `ahpd proxy list` still prints the table names only | (defaulted: the catalog is in the daemon's memory, and the command reads the file) | - |
| Proxy plan 06 serves each further endpoint at the root and under `/v1` | (defaulted: answer 4 covers every OpenAI path) | - |

## Proposed architecture

- **Data flow** - an adapter's `models` answers a list. The host keeps it in a catalog by connector. The route turns a name that is not in the table into one entry.
- **Event flow** - an open connector is fetched at once, and again on an hourly timer. A closed connector leaves the catalog.
- **State flow** - the catalog lives in memory only. A restart fetches each list again.
- **Layer responsibilities** - sdk: `ProviderModel`, `Adapter.models` and `ModelProvider.prefix`.
  server: the four adapters' lists, the catalog, the route, the models list and the root paths.
  docs: the proxy guide.
- **Source-of-truth files** - [`code://packages/server/src/proxy/route.ts`](../../../../packages/server/src/proxy/route.ts) and [`code://packages/server/src/proxy/dialects.ts`](../../../../packages/server/src/proxy/dialects.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An adapter lists its models](task-01-an-adapter-lists-its-models.md) | implemented | - |
| [02 - The host adapters list their models](task-02-the-host-adapters-list-their-models.md) | implemented | 01 |
| [03 - A fetched model is callable](task-03-a-fetched-model-is-callable.md) | implemented | 01, 02 |
| [04 - The models list carries OpenRouter's fields](task-04-the-models-list-carries-openrouter-fields.md) | implemented | 03 |
| [05 - The OpenAI paths answer at the root](task-05-the-openai-paths-answer-at-the-root.md) | implemented | - |
| [06 - The docs name a model by its provider](task-06-the-docs-name-a-model-by-its-provider.md) | implemented | 03, 04, 05 |

## Risks and tradeoffs

- OpenRouter's list is about 470 models, so `GET /models` grows from a few names to hundreds. A policy narrows what each caller sees.
- A fetched name holds two slashes. A tool that splits a model name at the first slash reads `openrouter` as the maker.
- A name sent before the first fetch has no price, so its call is charged what the provider reports, or nothing.
- The root paths sit beside AHP on one listener. Only `/chat/completions`, `/models` and the paths of proxy 06 are taken.

## Resume state

- **Done so far:** all six tasks are implemented. `Adapter.models(connector)` exists, the four host adapters answer it, and `providers()` binds each row's `models()` to its open connector. `ModelProvider.prefix` exists, and `openai-compatible` answers its connector id there. `packages/server/src/proxy/catalog.ts` keeps each open connector's list. `route` reads a name the table does not hold as `<prefix>/<id>`, and the models list carries `name`, `context_length`, `pricing` and `total_count`. The OpenAI paths answer at the root beside `/v1`, and the docs name a model by its provider. The refs' line numbers are corrected to this tree.
- **Next action:** Softov reads the final verification checklist below, then the plan is closed with `implemented.md`.
- **Open questions:** none.
- **Watch out for:** a table name keeps the one-slash rule of `MODEL_NAME`. Only a fetched name holds more.

## Final verification checklist

- [ ] A real OpenRouter connector lists its models at `GET /models`, and `openrouter/<id>` answers a chat call.
- [ ] An OpenAI SDK with base URL `http://host:port` and an Anthropic SDK with the same base URL both answer.
- [ ] `plans/index.md` updated.

---
title: A model provider is a connector
domain: proxy
status: built
priority: high
created: 2026-10-23
revalidated: 2026-10-23
requires: [plans/plugin/60-a-connector-shows-whether-it-works/plan.md]
changes: []
creates: []
refs:
  - "[code://packages/server/src/proxy/providers.ts#L97-L116](../../../../packages/server/src/proxy/providers.ts#L97-L116) - `BUILT_IN_PROVIDERS`, the three providers this plan removes"
  - "[code://packages/server/src/proxy/providers.ts#L193-L225](../../../../packages/server/src/proxy/providers.ts#L193-L225) - `proxyProblems`, which checks `modelProxy.providers` today"
  - "[code://packages/server/src/proxy/route.ts#L61-L107](../../../../packages/server/src/proxy/route.ts#L61-L107) - `route`, which reads a provider's key from the environment"
  - "[code://packages/server/src/proxy/listener.ts#L43-L86](../../../../packages/server/src/proxy/listener.ts#L43-L86) - `ProxyOptions`, with `proxy()` and `env`"
  - "[code://packages/server/src/proxy/listener.ts#L731-L760](../../../../packages/server/src/proxy/listener.ts#L731-L760) - the `ModelUse` a proxy call writes"
  - "[code://packages/server/src/proxy/dialects.ts#L129](../../../../packages/server/src/proxy/dialects.ts#L129) - `upstreamHeaders`, which puts the key in each dialect's header"
  - "[code://packages/server/src/commands/run.ts#L556-L570](../../../../packages/server/src/commands/run.ts#L556-L570) - where the proxy is built"
  - "[code://packages/server/src/commands/run.ts#L725-L758](../../../../packages/server/src/commands/run.ts#L725-L758) - the adapters map and the connectors channel"
  - "[code://packages/server/src/commands/proxy.ts](../../../../packages/server/src/commands/proxy.ts) - `ahpd proxy list`, which prints the providers today"
  - "[code://packages/server/src/icons.ts](../../../../packages/server/src/icons.ts) - `resolveIcons`, which reads an icon file into a `data:` URI"
  - "[code://packages/sdk/src/types/connectors.ts#L26](../../../../packages/sdk/src/types/connectors.ts#L26) - `CapabilityType`, which gets `models`"
  - "[code://packages/sdk/src/types/connectors.ts#L105](../../../../packages/sdk/src/types/connectors.ts#L105) - `Adapter`, which gets `provider`"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts) - the connectors channel, which lists its open providers"
  - "[code://packages/sdk/src/types/usage.ts#L67-L78](../../../../packages/sdk/src/types/usage.ts#L67-L78) - `ModelCall`, which gets `connector`"
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - the proxy's guide"
  - file:///github/ahp-review/briefs/model-proxy.md - answers 1, 6 and 9, which this plan builds
---

## Goal

A model provider is a connector, and only a connector.
A person adds one in the connectors screen, with its key in the vault or in a daemon variable, and with no restart.
The host ships four provider adapters: `openrouter`, `anthropic`, `openai` and `openai-compatible`.
A person's own provider connector is used for their own calls before the host's.
`modelProxy.providers`, the three built-in providers and their environment keys are removed.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "BUILT_IN_PROVIDERS|proxyConfiguration|proxyProblems" packages/server/src` - `options.ts` reads the setting, and `run.ts` hands it to the proxy.
- `rg -n "registerAdapter|adapters =" packages/server/src/commands/run.ts` - every adapter comes from a plugin today, and the host registers none.
- `rg -n "provider" packages/sdk/src/access/decide.ts` - a `model` policy names the provider of a call.

### Runtime path

```
put x-ahpd/connectors (adapter openrouter, key) -> vault -> open -> check (plugin 60)
tool -> POST /v1/chat/completions -> route: model entry names openrouter
  -> the caller's own open openrouter connector, then the scope team's, then the host's
  -> adapter.provider(connector): endpoint, dialects, key -> fetch upstream
  -> connectors.note(id, outcome) -> ModelUse with provider and connector
```

### Gaps

- A provider is written in the file, and changing one needs a restart.
- A key is a daemon variable only, and the vault is not read.
- A person cannot bring their own key.
- A plugin cannot add a provider.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A provider is a connector, and only a connector. `modelProxy.providers`, the three built-ins and their environment keys are removed | Softov, 2026-10-23 | 03 |
| A file that still has `modelProxy.providers` is refused, with a message that names connectors | Softov, 2026-10-23 | 03 |
| The host ships the `openrouter`, `anthropic`, `openai` and `openai-compatible` adapters | Softov, 2026-10-23 | 02 |
| The four adapters live in the server, and the host registers them beside the plugins' adapters, with no `plugins` entry | Softov, 2026-10-23 | 02 |
| Each provider adapter carries its own icon, through `Adapter.icons` from plugin 58 | Softov, 2026-10-23 | 02 |
| A provider key is a connector secret: a value in the vault, or `{ "fromEnv": "<NAME>" }` on a host connector | Softov, 2026-10-23 (plugin 60) | 02 |
| A person may own a provider connector. The proxy uses the caller's own first, then the host's, and the usage record names whose key paid | Softov, 2026-10-23 | 03 |
| A model entry's `provider` names an adapter, and the proxy takes the caller's own open connector of it, then the scope team's, then the host's | Softov, 2026-10-23 | 03 |
| A model entry's `provider` may also name one connector id, which is the way to name one `openai-compatible` endpoint | Softov, 2026-10-23 | 03 |
| An adapter that serves models declares a `models` capability, and answers `provider(connector)` with its endpoint, dialects and key | (defaulted: the capability tells a client, and the member tells the host) | 01 |
| A plugin may register a provider adapter too, with the same capability and member | (defaulted: one seam for the host's adapters and a plugin's) | 01 |
| The connectors channel lists its open provider connectors for the proxy, with each one's owner | (defaulted: the proxy reads what the channel opened, and opens nothing) | 01 |
| `openrouter`, `anthropic` and `openai` take `key`, which is required, and `endpoint`, which defaults to today's built-in endpoint | (defaulted: today's built-ins, with the key moved into the form) | 02 |
| `openai-compatible` takes `endpoint`, which is required, `key`, which is optional, and `accepts`, which defaults to `["openai-chat"]` | (defaulted: a local server often needs no key) | 02 |
| `openrouter` and `openai` accept `openai-chat`, and `anthropic` accepts `anthropic-messages` | (defaulted: today's built-ins) | 02 |
| Each check is one call that needs the key: `GET /key` on OpenRouter, `GET /models` on OpenAI and on an OpenAI-compatible endpoint, and `GET /v1/models` on Anthropic | (defaulted: OpenRouter answers `/models` with no key, so that call proves nothing) | 02 |
| A check answers `ok` for 2xx, `denied` for 401 and 403, `unreachable` when the call does not connect, and `failed` with the status otherwise | (defaulted: plugin 60's four outcomes) | 02 |
| The icons are the vendors' own marks in colour, and `openai-compatible` is the OpenAI mark in yellow | Softov, 2026-10-24: "open ai icons are not the same. the compact could be the same just yellot. anthropic also is not the same logo." | 02 |
| A team connector serves a call only when the call's scope is that team | (defaulted: as a team's secret is read only for that team's work) | 03 |
| Two connectors in one tier are tried in id order, and each one after the first is a fallback | (defaulted: today's fallback, before the first byte) | 03 |
| Each attempt is reported through `note`: 2xx is `ok`, and any other status or a failed connection is a failure with its status or error | (defaulted: plugin 60 left `note` for the proxy) | 03 |
| `ModelCall` gets `connector`, the id of the connector that answered, beside `provider` | (defaulted: the connector id names whose key paid) | 03 |
| A `model` policy names the provider as the entry writes it, an adapter or a connector id | (defaulted: no change to the policy shape) | 03 |
| A call with no open connector for its entries is a 503 that names the provider it looked for | (defaulted: today's missing key refusal) | 03 |
| The file no longer checks that an entry's provider exists, because connectors are known only at run time | (defaulted: the route answers it on each call) | 03 |
| `ahpd proxy list` prints the model names only. The providers are listed as connectors | (defaulted: the command reads the file, and connectors live in a store) | 03 |
| Softov's `config-dev.json` has `providers.local`, so a pending file says how to move it to a connector before the restart | (defaulted: the daemon refuses that file once this merges) | 04 |
| `<provider>/<id>` names and the root paths are proxy plan 05, and the other endpoints are proxy plan 06 | Softov, 2026-10-23 | - |

## Proposed architecture

- **Data flow** - a provider connector is a record with its key in the vault. The channel opens it and lists it. The route reads the list on each call and picks connectors by owner.
- **Event flow** - a put opens and checks the connector at once. Each proxy attempt reports its outcome through `note`.
- **State flow** - the model names table stays in the file. Providers live in the connectors store, and their health in memory.
- **Layer responsibilities** - sdk: the capability, `Adapter.provider` and the channel's list.
  server: the four adapters, their icons, the route and the refusal of the old key.
  docs: the proxy guide and the adapter section.
- **Source-of-truth files** - [`code://packages/server/src/proxy/route.ts`](../../../../packages/server/src/proxy/route.ts) and [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An adapter can serve models](task-01-an-adapter-can-serve-models.md) | done | - |
| [02 - The host ships four provider adapters](task-02-the-host-ships-four-provider-adapters.md) | done | 01 |
| [03 - The proxy routes through connectors](task-03-the-proxy-routes-through-connectors.md) | done | 01, 02 |
| [04 - The docs say a provider is a connector](task-04-the-docs-say-a-provider-is-a-connector.md) | done | 03 |

## Risks and tradeoffs

- Every deployment with `modelProxy.providers` stops at start until the file moves to connectors. The message names what to do.
- A deployment that relied on `OPENROUTER_API_KEY` and its siblings loses its providers. A host connector with `{ "fromEnv": "OPENROUTER_API_KEY" }` restores one.
- `provider(connector)` hands the proxy the key in memory. Only host code reads that list, and no channel sends it.
- An entry that names an adapter with two host connectors uses both, in id order. A person who wants one names its connector id.

## Resume state

- **Done so far:** all four tasks are implemented. An adapter declares `models` and answers `provider`, and the host ships four provider adapters with icons. The proxy routes through the open connectors in owner order, and the docs and the domain say so.
- **Next action:** none. The plan is built; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the model names table stays in the file and keeps `sessionCalls`. Only `providers` goes, and a file that still writes it is refused at start.

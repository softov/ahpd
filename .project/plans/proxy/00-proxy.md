---
title: Proxy - what exists today
domain: proxy
revalidated: 2026-10-24
---

The proxy forwards model calls from people's own tools (Claude Code, scripts) to a model provider. It carries them under their ahpd identity, so the calls can be routed, recorded and limited.
It is not an agent: it holds no session and runs nothing.
It is served under `/v1` while `modelApi` is on, on the HTTP API's listener or on its own.
Each call is in the caller's dialect and streamed back unchanged; see [`docs/server/PROXY.md`](../../../docs/server/PROXY.md).
The OpenAI endpoints answer at the root as well, so `http://host:port` is one base URL for both SDKs.
A provider is a connector, made from one of the four provider adapters the host ships. Its key is a vault secret, or a daemon variable that a host connector names.
Each model a connector lists is callable as `<provider>/<id>`, and the `modelProxy` table holds the aliases over one or more providers.

## Packages

- [`code://packages/server`](../../../packages/server) - config, commands and listeners; the proxy lives here.

## Contracts

- [`code://packages/server/src/config.ts`](../../../packages/server/src/config.ts) - `Config`, where the proxy's settings go.
- [`code://packages/server/src/proxy/providers.ts`](../../../packages/server/src/proxy/providers.ts) - the model names, the entries that serve each, and `modelProxy.sessionCalls`.
- [`code://packages/server/src/proxy/adapters.ts`](../../../packages/server/src/proxy/adapters.ts) - the four provider adapters the host ships, with their forms, checks, icons, `provider`, `models` and `prefix`.
- [`code://packages/server/src/proxy/catalog.ts`](../../../packages/server/src/proxy/catalog.ts) - `modelCatalog`, each open connector's own list, read at first sight and each hour.
- [`code://packages/server/src/proxy/listener.ts`](../../../packages/server/src/proxy/listener.ts) - `proxyHandler` and `ProxyOptions`, whose `whose` hook answers a session's own token and whose `catalog` hook is the provider lists.
- [`code://packages/server/src/proxy/caller.ts`](../../../packages/server/src/proxy/caller.ts) - `SessionCaller`, `ProxyCaller` and `callerOf`.
- [`code://packages/server/src/proxy/route.ts`](../../../packages/server/src/proxy/route.ts) - `route`, which answers a name in the table or a fetched `<prefix>/<id>`, and `upstreamUrl`.
- [`code://packages/server/src/proxy/dialects.ts`](../../../packages/server/src/proxy/dialects.ts) - one row per dialect: its caller paths, upstream path, family, kind and usage reader, with the error bodies, key headers and the models list.
- [`code://packages/server/src/proxy/responseids.ts`](../../../packages/server/src/proxy/responseids.ts) - the Responses id, which holds its connector, and the rewrite of a JSON answer and an SSE stream.
- [`code://packages/server/src/commands/registry.ts`](../../../packages/server/src/commands/registry.ts) - commands declared once, CLI and `/api`.

## Runtime path

```
tool -> POST /v1/chat/completions | /chat/completions | /v1/messages | /v1/messages/count_tokens | /responses | /responses/input_tokens | /embeddings | /images/* | /audio/* | /rerank, and the root twins, on the listener `modelApi` names
  -> guard (Host, loopback at any port, Origin) -> caller: deployment token | whose | users.verify + proxy:write
  -> scope: X-AHP-Scope | ?scope= | primary -> body (32 MiB, JSON, model)
  -> connectors channel: the open provider connectors, with each one's owner
  -> catalog: each open connector's own model list, bound to the open connector, read at first sight and each hour
  -> route: a name in the table, or a fetched <prefix>/<id> from the adapter's name or the connector's id, each on the caller's own connector, then the team's, then the host's
  -> fetch <endpoint><dialect path> with the entry's id and that connector's key; fallback before any byte, each attempt noted on the connector
  -> status, headers and body streamed back; usage read on the way -> ModelUse source 'proxy', with the adapter and the connector
```

## Tests

- [`code://packages/server/test/config-check.test.ts`](../../../packages/server/test/config-check.test.ts) - config checking, `modelProxy.sessionCalls` and the refusal of `providers` included.
- [`code://packages/server/test/proxy-adapters.test.ts`](../../../packages/server/test/proxy-adapters.test.ts) - the four host adapters: forms, `provider`, `models`, `prefix`, checks and icons.
- [`code://packages/server/test/proxy-catalog.test.ts`](../../../packages/server/test/proxy-catalog.test.ts) - the catalog: the first read, the hourly read, a failed read and a closed connector.
- [`code://packages/server/test/proxy-route.test.ts`](../../../packages/server/test/proxy-route.test.ts) - routing over Softov's table, and a fetched `<prefix>/<id>`.
- [`code://packages/server/test/proxy-listener.test.ts`](../../../packages/server/test/proxy-listener.test.ts) - the guard, the refusal shapes, the caller, the models list and the root paths.
- [`code://packages/server/test/proxy-listener.test.ts`](../../../packages/server/test/proxy-listener.test.ts) - count tokens, embeddings, rerank, and the mount in a real daemon.
- [`code://packages/server/test/proxy-responses.test.ts`](../../../packages/server/test/proxy-responses.test.ts) - the Responses id, its follow-ups, a forged id and a streamed create.
- [`code://packages/server/test/proxy-images.test.ts`](../../../packages/server/test/proxy-images.test.ts) - an image generation, a multipart edit, OpenRouter's path and image usage.
- [`code://packages/server/test/proxy-audio.test.ts`](../../../packages/server/test/proxy-audio.test.ts) - speech bytes and their charge, and a transcription by tokens or seconds.
- [`code://packages/server/test/proxy-forward.test.ts`](../../../packages/server/test/proxy-forward.test.ts) - headers out and back, SSE streaming, timeouts, hang-up and fallback.
- [`code://packages/server/test/proxy-policy-usage.test.ts`](../../../packages/server/test/proxy-policy-usage.test.ts) - `model` policies and usage records, session calls at `record` and `skip`.

## Known gaps

- Nothing fills `whose` yet; container/05 p12 task 01 does.
- No translation between dialects, no cache prices, no cache-affinity routing.
- Limits and pools are not enforced (policy/02).
- Batches are proxy 07.

---
title: A model provider is a connector - implemented
date: 2026-11-04
refs:
  - git://ea09d2f0 - the merge of #84
  - "[code://packages/server/src/proxy/route.ts](../../../../packages/server/src/proxy/route.ts) - the route reads the open provider connectors"
  - "[code://packages/server/src/proxy/adapters.ts](../../../../packages/server/src/proxy/adapters.ts) - the four provider adapters"
---

A model provider is a connector, made from one of four adapters the host ships, with its key in the vault or a daemon variable. The proxy routes each call through the open connectors. `modelProxy` keeps the model names only.

## What was built

- [`code://packages/server/src/proxy/adapters.ts`](../../../../packages/server/src/proxy/adapters.ts) - the four provider adapters, with their forms, checks and icons.
- [`code://packages/server/src/proxy/route.ts`](../../../../packages/server/src/proxy/route.ts) - the route over the open connectors, in owner order.
- [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - the channel's provider list.
- [`code://docs/server/PROXY.md`](../../../../docs/server/PROXY.md) - the guide to adding a provider.

## Verified

- On a test daemon at `8b5423b2`, on 2026-11-04, `/v1/models` listed 417 `openrouter/` names and a call answered.
- On 2026-11-04 Softov ran the checks of `pending/proxy-04-move-config-dev.md` on his own `config-dev.json`, after #237 split `modelApi` from `httpApi`. They passed.

## Departures from the plan

- None.

## Left for later

- Nothing.

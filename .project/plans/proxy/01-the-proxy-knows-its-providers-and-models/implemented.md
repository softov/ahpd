---
title: The proxy knows its providers and model names - implemented
date: 2026-10-01
refs:
  - "[code://packages/server/src/proxy/providers.ts](../../../../packages/server/src/proxy/providers.ts)"
  - "[code://packages/server/src/commands/proxy.ts](../../../../packages/server/src/commands/proxy.ts)"
---

The configuration file has a `proxy` key naming providers and `<maker>/<name>` model names with the providers serving each, over three built-in providers, and `ahpd proxy list` shows them at the terminal and under `/api`.

## What was built

- [`code://packages/server/src/proxy/providers.ts`](../../../../packages/server/src/proxy/providers.ts) - the provider and model entry types, the built-ins (`openrouter`, `anthropic`, `openai`), the schemas and `proxyProblems`.
- `proxy` in `Config`, the server fields and `checkConfig`, which stops the start on a bad value.
- [`code://packages/server/src/commands/proxy.ts`](../../../../packages/server/src/commands/proxy.ts) - `proxy.list`, `config:read`; a key is shown only as the variable naming it and whether it is set.

## Verified

- `packages/server/test/config-check.test.ts` (the new proxy cases, two over a running daemon) and `packages/server/test/proxy-list.test.ts`.
- `pnpm exec tsc --noEmit` clean; `pnpm test` 132 files, 1975 tests passed.

## Departures from the plan

- A file entry under a built-in id replaces it whole rather than patching it.
- `price` is `{ input, output }` in dollars per million tokens; nothing reads it yet.

## Left for later

- Which provider a model name uses, and cache prices, belong to the proxy listener and routing.

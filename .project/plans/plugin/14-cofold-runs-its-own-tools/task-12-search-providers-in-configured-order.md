---
title: Search providers are tried in the configured order
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/capabilities.ts#L63-L70](../../../../packages/agent-cofold/src/capabilities.ts#L63-L70) - `searchProviders`, a fixed order"
  - "[code://packages/agent-cofold/src/capabilities.ts#L125-L136](../../../../packages/agent-cofold/src/capabilities.ts#L125-L136) - `searchOf`, which rebuilds the value in the fixed order"
  - "file:///github/cofold/packages/tools/src/web.ts - `web({ search })`, which keeps the array's order"
---

## Objective

`web_search` asks its providers in the order `tools.web.search` lists them, per [decision: configured order](../../../decisions/search-providers-are-tried-in-configured-order.md).

## Files

- `UPDATE: packages/agent-cofold/src/capabilities.ts:125-136` - `searchOf` walks the value's own keys in order.
- `UPDATE: packages/agent-cofold/src/capabilities.ts:63-70` - `searchProviders` walks `Object.keys(search)` in order.
- `UPDATE: packages/agent-cofold/src/capabilities.ts:22-29` and `:63` - the comments on `SearchConfig` and `searchProviders` say the configured order.
- `UPDATE: test/agent-cofold-tools.test.ts` - the order cases.

## Steps

1. In `searchOf`, iterate `Object.keys(held)` and add each known provider as it is met, so the result's key order is the configuration's.
2. In `searchProviders`, iterate `Object.keys(search)` and build each provider in that order.
3. `@cofold/tools` needs no change: `web()` tries the array in order.

## Validation

- `toolsOf({ web: { search: { duckduckgo: true, brave: { apiKey: 'b' } } } })` has keys `duckduckgo` then `brave`; it is `brave` then `duckduckgo` today.
- A scripted `web_search` turn with `duckduckgo` listed before `brave`, where both answer through a stubbed `fetch`, returns DuckDuckGo's results; today Brave's come back.
- `node_modules/.bin/vitest run test/agent-cofold-tools.test.ts` green.

## Resume

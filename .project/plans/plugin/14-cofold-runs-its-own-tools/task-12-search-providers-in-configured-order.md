---
title: Search providers are tried in the configured order
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/capabilities.ts#L63-L73](../../../../packages/agent-cofold/src/capabilities.ts#L63-L73) - `searchProviders`, which follows the configured order"
  - "[code://packages/agent-cofold/src/capabilities.ts#L128-L147](../../../../packages/agent-cofold/src/capabilities.ts#L128-L147) - `searchOf`, which keeps the value's own key order"
  - "[code://packages/agent-cofold/src/capabilities.ts#L22-L37](../../../../packages/agent-cofold/src/capabilities.ts#L22-L37) - `SearchConfig` and its comment on the configured order"
  - file:///github/cofold/packages/tools/src/web.ts - `web({ search })`, which keeps the array's order
---

## Objective

`web_search` asks its providers in the order `tools.web.search` lists them.

## Files

- `UPDATE: packages/agent-cofold/src/capabilities.ts:128-147` - `searchOf` walks the value's own keys in order.
- `UPDATE: packages/agent-cofold/src/capabilities.ts:63-73` - `searchProviders` walks `Object.keys(search)` in order.
- `UPDATE: packages/agent-cofold/src/capabilities.ts:22-29` and `:63` - the comments on `SearchConfig` and `searchProviders` say the configured order.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - the order cases.

## Steps

1. In `searchOf`, iterate `Object.keys(held)` and add each known provider as it is met, so the result's key order is the configuration's.
2. In `searchProviders`, iterate `Object.keys(search)` and build each provider in that order.
3. `@cofold/tools` needs no change: `web()` tries the array in order.

## Validation

- `toolsOf({ web: { search: { duckduckgo: true, brave: { apiKey: 'b' } } } })` has keys `duckduckgo` then `brave`; it is `brave` then `duckduckgo` today.
- A scripted `web_search` turn with `duckduckgo` listed before `brave`, where both answer through a stubbed `fetch`, returns DuckDuckGo's results; today Brave's come back.
- `node_modules/.bin/vitest run packages/agent-cofold/test/agent-cofold-tools.test.ts` green.

## Resume

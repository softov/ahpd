---
title: A usage total says the tokens sent and the tokens received, beside the sum - implemented
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts)"
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts)"
  - "[code://packages/sdk/test/usage.test.ts](../../../../packages/sdk/test/usage.test.ts)"
---

A pool's day, week and month total now says three counts of its own. The prompt tokens, the tokens written back and the cached tokens now sit beside the `tokens` sum that was there before.

## What was built

- [`code://packages/sdk/src/types/usage.ts`](../../../../packages/sdk/src/types/usage.ts) - `input`, `output` and `cache` on `UsageTotal`, each optional, and the doc comment saying `tokens` is the three added together.
- [`code://packages/sdk/src/usage.ts`](../../../../packages/sdk/src/usage.ts) - the three counts on `Measured`, set in `measured`, added in `charge` and in the range total, and left out when zero.

## Verified

- `packages/sdk/test/usage.test.ts`, 19 cases. One model call gives `input: 100, output: 20, cache: 12, tokens: 132`. A call with no cache carries no `cache` key. Computer time carries none of the three. A total over a range carries them too.
- The full suite: 249 files and 4326 tests. `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `node tools/schema.mjs` pass.

## Departures from the plan

- None.

## Left for later

- Nothing. The plan named one task, and it is built.

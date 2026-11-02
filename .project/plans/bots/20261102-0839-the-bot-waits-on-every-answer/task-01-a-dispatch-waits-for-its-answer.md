---
title: A dispatch waits for its answer
status: todo
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - `dispatcher`"
---

## Objective

A dispatch on the bot's connection settles on the host's answer with its `clientSeq`, and on nothing else.

## Files

- `UPDATE: packages/bot/src/plugin.ts` - `dispatcher` has no timer; `ECHO_MS` and the silence notice go.
- `CREATE: packages/bot/test/bot-dispatcher.test.ts` - a late refusal is the refusal, and another client's answer settles nothing.

## Steps

1. Remove the timer that settles a dispatch as taken.
2. Settle a dispatch on the action frame with its own `clientId` and `clientSeq`.
3. Export `dispatcher` for its case.

## Validation

- `pnpm exec vitest run packages/bot/test/bot-dispatcher.test.ts` - passes; c3c8c3e4 takes a dispatch as accepted after 10 seconds.

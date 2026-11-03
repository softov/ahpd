---
title: A back session posts more than once - implemented
date: 2026-11-03
refs:
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts)"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
---

A back session can call `post_message` more than once in one turn. Each call adds its text to the open main turn. The main turn ends when the back session's turn ends.

## What was built

- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `say` on `TurnHandle` adds a markdown part and keeps the turn open; `end` completes the subagent call of a turn with an answer.
- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) - `posted` keeps the entry and records `posted`; `finished` ends a posted turn with `end`; `woken` keeps `posted` on a steer.
- [`code://packages/bot/src/post.ts`](../../../../packages/bot/src/post.ts) - the instruction and the tool description say that each call posts.

## Verified

- `pnpm --filter @ahpd/bot test` passes 230, run alone.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- Softov ran a bot that posts twice in one turn on 2026-11-03, and it worked.

## Departures from the plan

- none.

## Left for later

- none.

---
title: A turn ends as VS Code ends it - implemented
date: 2026-11-02
refs:
  - git://36f7faa4 - the last change
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
---

A turn the nested proxy fails says how long it ran.
A bot's turn whose back session failed ends with `chat/error`, in that turn's words.

## What was built

- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - a failed or halted turn's duration.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `TurnHandle.fail`, said as `chat/error`.
- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) and [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - a back session's failure fails the main turn.

## Verified

- Each new or changed case fails on `89ebe4d5`'s sources and passes with the change, as each task's *Resume* names.
- The bot test files pass, each timeout under load passing alone, and the nested process case passes.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- Not built: B5, a stop that ends the bot's turn and leaves its back session running.
- The wake holds no running turn of the back session to stop.
- Open, left as it is: E32, X5 and Q15, `session/ready` said before the backend is live.
- The reference host says it once its agent's session is live, and these backends start theirs at the first turn.
- Left as they are: Q18, Q19, CS5 and CS4; VS Code's host was not read for them in this plan.

---
title: A turn ends as VS Code ends it - implemented
date: 2026-11-02
refs:
  - git://020669b1 - the last change
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
---

A turn the nested proxy fails says how long it ran.
A bot's turn whose back session failed ends with `chat/error`, in that turn's words.
A stop of a bot's turn stops the back session's running turn, which answers it no more.

## What was built

- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - a failed or halted turn's duration.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `TurnHandle.fail`, said as `chat/error`.
- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) and [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - a back session's failure fails the main turn.
- The same two, with `TurnHandle.onStop` in [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - a stop cancels the back session's running turn.

## Verified

- Each new or changed case fails on `89ebe4d5`'s sources and passes with the change, as each task's *Resume* names.
- Task 03's two cases fail on `98c13ce0`'s sources and pass with the change; the bot's 199 cases pass.
- The bot test files pass, each timeout under load passing alone, and the nested process case passes.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- Open, left as it is: E32, X5 and Q15, `session/ready` said before the backend is live.
- The reference host says it once its agent's session is live, and these backends start theirs at the first turn.
- Left as they are: Q18, Q19, CS5 and CS4; VS Code's host was not read for them in this plan.

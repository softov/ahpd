---
title: A bot answers on a host with no users - implemented
date: 2026-11-13
refs:
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts) - the wake falls back to the bot's owner"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - the seam's `hasUsers`"
  - "[code://packages/bot/test/bot-wake.test.ts](../../../../packages/bot/test/bot-wake.test.ts) - the cases"
---

A message to a bot on a host with no users directory starts a Back, as on a host with users. The talk is the host's own: the Back is titled `@main/<bot>/root`, and the context names the host.

## What was built

- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) - `BotSessions` has `hasUsers`. The wake uses `bot.owner` for a session with no owner on a host with no users.
- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - the seam reads `host.hasUsers`.
- [`code://packages/bot/test/bot-wake.test.ts`](../../../../packages/bot/test/bot-wake.test.ts) - two cases, one for each kind of host.
- The problem file `a-bot-never-answers-on-a-host-with-no-users.md` is deleted.

## Verified

- `pnpm typecheck` is clean.
- `TMPDIR=/tmp npx vitest run packages/bot/test`: 14 files, 264 tests passed.
- A test daemon on port 39200 ran this branch with no `users` key. A message to a new bot started one Back chat on `claude`, and the Front turn completed. The bot's owner was `root:<hostName>`. On `045197d4f` the same message failed with the refusal.

## Departures from the plan

- None.

## Left for later

- None.

---
title: The Front runs in the bot's folder
status: implemented
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/chat.ts#L1286-L1302](../../../../packages/bot/src/chat.ts#L1286-L1302) - the `bot-chat` agent, which gets `placeSession`"
  - "[code://packages/bot/src/wake.ts#L299-L335](../../../../packages/bot/src/wake.ts#L299-L335) - `sessionFor`, whose folder, trust, user settings and computer move here"
---

## Objective

A `bot-chat` session runs in the bot's folder, trusted, with no user settings, on the bot's computer, whatever folder the client sent.

## Files

- `UPDATE: packages/bot/src/chat.ts:1286-1302` - add `placeSession` to the `bot-chat` agent.
- `UPDATE: packages/bot/src/plugin.ts` - keep `session:trust` on the plugin's entry, which the host checks.
- `UPDATE: packages/bot/test` - the cases in *Validation*.

## Steps

1. In `placeSession`, read the bot from the `bot` setting, as `create` does.
2. Answer the bot's `workspace`, `trusted: true` and `userSettings: false`.
3. Answer the bot's `computer` where it has one.
4. Answer nothing for a slug no bot has, so `create` gives its own refusal.

## Validation

- A test creates a session with Ello and a client folder, and the session runs in Ello's folder, trusted.
- A test creates a session with a bot on a computer, and the session's config has that computer.
- `pnpm typecheck` passes, and `pnpm vitest run packages/bot` passes.

## Resume

- Built on 2026-11-13 as `placeSession` on the `bot-chat` agent. `bot-provider.test.ts` checks that a talk runs in the bot's folder.
- The bot's plugin entry needs `session:trust` for every talk, so the test fixtures give it the grants BOTS.md prints.


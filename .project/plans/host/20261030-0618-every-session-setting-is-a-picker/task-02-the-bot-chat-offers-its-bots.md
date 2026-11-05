---
title: The bot chat offers its bots
status: done
depends: [task-01-a-harness-answers-its-own-setting.md]
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L1136-L1145](../../../../packages/bot/src/chat.ts#L1136-L1145) - the `bot` key, a plain string today"
  - "[code://packages/computer/src/plugin.ts#L1958-L1990](../../../../packages/computer/src/plugin.ts#L1958-L1990) - how `computer` turns records into items, the pattern to copy"
---

## Objective

The Bot chat harness answers `bot` with the bot records, so a person picks a bot by its name.

## Files

- `UPDATE: packages/bot/src/chat.ts:1136-1145` - the harness gets `completions.bot`, and the key's description stops asking for a slug.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the answerer's cases.
- `UPDATE: docs/plugins/bot.md` - the new chat form shows a picker of bots.
- `UPDATE: docs/updates/v0_14.md` - a line for the picker.

## Steps

1. Build plan `plugin/56` first, because it edits the same file.
2. Add `completions: { bot: ... }` to the harness that `chat.ts` returns.
3. Wait for `store.ready()`, then answer one item per bot record.
4. Give each item the bot's slug as its value and the bot's name as its label.
5. Keep the items whose name or slug contains `query`, without regard to case.
6. Change the key's description to "The bot this chat is with."
7. Document the picker in `docs/plugins/bot.md`, and add a line under 0.14 in `docs/updates/v0_14.md`.

## Validation

- `bot-chat.test.ts`: two bot records give two items, with slug and name.
- `bot-chat.test.ts`: a `query` keeps only the matching bot.
- `bot-chat.test.ts`: `resolveSessionConfig` for the Bot chat gives `bot` with `enumDynamic: true`.
- `pnpm -s typecheck` passes, and the bot tests pass.

## Resume

Implemented 2026-10-30.
`botChatAgent` returns `completions.bot`, which waits for `store.ready()` and answers one item per bot.
The slug is the value and the name is the label, and the filter matches either without regard to case.
The key's description is "The bot this chat is with."
`packages/bot/test/bot-chat.test.ts` covers the seed, the `enumDynamic` mark and a query.
Plan `plugin/56` was merged into this branch after the build.
Its change is at `steer` and this task's is at the schema, so the two do not overlap.

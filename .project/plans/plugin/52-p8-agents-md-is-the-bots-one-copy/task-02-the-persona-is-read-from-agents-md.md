---
title: A bot's persona is read from and written to its AGENTS.md
status: done
depends: [task-01-agents-md-has-parts-the-ui-owns.md, task-06-agents-md-uses-the-hosts-yaml.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - the read, write and delete roads of a bot"
  - "[code://packages/bot/src/record.ts#L147](../../../../packages/bot/src/record.ts#L147) - the fields a record keeps"
  - "[code://packages/bot/src/folder.ts](../../../../packages/bot/src/folder.ts) - `prepareFolder`"
---

## Objective

The record keeps `labels`, `color`, `session`, `workspace`, `owner`, `template` and `computer`.
`name`, `description` and `instructions` are in the bot's `AGENTS.md`.
A read of a bot answers the same shape as now, with the parts from the file.
A make writes `AGENTS.md` at once from the template, and an edit writes the parts into the file.
The bot's own edit to the file shows on the next read.

## Files

- `UPDATE: packages/bot/src/record.ts` - remove `name`, `description` and `instructions` from what the record keeps.
- `UPDATE: packages/bot/src/provider.ts` - read the parts from the file, and write them to it.
- `UPDATE: packages/bot/src/folder.ts` - write `AGENTS.md` when the bot is made.
- `UPDATE: packages/bot/src/plugin.ts` - move the parts of each bot at load.
- `UPDATE: packages/bot/src/wake.ts` - keep `prepareFolder` for a folder that has no `AGENTS.md`.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the tests of the read, the make and the edit.

## Steps

1. On a make, fill the template and write `AGENTS.md` in the bot's folder.
2. On a read, read the parts from `AGENTS.md` and put them on the bot.
3. Use the slug as the name when the file has no name.
4. On an edit, write the parts with `writeAgents`, and write the other fields to the record.
5. At load, move each bot's parts from its record into its `AGENTS.md`.
6. Put the frontmatter on top of an `AGENTS.md` that has none, and keep its old text.
7. Remove the parts from the record after the move.
8. Leave the catalogue and the client shape as they are.

## Validation

- `bot-provider.test.ts`: test that an edit in the UI changes the file, and the record has no persona.
- `bot-provider.test.ts`: test that an edit to the file shows on the next read.
- `bot-provider.test.ts`: test the move of a record with an old `AGENTS.md`, and of one with no file.
- The gates pass: build, typecheck, boundary, schema and vitest.

---
title: The AGENTS.md template makes the bot
status: done
depends: [task-10-a-bots-folder-has-its-agents-file.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/template.ts](../../../../packages/bot/src/template.ts) - `DEFAULT_TEMPLATE` and `fillWords`, the words a template fills"
  - "[code://packages/bot/src/folder.ts](../../../../packages/bot/src/folder.ts) - `prepareFolder`, which writes `AGENTS.md` when it is absent"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - the `templates` collection, and the plugin's `configDir`"
---

## Objective

ahpd ships a default `AGENTS.md` template at `<configDir>/templates/bots/AGENTS.md`.
The plugin writes that file when it is absent, and never writes over it, so a person can edit it by hand.
When a bot's folder has no `AGENTS.md`, the plugin fills the bot's template and writes the result as `AGENTS.md`.
A bot that names no template gets the default file.
The default template is the bot maker: its text tells the bot to ask what it is for, and then to rewrite its own `AGENTS.md`.

## Files

- `UPDATE: packages/bot/src/template.ts` - the default `AGENTS.md` text, and how to read the template of a bot.
- `UPDATE: packages/bot/src/folder.ts` - write `AGENTS.md` from the filled template, in place of the raw `instructions`.
- `UPDATE: packages/bot/src/plugin.ts` - write the default template file at load when it is absent.
- `UPDATE: packages/bot/src/wake.ts` - give `prepareFolder` the filled template.
- `UPDATE: packages/bot/test/bot-folder.test.ts` - the tests of the template and the folder.

## Steps

1. Put the default text below in `template.ts` as the text that ships.
2. At plugin load, write the text to `<configDir>/templates/bots/AGENTS.md` when that file is absent.
3. Never write over that file.
4. Make sure the `templates` record collection does not read the `bots/` folder as a record.
5. Read the `templates` record that the bot names, or the default file when it names none.
6. Use the shipped text when the plugin cannot read the default file.
7. Fill the words `name`, `description` and `instructions` from the record.
8. Write the result as the bot's `AGENTS.md` when the folder has no `AGENTS.md`.
9. Remove the old rule that leaves `AGENTS.md` absent when the record has no `instructions`.
10. Keep `CLAUDE.md` as it is: one line, `@AGENTS.md`.

## The default text

```
# {{name}}

{{description}}

{{instructions}}

## How you work

This file is your rules. You are a bot on ahpd, and this folder is yours.

If the text above does not say what you are for, ask the person who talks to you. Ask what work you do, for whom, and what you must never do. Then rewrite this file with their answers, in place of this section.

When your owner asks you to change how you work, rewrite this file again.
```

## Validation

- `bot-folder.test.ts`: test that a bot with no template gets `AGENTS.md` from the default file, with its words filled.
- `bot-folder.test.ts`: test that a bot that names a template gets that template's text.
- `bot-folder.test.ts`: test that load writes the default file when it is absent, and keeps a file that a person edited.
- `bot-folder.test.ts`: test that an `AGENTS.md` in the folder stays as it is.
- The gates pass: build, typecheck, boundary, schema and vitest.

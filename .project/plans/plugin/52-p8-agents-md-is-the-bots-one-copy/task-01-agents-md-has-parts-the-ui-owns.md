---
title: AGENTS.md has parts the UI owns
status: done
depends: []
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/template.ts](../../../../packages/bot/src/template.ts) - `DEFAULT_AGENTS_TEMPLATE` and `agentsFilled`"
---

## Objective

`AGENTS.md` has a layout that a parser reads and a writer changes in part.
The frontmatter holds `version`, `name` and `description`.
The `## Instructions` section holds the instructions, up to the next `##` heading or the end of the file.
The writer changes these parts and keeps every other byte of the file.

## Files

- `CREATE: packages/bot/src/agents.ts` - `readAgents(text)` and `writeAgents(text, parts)`.
- `UPDATE: packages/bot/src/template.ts` - the default text in the new layout.
- `CREATE: packages/bot/test/bot-agents.test.ts` - the tests of the parser and the writer.

## Steps

1. Read the frontmatter with the YAML parser that the record collections use.
2. Read the text under `## Instructions` up to the next `##` heading, without the blank lines at each end.
3. Give an empty value for a part that the file does not have.
4. Write the frontmatter keys `version`, `name` and `description`, and keep every other key.
5. Write the `## Instructions` text in its section.
6. Add the section after the frontmatter when the file does not have it.
7. Keep the text outside these parts as it is.
8. Put the default text below in `template.ts`.

## The default text

```
---
version: 1
name: {{name}}
description: {{description}}
---

## Instructions

{{instructions}}

## How you work

This file is your rules. You are {{name}}, a persistent bot assistant on `ahpd`, and this folder is yours. Answer as {{name}}, not as the model or the program that runs you. The frontmatter and the Instructions section are your owner's. You may change them only when your owner asks.

If the Instructions section does not say what you are for, ask the person who talks to you. Ask what work you do, for whom, and what you must never do. Then write their answers in the Instructions section.
```

## Validation

- `bot-agents.test.ts`: test a read of a full file, of a file with no frontmatter, and with no section.
- `bot-agents.test.ts`: test that a write changes only the parts, and keeps an unknown frontmatter key.
- `bot-agents.test.ts`: test that a description with a colon or a quote reads back the same.
- The gates pass: build, typecheck, boundary, schema and vitest.

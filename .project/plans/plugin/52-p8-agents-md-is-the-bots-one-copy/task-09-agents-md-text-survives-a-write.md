---
title: AGENTS.md text survives a write
status: todo
depends: [task-01-agents-md-has-parts-the-ui-owns.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/agents.ts#L180-L195](../../../../packages/bot/src/agents.ts#L180-L195) - `setFields`, whose key span runs to the next column-0 key"
  - "[code://packages/bot/src/agents.ts#L129-L135](../../../../packages/bot/src/agents.ts#L129-L135) - the Instructions section ends at the next `##` line"
  - "[code://packages/bot/src/folder.ts#L150-L154](../../../../packages/bot/src/folder.ts#L150-L154) - `nonEmpty` trims the text"
  - "[code://packages/bot/src/folder.ts#L181-L188](../../../../packages/bot/src/folder.ts#L181-L188) - the persona move, where the record wins over the file"
  - "[code://packages/bot/src/provider.ts#L523-L534](../../../../packages/bot/src/provider.ts#L523-L534) - `workspaceFor` and the `root` option"
---

## Objective

A write changes only the parts the UI owns, and keeps every other byte of `AGENTS.md`.
Instructions from the UI read back as they were written.

## Files

- `UPDATE: packages/bot/src/agents.ts` - the key span, the `##` line in instructions, and a multi-line scalar.
- `UPDATE: packages/bot/src/folder.ts` - keep leading indentation, and let the file win in the move.
- `UPDATE: packages/bot/src/plugin.ts` - refuse a `root` under the config folder.
- `UPDATE: packages/bot/test/bot-agents.test.ts` - a case for each finding.
- `UPDATE: packages/bot/test/bot-store.test.ts` - the move with an existing Instructions section.

## Steps

1. End an owned key's span at its last value line, so comment and blank lines after it stay.
2. Read an indented or quoted continuation line as part of the scalar.
3. Check that a column-0 `x:` inside a quoted scalar does not end it.
4. Refuse an edit whose instructions hold a line that starts with `## `, and name the line in the error.
5. Trim only trailing blank lines in `nonEmpty`, and keep leading indentation.
6. In the persona move, keep the file's Instructions section when it has one, and drop the record's copy.
7. At load, refuse a `root` option inside the config folder, with a problem line, and use the default root.
8. Add a test for each step in `bot-agents.test.ts` or `bot-store.test.ts`.

## Validation

- `packages/bot/test/bot-agents.test.ts`: `name: Old\n# kept\n\nmood: calm` becomes `name: New\n# kept\n\nmood: calm`.
- `packages/bot/test/bot-agents.test.ts`: a quoted multi-line `description` with an `x:` line reads back whole.
- `packages/bot/test/bot-agents.test.ts`: the host refuses instructions with a `## ` line.
- `packages/bot/test/bot-agents.test.ts`: instructions that start with four spaces read back the same.
- `packages/bot/test/bot-store.test.ts`: a move keeps a file's own Instructions section.
- Run `pnpm --filter @ahpd/bot test` alone. Expect a pass.

## Resume


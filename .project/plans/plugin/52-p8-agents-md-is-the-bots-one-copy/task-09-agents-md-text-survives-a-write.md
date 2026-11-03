---
title: AGENTS.md text survives a write
status: implemented
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

- **Done so far:** all steps, with two test files beyond the ones the task names.
- **Built as:** `setFields` reads the frontmatter through `spansIn`. A key's span ends at the last line of its value. A quoted value may span lines, and a column-0 `x:` inside it is not a key. A block scalar's indented lines belong to it too. A comment or a blank line after the value stays.
- **Built as:** `instructionsProblem` names the first line of the instructions that starts with a `##` heading. `provider.write` refuses that write with `-32602` before anything is written.
- **Built as:** `nonEmpty` removes only trailing blank lines, so the first line's indentation survives a read.
- **Built as:** `withAgents` lets a file's Instructions section win over the older record's copy. The record's copy is dropped rather than written over it.
- **Built as:** `apply` refuses a `root` that is the configuration folder or under it. It reports both paths and the default root, and uses `~/.bots`.
- **Departure:** the host's `@cofold/yaml` cannot read a quoted scalar across lines. A quoted multi-line description therefore cannot be read as written. The test writes that shape and checks what the value now holds. The writer replaces the quoted entry with a block scalar, and `readAgents` gives back the same two lines. Nothing of the value is lost, and the file's other lines stay. This is what the host's subset allows.
- **Departure:** the host-refusal test is in `bot-provider.test.ts`, and the `root` test is in `bot-folder.test.ts`. Both need a host, and those are the two files that build one. The step-5 and step-6 cases are in `bot-store.test.ts`, as the step allows.
- **Tests:** `bot-agents.test.ts` has a case for the key span, the block scalar, the quoted `x:` line, the refusal text and the four-space line. `bot-store.test.ts` has the four-space move and the file's section winning. `bot-provider.test.ts` has the `-32602` refusal. `bot-folder.test.ts` has the refused `root`.
- **Changed files:** `packages/bot/src/agents.ts`, `packages/bot/src/folder.ts`, `packages/bot/src/provider.ts`, `packages/bot/src/plugin.ts`, `packages/bot/test/bot-agents.test.ts`, `packages/bot/test/bot-store.test.ts`, `packages/bot/test/bot-provider.test.ts`, `packages/bot/test/bot-folder.test.ts`.
- **Gates:** `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm -s boundary` pass; `pnpm --filter @ahpd/bot test` ran 15 files and 218 tests, all passed.
- **Left dirty by the suite:** `packages/sdk/test/fixtures/wire.jsonl`. It is not part of the commit.


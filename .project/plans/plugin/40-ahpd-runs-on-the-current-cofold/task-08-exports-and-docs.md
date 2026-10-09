---
title: The package exports and documents what it now takes from cofold
status: todo
depends: [task-03-modes-and-effort-are-cofolds-lists.md, task-04-a-tool-row-is-titled-by-its-subject.md, task-05-an-edit-is-the-file-the-tool-writes.md, task-06-tools-and-providers-use-cofolds-config.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/index.ts#L14-L29](../../../../packages/agent-cofold/src/index.ts#L14-L29) - the exports"
  - "[code://packages/agent-cofold/README.md](../../../../packages/agent-cofold/README.md) - the tools table and the configuration section"
---

## Objective

`@ahpd/agent-cofold` exports the same names as today, now from cofold, except `capabilitiesOf`.
The README says which tools a session has, how each row is titled, and that a write needs a read first.

## Files

- `UPDATE: packages/agent-cofold/src/index.ts:14-29` - re-export `PERMISSION_MODES`, `EFFORT_LEVELS`, `effortOf`, `SearchConfig`, `ToolsConfig` and `splitModel` from cofold; `HarnessProvider` is the alias; `capabilitiesOf` goes.
- `UPDATE: packages/agent-cofold/README.md` - the tools table names each tool's title; one line says a write needs a read first, also after a restart; the options table lists `strictTools`.

## Steps

1. Change each export in `index.ts` to its cofold source.
2. Remove `capabilitiesOf`.
3. Run `rg` for each removed name outside `packages/agent-cofold`, and fix any import.
4. Update the README's tools table and configuration section.
5. Run `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs` on the README section.

## Validation

- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- The full gate in the plan's checklist passes.

## Resume

- No other ahpd package imports these names today.

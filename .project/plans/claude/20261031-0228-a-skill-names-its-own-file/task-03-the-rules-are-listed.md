---
title: The rules are listed
status: done
depends:
  - task-02-each-entry-names-its-file.md
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/customizations.ts#L72-L86](../../../../packages/agent-claude/src/session/customizations.ts#L72-L86) - the directories, which task 02 lays out per scope"
  - "[code://packages/agent-claude/README.md#L165-L194](../../../../packages/agent-claude/README.md#L165-L194) - *What it does* and *Supported*"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/scan/claudeRuleScan.ts - `globs` from `paths`, and `alwaysApply` otherwise
---

## Objective

The `CLAUDE.md` files and the files in `.claude/rules` show as `rule` children of the `rules` directory of their scope.
The README says where each kind of entry comes from.

## Files

- `UPDATE: packages/agent-claude/src/session/customizations.ts` - put each rule entry from `filesOf` in the `rules` directory of its scope.
- `UPDATE: packages/agent-claude/test/customizations.test.ts` - add the cases of this task.
- `UPDATE: packages/agent-claude/README.md:179-194` - add a section on where the skills, commands, agents and rules come from.

## Steps

1. Make each rule entry a `rule` child with `id: rule:<scope>:<path>`, its file as `uri`, and its file name as `name`.
2. Set `globs` on a rule that has them, and `alwaysApply: true` on any other rule.
3. Put each rule in the `rules` directory of its scope, also a rule file outside that folder, such as `CLAUDE.md`.
4. Add a test with a personal `CLAUDE.md`, a project `CLAUDE.md` and a project rule with `paths`.
5. Add a README section after *Supported* that names each scope, its folder, and the read-only directories.
6. In that section, say that a session in a machine lists its entries with no file.

## Validation

- `packages/agent-claude/test/customizations.test.ts` passes, with the new cases.
- `pnpm typecheck` is clean, and `pnpm vitest run packages/agent-claude/test` passes.
- By hand, with a test ahpd under XDG directories: VS Code's Instructions group shows `CLAUDE.md`, and opens it.

## Resume


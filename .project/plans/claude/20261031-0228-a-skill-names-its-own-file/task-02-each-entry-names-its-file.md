---
title: Each entry names its file
status: done
depends:
  - task-01-the-disk-read-finds-each-file.md
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/customizations.ts#L72-L86](../../../../packages/agent-claude/src/session/customizations.ts#L72-L86) - the directories this task replaces"
  - "[code://packages/agent-claude/src/session/customizations.ts#L188-L276](../../../../packages/agent-claude/src/session/customizations.ts#L188-L276) - the skill, command and agent loops"
  - "[code://packages/agent-claude/src/session/servers.ts#L86-L95](../../../../packages/agent-claude/src/session/servers.ts#L86-L95) - `laid`, which passes the disk read"
  - "[code://packages/agent-claude/src/probe.ts#L105-L108](../../../../packages/agent-claude/src/probe.ts#L105-L108) - the probe, which passes the personal scope only"
  - "[code://packages/agent-claude/test/customizations.test.ts](../../../../packages/agent-claude/test/customizations.test.ts) - the tests this task changes and adds to"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L273-L438 - the match of disk files with what the SDK reports
---

## Objective

Each skill, command and agent the SDK reports names the file the CLI read it from, or an internal URI when there is no file.
Each scope sends its own writable directories, with no children too, and the read-only directories hold the managed, synced and built-in skills.

## Files

- `UPDATE: packages/agent-claude/src/session/customizations.ts:72-276` - `customizationsOf` takes the disk entries, matches them by name, and lays out the directories per scope.
- `UPDATE: packages/agent-claude/src/session/servers.ts:86-95` - `laid` passes `filesOf` for the session's config directory and working directory, and passes nothing for a session in a machine.
- `UPDATE: packages/agent-claude/src/probe.ts:105-108` - the probe passes `filesOf` for the personal scope only.
- `UPDATE: packages/agent-claude/test/customizations.test.ts` - correct the URIs and ids the tests expect, and add the cases of this task.

## Steps

1. Add a `files` argument to `customizationsOf`, the entries that `filesOf` returns.
2. For each skill the SDK reports, find the disk skill with its name, in the order managed, user, project.
3. Match a synced skill by `anthropic-skills:<name>` and by its bare `<name>`.
4. Give a matched skill its `SKILL.md` path as a `file:` URI, and put it in the directory of its scope.
5. Give a skill with no match `claude-internal:/skill/<name>`, and put it in a `builtin` directory with `writable: false`.
6. Give a plugin skill `<plugin>/skills/<name>/SKILL.md` when that file is there, and the internal URI when it is not.
7. Match each command with a disk command by name, and give it the `.md` path or `claude-internal:/command/<name>`.
8. Leave out a command when a reported skill has its name, because the CLI runs the skill.
9. Match each agent with a disk agent by name, and keep `INTERNAL_AGENT` for an agent with no file.
10. Leave out a disk entry that the SDK does not report.
11. Send `agents`, `skills`, `commands` and `rules` directories for the user scope, with `writable: true`, also with no children.
12. Send the same four for the project scope when the session has a working directory.
13. Give each directory the id `directory:<scope>:<kind>`, and the real path of `<scope root>/<kind>` as its `uri`.
14. Send the `managed` and `synced` skill directories with `writable: false`, and only with children.
15. In `laid`, call `filesOf` with the session's `CLAUDE_CONFIG_DIR`, or `~/.claude`, and with `ctx.options.cwd`.
16. In `laid`, pass no files when `ctx.options.spawn` has a value, so a session in a machine gets internal URIs only.
17. In `probe.ts`, call `filesOf` with the personal scope and no working directory.
18. Correct the tests that expect `directory:skills` or a folder URI, and add one case for steps 2 to 16.

## Validation

- `packages/agent-claude/test/customizations.test.ts` passes, with the new cases.
- `pnpm typecheck` is clean, and `pnpm vitest run packages/agent-claude/test` passes.
- By hand, with a test ahpd under XDG directories: VS Code's Agent Customizations opens `advisor` in its `SKILL.md`.
- By hand: a synced skill opens its `SKILL.md`, and `code-review` shows in Built-in with no file.

## Resume


---
title: The disk read finds each file
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/customizations.ts#L370-L417](../../../../packages/agent-claude/src/session/customizations.ts#L370-L417) - the frontmatter read under a size limit, to copy"
  - "[code://packages/agent-claude/src/catalog.ts#L81-L82](../../../../packages/agent-claude/src/catalog.ts#L81-L82) - the personal scope under `CLAUDE_CONFIG_DIR`"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentPlugins/common/pluginParsers.ts#L1026-L1092 - `readSkills`, one level down to `<child>/SKILL.md`
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/scan/claudeRuleScan.ts - the rule files and their `paths` frontmatter
---

## Objective

A function reads the skill, command, agent and rule files of each scope, and returns what it found.
Each entry has its kind, its name, its scope, its absolute path, and the frontmatter fields the listing needs.

## Files

- `CREATE: packages/agent-claude/src/session/disk.ts` - `filesOf`, the disk read of the managed, personal, synced and project scopes.
- `UPDATE: packages/agent-claude/src/session/customizations.ts:370-417` - move the frontmatter read out of `agentNameOf` into a function that `disk.ts` uses too.
- `CREATE: packages/agent-claude/test/disk.test.ts` - the tests of the disk read, on a temporary folder.

## Steps

1. Add `filesOf({ configDir, cwd, managedDir })` to `disk.ts`, and make `cwd` and `managedDir` optional.
2. Return entries of the form `{ kind, name, scope, path, description?, globs? }`.
3. Make `kind` one of `skill`, `prompt`, `agent` and `rule`.
4. Make `scope` one of `managed`, `user`, `synced` and `project`.
5. Read a skill from `<root>/skills/<folder>/SKILL.md`, one level down, with the roots `<managedDir>/.claude`, `configDir` and `<cwd>/.claude`.
6. Take a skill's name from its frontmatter `name`, and from the folder name when there is none.
7. Read the synced skills from each `manifest.json` under `<configDir>/skills/synced/<id>/`.
8. Take each synced skill's path as `<configDir>/skills/synced/<id>/<name>/SKILL.md`, and leave out a skill whose file is not there.
9. Read a command from `<root>/commands/*.md`, and an agent from `<root>/agents/*.md`, for the personal and project roots.
10. Take an agent's name from its frontmatter `name`, and from the file name when there is none.
11. Read the personal rules from `<configDir>/CLAUDE.md` and `<configDir>/rules/**/*.md`.
12. Read the project rules from `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` and `.claude/rules/**/*.md` under `cwd`.
13. Set `globs` from a rule's `paths` frontmatter.
14. Read only a regular file, and only the first 64 KB of it.
15. Return no entry, and throw nothing, for a missing folder or a folder the read fails on.
16. Add `managedDirOf(platform)`, which answers `/etc/claude-code`, `/Library/Application Support/ClaudeCode` or `C:\Program Files\ClaudeCode`.
17. Write `disk.test.ts` with one case per scope, and one case for steps 6, 8, 13, 14 and 15.

## Validation

- `packages/agent-claude/test/disk.test.ts` passes.
- `packages/agent-claude/test/customizations.test.ts` still passes after the frontmatter read moves.
- `pnpm typecheck` is clean.

## Resume


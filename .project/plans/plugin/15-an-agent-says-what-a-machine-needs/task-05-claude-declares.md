---
title: Claude declares its needs
status: todo
depends: [task-01-the-need-type.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L372-L395](../../../../packages/agent-claude/src/claude.ts#L372-L395) - the config dir and binary the CLI uses"
---

## Objective

agent-claude's `machine()` answers `claudeConfigDirectory` (directory, `~/.claude`, required), `claudeConfigJson` (file, `~/.claude.json`, required) and `claudeExecutable` (file, read-only, what `~/.local/bin/claude` resolves to), at the mount points the computer docs use today.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts` or `claude.ts` - `machine()`.

## Steps

1. Resolve the executable's symlink when asked, so a version change on the host is followed.

## Validation

- A unit test: the three needs, and the executable default following a symlink in a temp dir.

## Resume

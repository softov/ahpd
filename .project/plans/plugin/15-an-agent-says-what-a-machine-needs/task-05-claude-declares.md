---
title: Claude declares its needs
status: done
depends: [task-01-the-need-type.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L373-L398](../../../../packages/agent-claude/src/claude.ts#L373-L398) - `machine()`"
  - "[code://packages/agent-claude/src/claude.ts#L25-L29](../../../../packages/agent-claude/src/claude.ts#L25-L29) - `claudeExecutablePath`, which follows the symlink"
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

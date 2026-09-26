---
title: Claude declares its needs
status: implemented
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

Done 2026-09-26. `claude()` in `packages/agent-claude/src/claude.ts` answers `machine()` with `claudeConfigDirectory` (`~/.claude` to `/ahpd/claude`), `claudeConfigJson` (`~/.claude.json` to `/ahpd/claude/.claude.json`) and `claudeExecutable` (read-only to `/usr/local/bin/claude`). `claudeExecutablePath` resolves `~/.local/bin/claude` with `realpathSync` every time it is asked, so a host update is followed; `test/agent-machine-needs.test.ts` proves the three needs and the symlink.

Found: `computerConfigDir: false` still says the image carries its own configuration, so the two config needs are left out and only the executable is declared. The executable is `required`, so a host without the CLI is refused by name rather than making a machine whose session exits 127.

---
title: Claude runs from its part
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L382-L406](../../../../packages/agent-claude/src/claude.ts#L382-L406) - the needs"
---

## Objective

Claude's `machine()` answers `claudePart: { part: 'claude' }` and the CLI inside a machine is `claude` on the machine's `PATH`; with `computerExecutable: "host"` it answers today's `claudeExecutable` mount instead.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts:382-406` - the need, the option, the command inside a machine.
- `UPDATE: packages/agent-claude/src/plugin.ts` - read `computerExecutable`, `"part"` by default.
- `UPDATE: packages/agent-claude/test/` the machine test - both routes.

## Steps

1. Replace the executable need with the part need unless the option says `host`.
2. Keep `claudeExecutablePath` for the host route.

## Validation

- Default: needs have `claudePart` and no `claudeExecutable`.
- `computerExecutable: "host"`: today's needs exactly.

## Resume

---
title: Claude runs from its part
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L373-L398](../../../../packages/agent-claude/src/claude.ts#L373-L398) - the needs"
  - "[code://packages/agent-claude/src/claude.ts#L390-L396](../../../../packages/agent-claude/src/claude.ts#L390-L396) - the host binary mount, unconditional today"
  - "[code://packages/agent-claude/src/claude.ts#L78-L96](../../../../packages/agent-claude/src/claude.ts#L78-L96) - `computerExecutable` and `computerConfigDir`"
  - "[code://packages/agent-claude/src/plugin.ts#L36-L45](../../../../packages/agent-claude/src/plugin.ts#L36-L45) - the plugin-wide options"
  - "[code://packages/agent-claude/src/plugin.ts#L136-L143](../../../../packages/agent-claude/src/plugin.ts#L136-L143) - what every variant shares"
---

## Objective

Claude's `machine()` answers `claudePart: { part: 'claude' }` and the CLI inside a machine is `claude` on the machine's `PATH`; with `computerCli: "host"`, it answers today's `claudeExecutable` mount instead.
For now `computerCli: "part" | "host"` is a new plugin-wide option, `"part"` by default, shared by every variant like `computerExecutable`.
`computerExecutable` keeps its meaning, the CLI's path inside a machine.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts:373-398` - the part need, or the host mount when asked for.
- `UPDATE: packages/agent-claude/src/claude.ts:78-96` - `computerCli?: 'part' | 'host'` on `ClaudeOptions`, with a comment saying what it is.
- `UPDATE: packages/agent-claude/src/plugin.ts:36-45,136-143` - `computerCli` in the schema as an enum of `part` and `host`, default `part`, shared by every variant.
- `UPDATE: packages/agent-claude/test/agent-claude-options.test.ts` - both routes.

## Steps

1. Add `computerCli`; a value other than `part` or `host` fails the load, naming the option.
2. Replace the executable need with the part need unless `computerCli` is `host`; the choice is one branch in `machine()`.
3. Keep `claudeExecutablePath` for the host route.

## Validation

- Default: needs have `claudePart` and no `claudeExecutable`.
- `computerCli: "host"`: today's needs exactly.
- Two variants of one load answer the same part need.

## Resume

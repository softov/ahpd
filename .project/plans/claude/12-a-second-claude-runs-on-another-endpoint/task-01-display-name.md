---
title: agent-claude takes a displayName
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-acp/src/plugin.ts](../../../../packages/agent-acp/src/plugin.ts) - the option to mirror"
---

## Objective

`displayName` is an agent-claude option, `Claude Code` by default, and two loads with two providers and two names register two agents.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts` - `ClaudeOptions.displayName`, used for the agent's `displayName`.
- `UPDATE: packages/agent-claude/src/plugin.ts` and `package.json` - the option in the schema and the manifest.
- `UPDATE: packages/agent-claude/README.md` - the option, and the second-harness example.

## Validation

- `packages/agent-claude/test/agent-claude-presets.test.ts`: two loads, two providers, two names.

## Resume

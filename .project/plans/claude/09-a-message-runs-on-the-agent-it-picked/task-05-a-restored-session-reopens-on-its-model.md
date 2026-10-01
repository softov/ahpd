---
title: A restored session reopens on its model
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L693](../../../../packages/agent-claude/src/session.ts#L693) - `chosen`, empty when a session opens"
  - "[code://packages/agent-claude/src/session.ts#L2983-L2991](../../../../packages/agent-claude/src/session.ts#L2983-L2991) - the `model` key, stored as `settings.model`"
  - "[code://packages/agent-claude/src/session.ts#L2894](../../../../packages/agent-claude/src/session.ts#L2894) - the config values, which name `chosen`"
  - "[code://packages/agent-claude/src/session.ts#L2908](../../../../packages/agent-claude/src/session.ts#L2908) - `_meta.model`"
  - "https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeSessionMetadataStore.ts#L75 - VS Code's `claude.model`, restored per session"
---

## Objective

A Claude session opened with a stored `model` setting starts with that model chosen: its config values and `_meta.model` name it, and the first query runs on it, until a message picks another.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - seed `chosen` from `options.settings.model` when it is a string other than `default`, and pass it to the first query.
- `UPDATE:` the agent-claude session tests.

## Steps

1. Tests first: a session opened with `settings.model` reports it in its config values and `_meta.model`, and its first query is started with it; a message with another model replaces it; `default` or no stored model leaves it empty as today.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

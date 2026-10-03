---
title: A restored session reopens on its model
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L732](../../../../packages/agent-claude/src/session.ts#L732) - `chosen`, empty when a session opens"
  - "[code://packages/sdk/src/host.ts#L1240-L1246](../../../../packages/sdk/src/host.ts#L1240-L1246) - `about(provider)`, whose `models` are the variant's offered models"
  - "[code://packages/sdk/src/host.ts#L3715](../../../../packages/sdk/src/host.ts#L3715) - `seedCustomizations`, the pattern for handing the session what the probe learned"
  - "[code://packages/agent-claude/src/session.ts#L2983-L2991](../../../../packages/agent-claude/src/session.ts#L2983-L2991) - the `model` key, stored as `settings.model`"
  - "[code://packages/agent-claude/src/session.ts#L2894](../../../../packages/agent-claude/src/session.ts#L2894) - the config values, which name `chosen`"
  - "[code://packages/agent-claude/src/session.ts#L2908](../../../../packages/agent-claude/src/session.ts#L2908) - `_meta.model`"
  - "https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeSessionMetadataStore.ts#L75 - VS Code's `claude.model`, restored per session"
---

## Objective

A Claude session opened with a stored `model` setting that its variant offers starts with that model chosen: its config values and `_meta.model` name it, and the first query runs on it, until a message picks another.
A stored model the variant does not offer (`about(provider).models`) leaves `chosen` empty, as today.

## Files

- `UPDATE: packages/sdk/src/host.ts:3715` and the `Start` and session option types beside `seedCustomizations` - hand the session `about(agent.provider).models`, as `seedCustomizations` hands the probe's seeds.
- `UPDATE: packages/agent-claude/src/claude.ts:533` - pass it through, as `seedCustomizations` is.
- `UPDATE: packages/agent-claude/src/session.ts:732` - seed `chosen` from `options.settings.model` when it is a string other than `default` and an id in that list, and pass it to the first query.
- `UPDATE:` the agent-claude session tests.

## Steps

1. Tests first: a session opened with `settings.model` the variant offers reports it in its config values and `_meta.model`, and its first query is started with it; a message with another model replaces it; `default`, no stored model, or a stored model the variant does not offer leaves it empty as today.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

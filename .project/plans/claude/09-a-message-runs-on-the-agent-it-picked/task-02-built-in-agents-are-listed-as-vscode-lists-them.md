---
title: Built-in agents are listed as VS Code lists them
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L207-L345](../../../../packages/agent-claude/src/session.ts#L207-L345) - `folder()` and the agent entries"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L339-L393 - built-ins as `claude-internal:/agent/<name>`, `general-purpose` hidden
---

## Objective

An agent the CLI reports with no file under `~/.claude/agents` or a plugin's `agents` folder has the uri `claude-internal:/agent/<name>`, and `general-purpose` is not in the list.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:185-345` - `customizationsOf` checks the file and gives a built-in its `claude-internal:` uri.
- `UPDATE:` the customization tests and `packages/sdk/test/fixtures/wire.jsonl` if it lists agents.

## Steps

1. Tests first: `Explore` with no file gets `claude-internal:/agent/Explore`; `Plan` with a file keeps its `file:` uri; `general-purpose` is absent.
2. Implement; the uri is encoded the way VS Code's `nonEditableUri` encodes it.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

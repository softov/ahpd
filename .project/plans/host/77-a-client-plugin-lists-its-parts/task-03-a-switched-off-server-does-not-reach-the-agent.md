---
title: A switched-off server does not reach the agent
status: todo
depends: [task-02-a-client-plugin-lists-its-parts.md]
layer: sdk, agent-claude
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L870-L889](../../../../packages/sdk/src/host/chatactions.ts#L870-L889) - `session/customizationToggled`"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/shared/customizationEnablementGate.ts#L113-L165 - the server's own enablement, under its plugin's
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L918-L946 - Claude's `deniedServers`
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/state/protocol/channels-session/reducer.ts#L359-L384 - a toggle finds a part inside its container's `children`
---

## Objective

A client plugin's MCP server that `childEnablement` or a toggle switches off does not reach the agent.
A switched-off plugin takes all its servers with it.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:870-889` - a toggle on a part sets that part's `enablement`.
- `UPDATE: packages/sdk/src/host/tooling.ts` - `mcpFor` leaves out a switched-off server.
- `UPDATE: packages/agent-claude/src/session.ts:2175-2220` - a switched-off server goes in `deniedServers`.

## Steps

1. Find a toggled id among each client plugin's `children` when no entry has it.
2. Leave a switched-off server out of `mcpFor`.
3. Pass Claude a switched-off plugin server in `deniedServers`.
4. Apply a toggle on a live Claude session with `toggleMcpServer`.

## Validation

- A test toggles a server off and on, and reads the servers the agent gets each time.
- A test switches the plugin off and finds none of its servers.
- The gates pass.

## Resume

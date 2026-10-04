---
title: The agent runs with the session's client plugins
status: todo
depends: [task-02-a-session-reports-a-clients-plugins.md]
layer: "sdk, agent-claude"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L155-L170](../../../../packages/sdk/src/types/agent.ts#L155-L170) - `Start.mcpServers`, beside which `plugins` goes"
  - "[code://packages/sdk/src/host/tooling.ts#L337-L348](../../../../packages/sdk/src/host/tooling.ts#L337-L348) - `mcpFor`, which gains the client half"
  - "[code://packages/sdk/src/host/lifecycle.ts#L413-L443](../../../../packages/sdk/src/host/lifecycle.ts#L413-L443) - `restartChat`, the restart at the next send"
  - "[code://packages/agent-claude/src/session.ts#L2175-L2220](../../../../packages/agent-claude/src/session.ts#L2175-L2220) - the `query` options"
  - "[code://packages/agent-claude/src/session.ts#L2657-L2694](../../../../packages/agent-claude/src/session.ts#L2657-L2694) - the SDK's plugins reported as customizations"
  - "[code://packages/agent-claude/test/agent-claude-options.test.ts](../../../../packages/agent-claude/test/agent-claude-options.test.ts) - the options a fake SDK records"
  - "[code://.project/decisions/the-hosts-mcp-servers-are-root-config-as-in-vscode.md](../../../decisions/the-hosts-mcp-servers-are-root-config-as-in-vscode.md) - a client plugin's server wins a clash"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeSdkOptions.ts#L83-L88 - `plugins` as `{ type: 'local', path, skipMcpDiscovery }`"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L890-L950 - a plugin's MCP servers read by the host"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1037-L1072 - restart at the next send when the set differs"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2804-L2805 - the merge order"
---

## Objective

A chat is started with `Start.plugins`, the paths of the session's enabled client plugins, and `Start.mcpServers`, the host's servers with those plugins' `.mcp.json` servers over them; Claude hands the plugins to the SDK; a chat whose set changed is restarted at its next send.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - `Start.plugins?: { path: string }[]`, documented: a backend that cannot load plugins ignores it.
- `UPDATE: packages/sdk/src/host/tooling.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/src/host/lifecycle.ts` - `pluginsFor(session)` and `mcpFor(session)` reading the enabled copies and each copy's `.mcp.json`; both passed at every spawn; the set a chat started with is kept, and a send on a chat whose set differs restarts it first, as `restartChat` does.
- `UPDATE: packages/agent-claude/src/session.ts` - `plugins: start.plugins.map((one) => ({ type: 'local', path: one.path, skipMcpDiscovery: true }))` in the `query` options; a plugin the SDK reports whose path is one of `start.plugins` is left out of its customizations, as the host reports it.
- `UPDATE: packages/agent-claude/test/agent-claude-options.test.ts`, `packages/sdk/test/host.test.ts` - the cases below.
- `UPDATE: .project/plans/acp/11-the-agent-gets-mcp-servers/deferred.md` - line 7 points at this plan.

## Steps

1. Add `Start.plugins` and read each copy's `.mcp.json` (`mcpServers` key, relative commands resolved against the copy) into `mcpFor`.
2. Pass both at spawn, and restart at the next send on a difference; never during a turn.
3. Hand the plugins to the Claude SDK and drop its duplicate report.

## Validation

- `packages/sdk/test/host.test.ts`, with a fake agent recording `Start` and a client plugin copied in a temp directory with a `.mcp.json` naming server `a` that the host also names: the next spawn's `Start.plugins` names the copy and `Start.mcpServers.a` is the plugin's; toggling the plugin off and sending restarts the chat with neither; a send with an unchanged set does not restart; a change during a turn waits for the turn to end.
- `packages/agent-claude/test/agent-claude-options.test.ts`: `Start.plugins` reaches the SDK options with `skipMcpDiscovery: true`, and none are passed when it is absent.
- `pnpm test` passes.

## Resume

---
title: A client plugin lists its parts, and a part can be switched off
domain: host
status: built
priority: medium
created: 2026-10-09
revalidated: 2026-10-09
requires:
  - plans/host/49-a-session-loads-a-clients-plugins/plan.md
refs:
  - "[code://packages/agent-claude/src/session/customizations.ts#L57-L113](../../../../packages/agent-claude/src/session/customizations.ts#L57-L113) - `container` and `under`, the `children` shape Claude already publishes from the SDK's names"
  - "[code://packages/sdk/src/host/chatactions.ts#L1001-L1040](../../../../packages/sdk/src/host/chatactions.ts#L1001-L1040) - `session/customizationToggled`, where a part's toggle arrives"
  - "[code://packages/agent-claude/src/session/query.ts#L206-L224](../../../../packages/agent-claude/src/session/query.ts#L206-L224) - the Claude SDK `query` options, where a switched-off server is left out"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentPlugins/common/pluginParsers.ts#L1402-L1467 - `parsePlugin`: the manifest, then `.mcp.json`, `skills`, `agents`, `rules` and the hooks file by default, each overridable in the manifest
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexClientCustomizations.ts#L164-L187 - `parsedPluginChildren`: agents, skills, rules, hooks, then MCP servers, deduplicated by id; a switched-off server is skipped
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/shared/customizationEnablementGate.ts#L38-L185 - `childEnablement` is keyed by a part's name and read for MCP servers only; a plugin switched off switches off every part
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L918-L946 - Claude puts a switched-off server in `deniedServers`
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1581-L1598 - a live Claude session switches a server with `toggleMcpServer`
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ContainerCustomizationBase.children` (absent is not parsed yet, empty is nothing); `ChildCustomizationBase.enabled`; `McpServerCustomization.enablement`; `ClientPluginCustomization.childEnablement`
---

## Goal

A client plugin that host/49 copied shows its parts in the session's customizations: its agents, skills, rules, hooks and MCP servers.
A client or a person can switch off one of its MCP servers, and the agent does not get that server.
This is VS Code's agent host at `7516b04bc94`, with its names.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "children" packages/sdk/src/host` - the host publishes a client plugin with no `children`, and drops `childEnablement`.
- `rg -n "children" packages/agent-claude/src` - Claude builds `children` from the names the SDK reports, not from the plugin's files.

### Gaps

- ahpd does not read a copied plugin's files.
- `childEnablement` and a toggle on a part change nothing.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| ahpd reads a copied plugin's parts and lists them, then applies `childEnablement` | Softov, 2026-10-09, asked what to do with `childEnablement` once host/49 carries it: "Plan it, ahpd lists the parts" | 01-03 |
| Only an MCP server part can be switched off; skills, agents, rules and hooks load with the plugin | VS Code `customizationEnablementGate.ts#L113-L135` | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A copied plugin's parts are read](task-01-a-copied-plugins-parts-are-read.md) | done | - |
| [02 - A client plugin lists its parts](task-02-a-client-plugin-lists-its-parts.md) | done | 01 |
| [03 - A switched-off server does not reach the agent](task-03-a-switched-off-server-does-not-reach-the-agent.md) | done | 02 |

## Risks and tradeoffs

- VS Code reads three plugin formats; ahpd reads the Claude format and `.plugin/plugin.json`, and lists no parts for another.
- `commands/` is in VS Code's list of parts but `parsePlugin` never reads it, so ahpd does not read it.

## Resume state

- **Done so far:** tasks 01, 02 and 03, reviewed and gated on main.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a part's id is VS Code's: the file's URI in this host's copy of the plugin, and `<declaring file's id>#mcp=<encoded name>` for a server.

## Final verification checklist

- [x] A plugin with each kind of part lists them in VS Code's order.
- [x] A server switched off in `childEnablement` or by a toggle is absent from the agent's servers.
- [x] `pnpm test` passes.
- [x] `plans/index.md` updated.

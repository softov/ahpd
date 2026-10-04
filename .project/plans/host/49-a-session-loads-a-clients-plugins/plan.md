---
title: A session loads the plugins a client hands it
domain: host
status: planned
priority: medium
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/sdk/src/host/actions.ts#L454-L509](../../../../packages/sdk/src/host/actions.ts#L454-L509) - `session/activeClientSet`: kept whole in `presence`, but only `tools` is read"
  - "[code://packages/sdk/src/host.ts#L658-L679](../../../../packages/sdk/src/host.ts#L658-L679) - `leaves`: `session/activeClientRemoved` once a client watches the session no more"
  - "[code://packages/sdk/src/host/tooling.ts#L337-L348](../../../../packages/sdk/src/host/tooling.ts#L337-L348) - `mcpFor`: \"this host has no client plugin customizations to merge\""
  - "[code://packages/sdk/src/host/relay.ts#L65-L93](../../../../packages/sdk/src/host/relay.ts#L65-L93) - `clients`: `read` and `list` ask a connected client for its resources"
  - "[code://packages/sdk/src/host/chatactions.ts#L870-L889](../../../../packages/sdk/src/host/chatactions.ts#L870-L889) - `session/customizationToggled`, handed to the backend today"
  - "[code://packages/sdk/src/host/lifecycle.ts#L413-L443](../../../../packages/sdk/src/host/lifecycle.ts#L413-L443) - `restartChat`, the respawn a changed plugin set uses"
  - "[code://packages/sdk/src/types/agent.ts#L155-L170](../../../../packages/sdk/src/types/agent.ts#L155-L170) - `Start.mcpServers`, documented already as the host's servers under the client plugins'"
  - "[code://packages/agent-claude/src/session.ts#L2175-L2220](../../../../packages/agent-claude/src/session.ts#L2175-L2220) - the Claude SDK `query` options, where `plugins` goes"
  - "[code://packages/agent-claude/src/session.ts#L2657-L2694](../../../../packages/agent-claude/src/session.ts#L2657-L2694) - Claude reports the SDK's plugins as customizations"
  - "[code://packages/server/src/config.ts#L379](../../../../packages/server/src/config.ts#L379) - `sessionsDir`, the shape the plugin directory copies"
  - "[code://packages/server/src/commands/run.ts#L420](../../../../packages/server/src/commands/run.ts#L420) - where the server hands the host its ports"
  - "[code://.project/decisions/the-hosts-mcp-servers-are-root-config-as-in-vscode.md](../../../decisions/the-hosts-mcp-servers-are-root-config-as-in-vscode.md) - a session's servers are the host's with its client plugins' over them, a client plugin winning a clash"
  - "[code://.project/plans/acp/11-the-agent-gets-mcp-servers/deferred.md#L7](../../acp/11-the-agent-gets-mcp-servers/deferred.md) - client plugins' MCP servers, deferred until this host has client plugins"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentSideEffects.ts#L450-L510 - `_fanOutActiveClient`: an active client's `customizations` go to the agent, and a new chat is handed them again"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentPluginManager.ts#L22-L191 - `syncCustomizations`: each plugin copied to `{userData}/agentPlugins/{uri key}/{nonce key}/`, a nonce already there skipped, 64 revisions kept and 8 per plugin, `load` `loaded` or `error` with its message"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L970-L982 - the copy reads the client's files through `resourceRead` and `resourceList`"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeSdkOptions.ts#L83-L88 - `plugins` handed to the SDK as `{ type: 'local', path, skipMcpDiscovery }` (`:195-196`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1037-L1072 - a changed plugin set restarts the Claude query at the next send: \"`Query.reloadPlugins()` cannot help here\""
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L890-L950 - with `skipMcpDiscovery`, the plugin's MCP servers are read by the host and declared"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2804-L2805 - `{ ...root, ...enabledWorkspace, ...clientPlugins }`: a backend that does not load plugins still gets their MCP servers"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentSideEffects.ts#L370-L383 - a client plugin toggled off leaves the set handed to the agent"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `SessionActiveClient.customizations`; `ClientPluginCustomization` with `nonce` and `childEnablement`; `ContainerCustomizationBase.clientId`, `load` and `children`; `CustomizationLoadStatus` `loading`, `loaded`, `degraded`, `error`; `session/customizationUpdated` and `session/customizationsChanged`"
---

## Goal

A client that announces itself in a session with plugins of its own sees those plugins in the session's customizations, loading and then loaded or failed, and the session's agent uses them: Claude loads them as plugins, and every backend gets their MCP servers.
This is VS Code's agent host at `7516b04bc94`, with its names.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "customizations" packages/sdk/src/host` - the host forwards what a backend reports and seeds; nothing reads `activeClient.customizations`.
- `rg -n "plugins" packages/agent-claude/src/session.ts` - the SDK's plugins are reported, never passed in.
- `rg -n "clientPlugins|syncCustomizations|_fanOutActiveClient" src/vs/platform/agentHost/node` in the VS Code clone - the flow in the refs.

### Runtime path

```
session/activeClientSet { customizations } -> copy each plugin from the client (resourceList/resourceRead) into <configDir>/agentPlugins/<uri key>/<nonce key>/
  -> session/customizationUpdated (loading -> loaded | error) -> session/customizationsChanged
  -> next send: plugin set changed -> restartChat with Start.plugins and Start.mcpServers (host's + plugins' .mcp.json)
session/activeClientRemoved -> the client's plugins leave the set -> same restart at the next send
```

### Gaps

- `activeClient.customizations` is kept in `presence` and read by nothing.
- `Start` carries no plugins, and `mcpFor` has no client half.
- The daemon has no directory for copies of a client's files.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Each plugin is copied from the client into `<configDir>/agentPlugins/<uri key>/<nonce key>/`, a nonce already copied is not copied again, 64 copies are kept in all and 8 per plugin | [VS Code `agentPluginManager.ts#L22-L191`](https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentPluginManager.ts#L22-L191) | 01 |
| The copy is a port the sdk declares and implements on the file system, and the server hands it to the host with its directory; a host without the port reports each client plugin `load: error` "this host keeps no client plugins" | the sdk takes its ports from the server, as `gitChanges()` at [`code://packages/server/src/commands/run.ts#L420`](../../../../packages/server/src/commands/run.ts#L420); (defaulted: an embedded host has no config directory) | 01 |
| A plugin's `file:` URI under the copy directory is used where it is, without asking a client | (defaulted: host/47 p5 hands an automation's captured copies this way, and no client is connected at run time) | 01 |
| A client's plugins show in the session's customizations with its `clientId`, `loading` while copied, then `loaded` or `error` with the message, as `session/customizationUpdated` then `session/customizationsChanged` | [VS Code `agentPluginManager.ts#L104-L175`](https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentPluginManager.ts#L22-L191) | 02 |
| A client's plugins leave the session when ahpd's `leaves` removes the client | ahpd's presence rule | 02 |
| A client whose connection closes stays active, with its tools and plugins, for 30 seconds; a resubscribe within that time keeps it with no removal and no restart; an unsubscribe or a reconnect without resubscribing removes it at once | Softov, 2026-10-03, asked "When a client disconnects, how long do its contributions (tools, and now plugins) stay on the session? VS Code keeps a client for 30 seconds; ahpd drops it at once today.": "30 seconds, as VS Code"; [VS Code `protocolServerHandler.ts#L1145-L1192`](https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1145-L1192) | 04 |
| `session/customizationToggled` on a client plugin is the host's to answer: the plugin leaves or rejoins the set, and its `childEnablement` disables the children it names | [VS Code `agentSideEffects.ts#L370-L383`](https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentSideEffects.ts#L370-L383) | 02 |
| Claude gets the set as SDK `plugins` with `skipMcpDiscovery: true`, and the plugins' `.mcp.json` servers reach every backend through `Start.mcpServers`, a plugin's server winning a clash | VS Code `claudeSdkOptions.ts#L195-L196`, `claudeAgentSession.ts#L890-L950`, `codexAgent.ts#L2804-L2805`; decision `the-hosts-mcp-servers-are-root-config-as-in-vscode` | 03 |
| A changed set reaches the chat at its next send, by restarting it with `resume` and `seed`; a running turn is never cut | [VS Code `claudeAgentSession.ts#L1037-L1072`](https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1037-L1072) | 03 |
| A backend that does not load plugins (ACP, pi, cofold, nested) still reports them `loaded`, as copied, and gets their MCP servers alone | VS Code's Codex agent: its plugins are reported by the copy and only their servers are merged, `codexAgent.ts#L2804-L2805` | 03 |
| `session/customizationUpdated` goes to a 0.9.0 connection too | AHP 1.0.0 `ACTION_INTRODUCED_IN` | 02 |

## Proposed architecture

- **Data flow** - `activeClientSet` -> `ClientPlugins.sync(client, plugins)` -> copies -> the session's client-plugin entries -> laid over the backend's customizations wherever they go out -> the enabled set -> `Start.plugins` and `mcpFor` at the next spawn.
- **State flow** - per session, per client id: the announced plugins, their `load`, and the enabled set the running chat was started with; a send compares the two and restarts on a difference.
- **Layer responsibilities** - sdk: the port and its file implementation, the host's entries, the restart · agent-claude: `Start.plugins` to the SDK, and dropping its own report of a plugin whose path is a host copy · server: the directory.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host/relay.ts`](../../../../packages/sdk/src/host/relay.ts), [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) (`leaves`), [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A client's plugin is copied to the host](task-01-a-clients-plugin-is-copied-to-the-host.md) | todo | - |
| [02 - A session reports the plugins a client hands it](task-02-a-session-reports-a-clients-plugins.md) | todo | 01 |
| [03 - The agent runs with the session's client plugins](task-03-the-agent-runs-with-the-sessions-client-plugins.md) | todo | 02 |
| [04 - A disconnected client is kept for 30 seconds](task-04-a-disconnected-client-is-kept-for-30-seconds.md) | todo | - |

## Risks and tradeoffs

- A copy reads every file of a plugin over the client's connection; a large plugin makes the first announcement slow, and the nonce cache is what makes the next one free.
- A changed set costs a backend restart at the next send, as in VS Code.
- The copy directory grows with plugins and nonces up to the limits; eviction is best effort, as in VS Code.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-clients-plugin-is-copied-to-the-host.md](task-01-a-clients-plugin-is-copied-to-the-host.md).
- **Open questions:** none.
- **Watch out for:** ahpd's own "plugins" are daemon packages; everything here is a client plugin, and names say so.

## Final verification checklist

- [ ] A fake client announcing a plugin makes the session report it `loading` then `loaded`, and the next turn's `Start` carries its copy and its MCP server.
- [ ] Removing the client, or toggling the plugin off, takes it out of the next turn's `Start`.
- [ ] A client that disconnects keeps its tools and plugins for 30 seconds, and one that resubscribes in time causes no removal and no restart.
- [ ] `pnpm test` passes.
- [ ] `plans/index.md` updated; acp/11's deferred line points here.

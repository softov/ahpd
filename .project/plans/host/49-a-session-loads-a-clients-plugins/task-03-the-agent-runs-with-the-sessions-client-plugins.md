---
title: The agent runs with the session's client plugins
status: done
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
- `UPDATE: packages/agent-claude/test/agent-claude-options.test.ts`, `packages/sdk/test/host-tools.test.ts` - the cases below.
- `UPDATE: .project/plans/acp/11-the-agent-gets-mcp-servers/deferred.md` - line 7 points at this plan.

## Steps

1. Add `Start.plugins` and read each copy's `.mcp.json` (`mcpServers` key, relative commands resolved against the copy) into `mcpFor`.
2. Pass both at spawn, and restart at the next send on a difference; never during a turn.
3. Hand the plugins to the Claude SDK and drop its duplicate report.

## Validation

- `packages/sdk/test/host-tools.test.ts`, in `the MCP servers a session is offered`, with a fake agent recording `Start` and a client plugin copied in a temp directory with a `.mcp.json` naming server `a` that the host also names: the next spawn's `Start.plugins` names the copy and `Start.mcpServers.a` is the plugin's; toggling the plugin off and sending restarts the chat with neither; a send with an unchanged set does not restart; a change during a turn waits for the turn to end.
- `packages/agent-claude/test/agent-claude-options.test.ts`: `Start.plugins` reaches the SDK options with `skipMcpDiscovery: true`, and none are passed when it is absent.
- `pnpm test` passes.

## Resume

## Outcome

`Start.plugins?: { path: string }[]` is declared in `packages/sdk/src/types/agent.ts` beside `mcpServers`, and `SessionOptions.plugins` in `packages/sdk/src/types/session.ts`, so the value crosses the host-to-backend seam the way its servers do.

In `packages/sdk/src/host/tooling.ts` the enabled copies are `pluginCopies(uri)` - the plugins of this session that are loaded, on, and have a path - and `serversOf(copy)` reads one copy's `.mcp.json`: a `command` becomes a `stdio` server with a relative command resolved against the copy, a `url` with no type or `http` becomes an `http` server, and anything else in that file contributes nothing. `mcpFor(uri)` is the host's own map with each copy's servers spread over it, later copies last, which is the plugin winning a clash. `pluginsFor(uri, chatUri)` answers the enabled paths and writes down which they were, in `startedWith` by chat URI; `pluginsMoved(uri, chatUri)` compares that note with the set now. `packages/sdk/src/host/spawn.ts` passes `ctx.mcpFor(uri)` and `ctx.pluginsFor(uri, chatUri)`, the latter as `Start.plugins` and only when it is not empty.

`packages/sdk/src/host/chatactions.ts` restarts the chat at `chat/turnStarted` when `pluginsMoved` is true and the session is not `InProgress`, through `restartChat` - which is already the resumed, seeded restart - and then begins the turn on the chat that took the old one's place. All four cases in Validation are in `packages/sdk/test/host-tools.test.ts`, in `the MCP servers a session is offered`, over a plugin whose tree a second connection serves and whose copy is a real directory.

On the backend, `packages/agent-claude/src/claude.ts` carries `start.plugins` into the session, `session/query.ts` hands it to the SDK as `{ type: 'local', path, skipMcpDiscovery: true }`, and `session/customizations.ts` gained an `ours` set so a plugin the CLI reports at a path this host handed over is left out of the customizations the host builds - `session/servers.ts` passes the paths it was given. The two cases in Validation are in `packages/agent-claude/test/agent-claude-options.test.ts`, which gained a fake CLI recording the `query()` options. `.project/plans/acp/11-the-agent-gets-mcp-servers/deferred.md` now names this plan in place of the gap it recorded.

Four things the plan left open or stale. The restart is in `chatactions.ts`, which task 02 names and this one does not: a send is dispatched there, and the guard has to be where the send is. The task's named `packages/agent-claude/src/session.ts` is now a barrel - the query options are in `session/query.ts`, the plugin report in `session/customizations.ts`, and the seam that reads `Start` is `claude.ts` - so the backend half is spread over those four files, all of them this module. `pluginsFor` takes the session and the chat rather than a session alone, because what a set is compared against is one chat's agent. And an entry in a plugin's `.mcp.json` that names a transport this host has no word for - `sse` - is passed over rather than relabelled as `http`, matching how `serversFor` treats a file it cannot use: the CLI reads the same file itself.

One bound worth stating: a message that arrives while a turn is running is begun by the backend on the set the chat already has - `chat/turnStarted` reaches `Session.begin`, and the explicit queue is `chat/pendingMessageSet` - so the restart lands on the next send that finds the chat idle rather than on one that arrives mid-turn. Nothing is cut, which is what the decision asks for, and the turn that was running is left to finish: the test for it reads `chat/turnComplete`, which a chat replaced mid-answer would never have sent. The note is also kept for a chat URI that is never spawned again, one string per chat, which is the same shape `beside` and `moving` already have.

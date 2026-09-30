---
title: The agent gets the host's MCP servers
domain: acp
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-09-30
requires:
  - plans/daemon/11-root-config-carries-the-daemon-and-its-plugins/plan.md
changes: []
creates: []
decisions:
  - decisions/acp-ports-come-through-start.md
  - decisions/the-hosts-mcp-servers-are-root-config-as-in-vscode.md
  - decisions/the-hosts-tools-are-an-mcp-server-each-backend-may-take.md
refs:
  - "[code://packages/agent-acp/src/session.ts#L537-L549](../../../../packages/agent-acp/src/session.ts#L537-L549) - `mcpServers: []` on every open"
  - "[code://packages/agent-acp/src/session.ts#L1145-L1147](../../../../packages/agent-acp/src/session.ts#L1145-L1147) - `startMcpServer` answers false"
  - "[code://packages/sdk/src/types/agent.ts#L90-L168](../../../../packages/sdk/src/types/agent.ts#L90-L168) - `Start`, where the host's tools arrive"
  - https://agentclientprotocol.com/protocol/session-setup - `mcpServers` and `mcpCapabilities`
---

## Goal

An ACP agent is given the MCP servers the host is configured with, filtered by what the agent's `mcpCapabilities` accept, and the host's own tools as one HTTP MCP server the host serves for that session.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- Every session opens with `mcpServers: []`.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [An ACP backend reaches files and a shell through Start](../../../decisions/acp-ports-come-through-start.md) | 02 |
| [The host's MCP servers are the root config key `mcpServers`, as in VS Code](../../../decisions/the-hosts-mcp-servers-are-root-config-as-in-vscode.md) | 01, 02 |
| [The host's tools are an MCP server the host serves, and each agent plugin says whether its sessions take it](../../../decisions/the-hosts-tools-are-an-mcp-server-each-backend-may-take.md) | 03, 04 |

| What | Source | Task |
| --- | --- | --- |
| Servers the agent's `mcpCapabilities` do not accept (`http`, `sse`) are left out and logged | https://agentclientprotocol.com/protocol/session-setup | 04 |
| agent-acp's option is `hostTools`, on by default | (defaulted: the ACP bridge is why the service exists) | 04 |

## Proposed architecture

- **Data flow** - host MCP configuration and `Start.tools` -> `mcpServers` on `session/new` and `session/load`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - `mcpServers` in the configuration and in root config](task-01-mcp-servers-in-the-configuration.md) | todo | daemon/11 task 02 |
| [02 - A session's MCP servers reach its backend in Start](task-02-a-sessions-mcp-servers-reach-start.md) | todo | 01 |
| [03 - The host serves its tools as an MCP server per session](task-03-the-host-serves-its-tools-over-mcp.md) | todo | - |
| [04 - The ACP bridge opens a session with its MCP servers](task-04-the-acp-bridge-opens-with-mcp-servers.md) | todo | 02, 03 |
| [05 - Docs](task-05-docs.md) | todo | 04 |

## Risks and tradeoffs

- A per-session MCP endpoint is a listener with a token - it rides the daemon's listener rather than a new port.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-03-the-host-serves-its-tools-over-mcp.md](task-03-the-host-serves-its-tools-over-mcp.md), which needs nothing else; 01 after daemon/11 task 02.
- **Open questions:** none; answered 2026-09-30.
- **Watch out for:** ACP v2 routes files and terminals through an MCP server too (plugin 18's deferred.md); the service built here is where that would land.

## Final verification checklist

- [ ] A session's agent can call a host tool over MCP.
- [ ] `plans/index.md` updated.

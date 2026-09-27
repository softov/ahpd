---
title: The agent gets the host's MCP servers
domain: acp
status: draft
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions:
  - decisions/acp-ports-come-through-start.md
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
| [An ACP backend reaches files and a shell through Start](../../../decisions/acp-ports-come-through-start.md) | the tools port is the same kind of seam |

| What | Source | Task |
| --- | --- | --- |
| This plan stays a draft until its questions are answered | (defaulted) | - |

## Proposed architecture

- **Data flow** - host MCP configuration and `Start.tools` -> `mcpServers` on `session/new` and `session/load`.

## Tasks

Written when this plan leaves draft. The outline:

1. The host's configured MCP servers passed, filtered by capability.
2. `Start.tools` served as an HTTP MCP server per session, with a per-session token.
3. Docs.

## Risks and tradeoffs

- A per-session MCP endpoint is a listener with a token - it rides the daemon's listener rather than a new port.

## Resume state

- **Done so far:** nothing.
- **Next action:** answer the open questions.
- **Open questions:**
  1. Where does the host keep its MCP server configuration: the daemon config, or a plugin option? - proposed: the daemon config, shared by every backend.
  2. Does `Start.tools` become an MCP server for the ACP bridge only, or a host service any backend may use? - proposed: a host service.
- **Watch out for:** ACP v2 routes files and terminals through an MCP server too (plugin 18's deferred.md); the service built here is where that would land.

## Final verification checklist

- [ ] A session's agent can call a host tool over MCP.
- [ ] `plans/index.md` updated.

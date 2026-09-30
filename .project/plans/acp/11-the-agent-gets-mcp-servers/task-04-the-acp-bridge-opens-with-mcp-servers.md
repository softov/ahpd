---
title: The ACP bridge opens a session with its MCP servers
status: todo
depends: [task-02-a-sessions-mcp-servers-reach-start.md, task-03-the-host-serves-its-tools-over-mcp.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L537-L549](../../../../packages/agent-acp/src/session.ts#L537-L549) - `mcpServers: []`"
  - "[code://packages/agent-acp/src/session.ts#L1145-L1147](../../../../packages/agent-acp/src/session.ts#L1145-L1147) - `startMcpServer`"
  - https://agentclientprotocol.com/protocol/session-setup - `mcpServers` and `mcpCapabilities`
---

## Objective

`session/new` and `session/load` carry `Start.mcpServers` in ACP's shape, less any the agent's `mcpCapabilities` refuse, plus the host tools server when the `hostTools` option is on (the default).

## Files

- `UPDATE: packages/agent-acp/src/session.ts` - the list, the filter and the log line for each server left out.
- `UPDATE: packages/agent-acp/src/plugin.ts` and `package.json`'s `ahpd.options` - `hostTools`.
- `UPDATE:` the agent-acp tests.

## Steps

1. Tests first with the fake ACP agent: a stdio server passes; an http server passes only when `mcpCapabilities.http`; `hostTools` adds the host server with its header; `hostTools: false` leaves it out.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- By hand: Codex over ACP lists and calls a host tool.

## Resume

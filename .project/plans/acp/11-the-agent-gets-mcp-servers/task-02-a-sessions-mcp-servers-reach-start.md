---
title: A session's MCP servers reach its backend in Start
status: todo
depends: [task-01-mcp-servers-in-the-configuration.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L90-L168](../../../../packages/sdk/src/types/agent.ts#L90-L168) - `Start`"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2687-L2710 - the merge order
---

## Objective

`Start.mcpServers` is the host's map merged with the session's enabled client plugins' servers, a client plugin winning a clash, read when the session starts.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - `mcpServers` on `Start`, documented.
- `UPDATE: packages/sdk/src/types/host.ts` and `packages/sdk/src/host.ts` - where the host's map comes from, and the merge.
- `UPDATE:` the host tests.

## Steps

1. Tests first with a fake backend: the host's map reaches `Start`; a disabled client plugin's server does not; a client plugin's server of the same name wins.
2. Implement; if the host has no client plugin customizations yet, the map alone, and say so in Resume.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

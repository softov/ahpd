---
title: The host serves its tools as an MCP server per session
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L90-L168](../../../../packages/sdk/src/types/agent.ts#L90-L168) - `Start.tools`"
  - https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http - the transport
---

## Objective

A backend may ask the host for `Start.toolsServer`, an HTTP MCP endpoint on the daemon's listener, one path and bearer token per session, that lists and calls that session's `Start.tools` and stops when the session ends.

## Files

- `CREATE: packages/sdk/src/toolserver.ts` - the endpoint: `initialize`, `tools/list`, `tools/call` over streamable HTTP, JSON-RPC by hand.
- `UPDATE: packages/sdk/src/host.ts` and `packages/sdk/src/types/agent.ts` - how a backend asks for it.
- `CREATE: packages/sdk/test/toolserver.test.ts` - the cases below.

## Steps

1. Tests first: a list gives the session's tools; a call runs one and answers its result; a wrong token is 401; another session's token does not reach this one; after the session ends the path is 404.
2. Implement with no new dependency.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

---
title: The current client entry and version
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/connection.ts#L14](../../../../packages/agent-acp/src/connection.ts#L14) - the import"
  - "[code://packages/agent-acp/src/connection.ts#L45](../../../../packages/agent-acp/src/connection.ts#L45) - `clientInfo`"
---

## Objective

`@agentclientprotocol/sdk` `^1.5.0`, `client({ name }).connect(stream)`, and `clientInfo.version` read from the package.

## Files

- `UPDATE: packages/agent-acp/package.json`.
- `UPDATE: packages/agent-acp/src/connection.ts`.

## Steps

1. Behaviour unchanged; every existing test passes.

## Validation

- `pnpm --filter @ahpd/agent-acp test` green.

## Resume

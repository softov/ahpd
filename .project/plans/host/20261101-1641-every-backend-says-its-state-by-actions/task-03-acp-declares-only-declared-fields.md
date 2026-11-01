---
title: ACP declares only declared fields
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/handlers.ts](../../../../packages/agent-acp/src/session/handlers.ts) - `commandLeaf`, a server command as a prompt"
  - "[code://packages/agent-acp/src/session/config.ts](../../../../packages/agent-acp/src/session/config.ts) - `optionControl`, a server option as a schema property"
---

## Objective

An ACP session's state carries only the fields the protocol's types declare.

## Files

- `UPDATE: packages/agent-acp/src/session/handlers.ts:104-112` - a command's hint goes under `_meta['ahpd.argumentHint']`.
- `UPDATE: packages/agent-acp/src/session/config.ts:168-180` - an option's property carries no `scope`.

## Steps

1. Put a command's input hint under `_meta['ahpd.argumentHint']`.
2. Remove `scope` from the properties a session puts in its state.
3. Run ACP's suites.

## Validation

- A test of each change fails before it, on the undeclared key, and passes after it.
- `pnpm exec vitest run packages/agent-acp/test` passes.

## Resume

<Empty until started.>

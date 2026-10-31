---
title: A customization switch is answered to the client that turned it
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1268-L1421](../../../../packages/sdk/src/host/chatactions.ts#L1268-L1421) - `session/customizationToggled`"
---

## Objective

A client's switch of a customization is said back with its origin once it is made, by the backend or by this host for a client's plugin.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - the switch said back with the client's origin and the enablement this host applied, before the list or the entry it is read from.
- `UPDATE: packages/sdk/test/host-harness.test.ts` - a backend's MCP server switched off answers the client with its own action.
- `UPDATE: packages/sdk/test/client-plugins-session.test.ts` - a client plugin switched off answers the client with its own action.
- `UPDATE: docs/sdk/AHP.md` - the `session/customizationToggled` row.

## Steps

1. Write the cases and run them on `ab07054c` to see nothing carry the client's origin.
2. Say the switch back.

## Validation

- The new cases fail on `ab07054c` and pass after the change.
- `host-harness`, `client-plugins-session`, `host-tools` and `echo-origin` pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

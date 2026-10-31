---
title: A background request is answered
status: done
depends: [01]
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `session/mcpServerBackgroundRequested`"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - `backgroundMcpServerStartup`, `deliver` and `carry`"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - the `backgroundMcpServerStartup` contract"
---

## Objective

A client's `session/mcpServerBackgroundRequested` is answered: by its sender's echo where no backend takes it, and through the host inside for a nested session.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - a backend without the call, or one that does not take it, leaves the request to the host, which answers its sender.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - the request is carried inside, so the answer there reaches the client that sent it.
- `UPDATE: packages/sdk/src/types/session.ts` - the contract says who answers.
- `UPDATE: packages/sdk/test/host-harness.test.ts` - the request on a Claude session is answered to its sender.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - the answer inside reaches the client outside with its origin.
- `UPDATE: docs/sdk/AHP.md` - the `session/mcpServerBackgroundRequested` row.

## Steps

1. Write the cases and see them fail on `08b1d57a`, with protocol cases 274, 275 and 276.
2. Answer the request.

## Validation

- The cases fail on `08b1d57a` and pass after.

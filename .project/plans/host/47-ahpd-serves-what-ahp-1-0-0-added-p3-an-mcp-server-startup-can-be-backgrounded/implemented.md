---
title: A blocking MCP server startup can be sent to the background - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
  - "[code://packages/sdk/src/nested.ts](../../../../packages/sdk/src/nested.ts)"
---

A client can ask the host to stop holding a turn on an MCP server that is still starting.
The host hands `session/mcpServerBackgroundRequested` to a backend that can do it, and says nothing to one that cannot.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - the optional `backgroundMcpServerStartup` on `Session`, VS Code's name for the seam.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the action calls it where it exists, with no refusal either way.
- [`code://packages/sdk/src/nested.ts`](../../../../packages/sdk/src/nested.ts) - a nested session hands the action to the host inside.
- [`code://docs/AHP.md`](../../../../docs/AHP.md) - the action row.

## Verified

- In the review worktree on main `2ba4246`: install, schema, build, typecheck and boundary pass, and the suite passes 4709 tests in 265 files.
- New cases are in `host-harness.test.ts`, `nested-proxy.test.ts`, `users-gate-dispatch.test.ts`, `conformance.test.ts` and agent-claude's `customizations.test.ts`.
- The protocol's three cases for the action left `HOST_REFUSED` in `ahp-test-cases.test.ts` and replay with no difference.
- No ahpd backend holds a turn on a starting server, so no test drives `blocking: true` to `false`.

## Departures from the plan

- The gate cases are in `users-gate-dispatch.test.ts`, because host/55 split `users-gate.test.ts`.
- `ahp-test-cases.test.ts` changed, a file the task did not name.

## Left for later

- none.

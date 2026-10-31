---
title: A start or a stop is answered once and followed by the state
status: pending
depends: []
layer: claude
refs:
  - "[code://packages/agent-claude/src/session/servers.ts#L455-L469](../../../../packages/agent-claude/src/session/servers.ts#L455-L469) - `startMcpServer`"
  - "[code://packages/agent-claude/src/session/servers.ts#L509-L523](../../../../packages/agent-claude/src/session/servers.ts#L509-L523) - `stopMcpServer`"
  - "[code://packages/agent-claude/src/session/servers.ts#L136-L221](../../../../packages/agent-claude/src/session/servers.ts#L136-L221) - `refreshMcp`"
---

## Objective

A start or a stop said with the client's origin gives the session's own entry the reducer's effect, so the refresh after the CLI call follows with the state the CLI reports; a CLI call that throws is answered by that state too.

## Files

- `UPDATE: packages/agent-claude/src/session/servers.ts` - `startMcpServer` and `stopMcpServer` give the held entry the request's effect as they say it, and answer true once it is said.
- `UPDATE: packages/sdk/test/support/claude-sdk.ts` - a toggle or a reconnect that throws, as the SDK's calls do on failure.
- `UPDATE: packages/sdk/test/host-harness.test.ts` - a start of a ready server followed by `ready`; a start whose reconnect throws, answered once and followed by the state; a stop whose toggle throws, followed by the state the server still has.
- `UPDATE: docs/sdk/AHP.md` - the `session/mcpServerStartRequested` and `session/mcpServerStopRequested` rows.

## Steps

1. Write the cases and run them on `08b1d57a` to see each fail for the reason it names.
2. Give the held entry the request's effect, and answer a said request by its state.

## Validation

- The new cases fail on `08b1d57a` and pass after the change.
- `host-harness` and the agent-claude suite pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

Not started.

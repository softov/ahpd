---
title: A stop keeps the enablement, and a start after it switches the server on
status: done
depends: [01]
layer: claude
refs:
  - "[code://packages/agent-claude/src/session/servers.ts#L407-L444](../../../../packages/agent-claude/src/session/servers.ts#L407-L444) - `setCustomizationEnabled`, the order a switch on takes"
  - "[code://packages/agent-claude/src/session/customizations.ts#L431](../../../../packages/agent-claude/src/session/customizations.ts#L431) - the enablement read off the CLI's status"
---

## Objective

A server the session switched off to serve a client's stop keeps the enablement it had and reads `stopped`; a start of it lifts the CLI's disabled flag before it reconnects; a client's switch of it is the client's decision.

## Files

- `UPDATE: packages/agent-claude/src/session/servers.ts` - the servers a stop switched off, kept by name; a start of one switches it on first; a switch forgets it.
- `UPDATE: packages/agent-claude/src/session/customizations.ts` - a server a stop switched off reads enabled while the CLI reports it `disabled`.
- `UPDATE: packages/sdk/test/host-harness.test.ts` - a stop leaves the enablement and reads `stopped`, and a switch off after it is the client's; a start after a stop switches the server on, reconnects it and follows with `ready`.
- `UPDATE: docs/sdk/AHP.md` - the `session/mcpServerStopRequested` row.

## Steps

1. Write the cases and run them on `08b1d57a` to see each fail for the reason it names.
2. Keep the servers a stop switched off, and read them as they were.

## Validation

- The new cases fail on `08b1d57a` and pass after the change.
- `host-harness` and the agent-claude suite pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

Done 2026-10-31.
Every step is built, and the touched suites, the type check and the boundary check pass.

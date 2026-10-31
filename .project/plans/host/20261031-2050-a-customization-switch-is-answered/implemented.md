---
title: A customization switch is answered to the client that turned it - implemented
date: 2026-10-31
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `session/customizationToggled`"
---

A client's switch of a customization is said back to every client of the session with its sender's origin once it is made, by the backend or by this host for a client's plugin.
It carries the enablement this host applied, and the list or the plugin's entry it is read from follows it; a switch the backend cannot make stays a refusal.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the enablement this host applies is computed once, the switch is said back with it and the client's origin after a client plugin's entry, and after the backend took the switch, before the list.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), the `session/customizationToggled` row.
- One case in `host-harness.test.ts` (an MCP server the Claude backend switches off) and one in `client-plugins-session.test.ts` (a client plugin this host switches off): the switch is the one envelope with the client's origin, and no rejection.

## Verified

- On `ab07054c` both cases fail for the reason they name: nothing carries the client's origin.
- After the change, `host-harness`, `client-plugins-session`, `host-tools` and `echo-origin` pass with 138 tests.
- The round's full run at two workers: `test:unit` passes 7337 cases and `test:processes` 695, with no failure.
- `pnpm run typecheck` and `pnpm run boundary` pass.

## Departures from the plan

- none.

## Left for later

- none.

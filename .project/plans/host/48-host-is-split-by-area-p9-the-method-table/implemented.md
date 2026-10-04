---
title: The method table is split by family - implemented
date: 2026-10-04
refs:
  - git://ca6adcb
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts)"
---

The request methods a connection answers live in one file per family, and `host.ts` composes them.

## What was built

- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - `initialize`, `reconnect` and the handshake gate.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the session and chat methods.
- [`code://packages/sdk/src/host/resourcemethods.ts`](../../../../packages/sdk/src/host/resourcemethods.ts) - the resource methods and `storeFor`.
- [`code://packages/sdk/src/host/vscodemethods.ts`](../../../../packages/sdk/src/host/vscodemethods.ts) - the `vscode/*` methods.
- The terminal and automation methods joined [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts) and [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts).
- A connection's mutable state (`alive`, `handshook`, `containers`) lives on its `ConnectionContext`.

## Verified

- A pure move: of the lines added under `packages/sdk/src/host/` by p9 to p11, all but 214 are lines removed from `host.ts`, and those 214 are the context wiring (factory signatures, destructuring, `conn.<field>` assignments).
- After rebasing onto `2d552bb`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (177 files, 2717 tests) pass.

## Departures from the plan

- None.

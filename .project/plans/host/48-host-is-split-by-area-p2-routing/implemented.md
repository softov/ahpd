---
title: The URI routing, the client relay and the connection gate are files of their own - implemented
---

## What exists

- `host/context.ts` holds `HostContext`; `host/routing.ts`, `host/relay.ts` and `host/admission.ts` hold name resolution and routing, the relay to other clients, and per-connection admission.

## Verified

- A pure move: every line removed from `host.ts` reappears in `packages/sdk/src/host/` (an `export`, a `ctx.` prefix or a reflowed comment aside).
- After rebasing onto main: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2672 tests) pass. `host.ts` is 8,871 lines after p1-p4, from 11,658.

## Departures

- None.

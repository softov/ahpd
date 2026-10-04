---
title: Telemetry, sign-in requirements, owners and machines are files of their own - implemented
---

## What exists

- `host/telemetry.ts`, `host/auth.ts`, `host/owners.ts` and `host/machines.ts` hold telemetry, sign-in asking, owners and charging, and machine placement.

## Verified

- A pure move: every line removed from `host.ts` reappears in `packages/sdk/src/host/` (an `export`, a `ctx.` prefix or a reflowed comment aside).
- After rebasing onto main: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2672 tests) pass. `host.ts` is 8,871 lines after p1-p4, from 11,658.

## Departures

- `HostContext` gained `offered`, `decided`, `isolating` and `mineOf`, which `settle` reads; p5 finds them on the context already. `enteredIn` is taken off the context as well.

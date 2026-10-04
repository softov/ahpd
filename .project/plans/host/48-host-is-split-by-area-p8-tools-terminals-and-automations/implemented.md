---
title: Session tools, terminals and automations are files of their own - implemented
---

## What exists

- `host/tooling.ts`, `host/terminals.ts` and `host/automations.ts` hold what a session's model is offered and what a host tool sees, the host's own terminals and `claimOf`, and the automation runtime beside the `runState` that has been there since p6.

## Verified

- A pure move: every line removed from `host.ts` reappears in `packages/sdk/src/host/` (an `export`, a `ctx.` prefix or a reflowed comment aside).
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2700 tests) pass. `host.ts` is 5,077 lines after p8, from 5,822.

## Departures

- `advancedTools`, `contributed` and `contributing` are context fields, as the plan locked in, and their writers outside the moved code write `ctx.<name>`.
- `origins` stayed in the ctx literal rather than moving into the automations factory: `catalogue.ts` and `lifecycle.ts` share it, and the automations factory is built after both. `starting` is shared the same way. `linked` is read only by the factory, so it moved.
- `spawn.ts` reads `ctx.settleRun` at its three call sites, for the same reason.

## Reviewed

- A pure move: every code line removed from `host.ts` reappears under `packages/sdk/src/host/` (a `ctx.` prefix, an `export`, the context literal and two event registrations moved into their factory aside); the wire capture records the same order as main across three runs.
- After rebasing onto `d3b3e92`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2707 tests) pass. `host.ts` is 5,077 lines.

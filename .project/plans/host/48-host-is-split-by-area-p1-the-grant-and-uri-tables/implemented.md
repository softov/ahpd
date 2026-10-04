---
title: The grant tables and the URI names are files of their own - implemented
---

## What exists

- `host/common.ts`, `host/state.ts`, `host/channels.ts` and `host/gate.ts` hold the shared helpers, the held-state types, the URI and channel tables, and `NEEDS` with the other grant tables; `host.ts` re-exports what it exported before.

## Verified

- A pure move: every line removed from `host.ts` reappears in `packages/sdk/src/host/` (an `export`, a `ctx.` prefix or a reflowed comment aside).
- After rebasing onto main: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (174 files, 2672 tests) pass. `host.ts` is 8,871 lines after p1-p4, from 11,658.

## Departures

- None.

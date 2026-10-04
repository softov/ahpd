---
title: The catalogue, past sessions and snapshots are files of their own - implemented
---

## What exists

- `host/catalogue.ts`, `host/history.ts` and `host/snapshots.ts` hold the catalogue and its rows, the past sessions a host remembers and their transcripts, and the snapshot reducer every channel is read through. `host/automations.ts` holds `runState` already, and holds the automation runtime from p8.

## Verified

- A pure move: every line removed from `host.ts` reappears in `packages/sdk/src/host/` (an `export`, a `ctx.` prefix or a reflowed comment aside).
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2700 tests) pass. `host.ts` is 7,186 lines after p6, from 8,178.

## Departures

- None.

## Reviewed

- A pure move: every code line removed from `host.ts` reappears under `packages/sdk/src/host/` (a `ctx.` prefix, an `export`, the context literal and two event registrations moved into their factory aside); the wire capture records the same order as main across three runs.
- After rebasing onto `d3b3e92`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2707 tests) pass. `host.ts` is 5,077 lines.

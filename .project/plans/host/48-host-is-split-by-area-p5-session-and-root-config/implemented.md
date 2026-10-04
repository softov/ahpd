---
title: Session config and root config are files of their own - implemented
---

## What exists

- `host/sessionconfig.ts` and `host/root.ts` hold a session's own config and schema, and the root channel's state, descriptors, config and properties.

## Verified

- A pure move: every line removed from `host.ts` reappears in `packages/sdk/src/host/` (an `export`, a `ctx.` prefix or a reflowed comment aside).
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2700 tests) pass. `host.ts` is 8,178 lines after p5, from 8,889.

## Departures

- None.

## Reviewed

- A pure move: every code line removed from `host.ts` reappears under `packages/sdk/src/host/` (a `ctx.` prefix, an `export`, the context literal and two event registrations moved into their factory aside); the wire capture records the same order as main across three runs.
- After rebasing onto `d3b3e92`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2707 tests) pass. `host.ts` is 5,077 lines.

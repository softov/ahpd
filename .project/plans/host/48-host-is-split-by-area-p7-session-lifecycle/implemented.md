---
title: Starting, restarting and removing a session are files of their own - implemented
---

## What exists

- `host/spawn.ts` and `host/lifecycle.ts` hold starting a backend's session and its worker chats, and opening, moving, restarting and removing one. The tasks a p5-p6 field feeds reads, and the terminal thunk, are on `HostContext` until p8 offers them.

## Verified

- A pure move: every line removed from `host.ts` reappears in `packages/sdk/src/host/` (an `export`, a `ctx.` prefix or a reflowed comment aside).
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2700 tests) pass. `host.ts` is 5,822 lines after p7, from 7,186.

## Departures

- `HOSTS_OWN` moved to `host/common.ts`, which `host.ts` reads as well.
- `beginOrRun` takes its fallback directory from `options.path` rather than a new context field, which is the same value the old thunk carried.
- `moveSession` became an offered member of `Lifecycle`; p8 gives the other four late assignments the same shape.

## Reviewed

- A pure move: every code line removed from `host.ts` reappears under `packages/sdk/src/host/` (a `ctx.` prefix, an `export`, the context literal and two event registrations moved into their factory aside); the wire capture records the same order as main across three runs.
- After rebasing onto `d3b3e92`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2707 tests) pass. `host.ts` is 5,077 lines.

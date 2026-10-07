---
title: The daemon config sets the window
status: done
depends: [task-01-dispatch-merges-deltas.md]
layer: "server"
refs:
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the daemon's config, which builds `HostOptions`"
---

## Objective

`deltaWindowMs` in the daemon's `config.json` reaches `HostOptions`, with 75 when absent and 0 to turn merging off.

## Files

- `UPDATE: packages/server/src/config.ts:183` - `deltaWindowMs?: number`, a whole number from 0 to 1000.
- `UPDATE: packages/server/src/commands/options.ts:67` - the key on `Options`.
- `UPDATE: packages/server/src/commands/options.ts:417` - the field, which is the flag, the file's schema and the range check.
- `UPDATE: packages/server/src/commands/options.ts:879` - the default rule: absent stays absent, so the host's 75 is the one place it is held.
- `UPDATE: packages/server/src/commands/run.ts:593` - the option reaches `createHost`.
- `UPDATE: docs/DAEMON.md:525` - one paragraph in the config reference.
- `UPDATE: packages/server/test/config-check.test.ts:77` - an out-of-range value refused.
- `UPDATE: packages/server/test/config-check.test.ts:106` - absent, 0 and 75 read onto the options.

## Steps

1. Refuse a value out of range at start, as other config values are.

## Validation

- A config test for absent, 0, 75 and an out-of-range value.

## Resume

Implemented 2026-10-07.

- `deltaWindowMs` is a field in `serverFields`, so it is the flag `--delta-window-ms`, the key `config.json` may hold, and a range check of 0 to 1000. `packages/server/test/config-check.test.ts` reads absent, 0 and 75 onto the options and refuses 1001.
- `optionsFrom` leaves it absent rather than defaulting, and `run.ts` hands it to `createHost` only when it is set. The host's own 75 is the one place the default is held.
- `docs/DAEMON.md` says what the key does, its default and its range.

Departures from the plan:

- The task's Files list named `packages/server/src/config.ts` alone. The key also needs a field in `packages/server/src/commands/options.ts`. That field is what the flag, the file's schema and the range check are built from. One line in `packages/server/src/commands/run.ts` hands it over. Both follow `clientToolTimeoutMs`.

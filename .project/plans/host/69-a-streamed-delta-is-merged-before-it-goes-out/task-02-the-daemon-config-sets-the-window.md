---
title: The daemon config sets the window
status: todo
depends: [task-01-dispatch-merges-deltas.md]
layer: "server"
refs:
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the daemon's config, which builds `HostOptions`"
---

## Objective

`deltaWindowMs` in the daemon's `config.json` reaches `HostOptions`, with 75 when absent and 0 to turn merging off.

## Files

- `UPDATE: packages/server/src/config.ts` - read and validate it (a whole number from 0 to 1000).
- `UPDATE: docs/DAEMON.md` - one line in the config reference.

## Steps

1. A value out of range is refused at start, as other config values are.

## Validation

- A config test for absent, 0, 75 and an out-of-range value.

## Resume

---
title: The daemon chooses per turn or per report
status: todo
depends: [task-01-the-host-meters-turns.md]
layer: "server"
refs:
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - `Config`, where `usage.per` goes"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `HostOptions`, where the host is told"
---

## Objective

`usage.per` in the daemon config is `turn` (default) or `report`, checked like the other keys and passed to the host.
With `report`, each `chat/usage` writes a record holding what it added since the turn's previous report (token fields and cost subtracted; a field that went down is written as its new value), and the turn's end writes nothing more.

## Files

- `UPDATE: packages/server/src/config.ts`, `packages/server/src/commands/run.ts` - the key and its passing.
- `UPDATE: packages/sdk/src/types/host.ts`, the meter - the mode.
- `UPDATE: docs/` where the daemon config keys are listed.

## Validation

- The meter test: per report, three growing reports leave three records summing to the last; a bad `usage.per` fails the config check naming the key.

## Resume

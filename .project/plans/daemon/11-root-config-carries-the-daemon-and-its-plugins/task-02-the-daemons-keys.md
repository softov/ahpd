---
title: The daemon's keys in root config
status: done
depends: [task-01-the-host-takes-a-root-config-port.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L117-L263](../../../../packages/server/src/commands/options.ts#L117-L263) - `serverFields` and `configSchema`"
  - "[code://packages/server/src/commands/options.ts#L327-L342](../../../../packages/server/src/commands/options.ts#L327-L342) - `checkConfig`"
  - "[code://packages/server/src/install.ts#L137-L161](../../../../packages/server/src/install.ts#L137-L161) - `readEntry` and `writeEntry`"
---

## Objective

The daemon gives the host a `rootConfig` port whose schema is `paths`, `port`, `host`, `http`, `updateCheck`, `advancedTools` and `wire`, taken from `serverFields`; values come from `config.json`; a write is checked, written inside `oneAtATime`, and answers `restartNeeded` for any key but `advancedTools` and `wire`.

## Files

- `CREATE: packages/server/src/rootconfig.ts` - the port.
- `UPDATE: packages/server/src/commands/run.ts` - hand it to the host.
- `UPDATE: packages/server/src/install.ts` - share `readEntry` and `writeEntry` and the write lock.
- `CREATE: packages/server/test/server-root-config.test.ts` - the cases below.

## Steps

1. Tests first in a temp config directory: the schema lists the seven keys and none of the others; a write of `paths` changes `config.json`, keeps every other key and answers `restartNeeded`; a write of `port: "x"` is refused and the file is untouched; a key overridden by a start flag says so in its description.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

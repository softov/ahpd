---
title: ahpd start runs the daemon under the same node flags it was run with
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/daemon.ts#L118-L146](../../../../packages/server/src/daemon.ts#L118-L146) - `start`, which spawns `process.execPath` with the script and not `process.execArgv`"
  - "[code://packages/server/test/server-cli.test.ts#L94-L112](../../../../packages/server/test/server-cli.test.ts#L94-L112) - `daemonEnv` puts the loader in `NODE_OPTIONS`, which is why the pinning cases never saw this"
  - "[code://packages/server/test/server-cli.test.ts#L120-L143](../../../../packages/server/test/server-cli.test.ts#L120-L143) - `cli`, which spawns `[MAIN, ...args]` with the loader in `NODE_OPTIONS`, so it cannot reproduce the dev runner"
  - "[code://scripts/dev.mjs](../../../../scripts/dev.mjs) - the dev runner's loader"
---

## Objective

`node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts start ...` starts a daemon that stays up, because the child runs under the node flags the parent was given.

## Files

- `UPDATE: packages/server/src/daemon.ts:143` - the child's arguments.
- `UPDATE: packages/server/test/server-cli.test.ts` - the case below.

## Steps

1. `start` spawns `process.execPath` with `...process.execArgv` ahead of the script and the forwarded words.
2. An installed daemon runs with an empty `execArgv`, so nothing changes for it; check that with the existing `start` cases.
3. If a flag in `execArgv` would make the child fight the parent (an `--inspect` port, for example), stop and ask before filtering anything.

## Validation

- `server-cli.test.ts`: the case spawns its own child rather than going through `cli()`, because `cli()` spawns `[MAIN, ...args]` with the loader in `NODE_OPTIONS`, and a child inherits that environment whatever `start` passes it.
  It spawns `process.execPath` with `['--conditions', 'development', '--import', './scripts/dev.mjs', MAIN, 'start', ...]`, the loader on node's own argv as the dev runner puts it, and an environment from `daemonEnv` with `NODE_OPTIONS` removed.
  The daemon the record names answers `status`, and the case kills every daemon the log names, as the other `start` cases do.
  Today the child crashes on `registry.js` and `start` fails, so the case fails before the fix.
- The existing `start` cases still pass.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.
- By hand: the command in the Objective, on a scratch `XDG_CONFIG_HOME` and a port away from 9187, then `stop`.

## Resume

Implemented 2026-09-27. The case was written first and seen to fail: the runner-shaped child exited 1 with `Could not start it: it exited with 1`.

`start` spawns `process.execPath` with `...process.execArgv` ahead of the script and the forwarded words. An installed daemon has an empty `execArgv`, so nothing changes for it, which the existing `start` cases check.

The case spawns its own child because `cli()` puts the loader in `NODE_OPTIONS`, which a child inherits whatever `start` passes it. `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts`: 47 passed. `pnpm typecheck`, `pnpm boundary` and `pnpm test`: 103 files, 1363 tests passed.

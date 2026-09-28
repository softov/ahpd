---
title: The daemon hands plugins every served path
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L382-L395](../../../../packages/server/src/commands/run.ts#L382-L395) - the call that leaves `paths` out"
  - "[code://packages/server/src/plugins.ts#L497](../../../../packages/server/src/plugins.ts#L497) - the fallback to the first path"
---

## Objective

`run.ts` passes `options.paths` to `loadPlugins`, so every plugin's `host.paths` is every served path.

## Files

- `UPDATE: packages/server/src/commands/run.ts:382-395` - `paths: options.paths` in the `loadPlugins` options.
- `UPDATE: packages/server/test/` - the case below.

## Steps

1. Pass the served paths.
2. Check any other caller of `loadPlugins` in `packages/server/src` for the same gap.

## Validation

- A case that runs the daemon's startup with two served paths and a fixture plugin that records `host.paths`, and expects both; today it records only the first, so it fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-28.
`run.ts` passes `paths: options.paths` to `loadPlugins`, so `host.paths` is every served path; it is the only caller of `loadPlugins` in `packages/server/src`.
`packages/server/test/daemon-backend.test.ts` adds `hands a plugin every path the daemon serves`, which runs the daemon with two paths and the new fixture `packages/server/test/fixtures/plugin-paths`, a plugin that logs `host.paths`; it failed first with only the first path logged.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 106 files, 1492 tests passed.

---
title: A plugin's agent sees every path the daemon serves - implemented
date: 2026-09-28
refs:
  - git://1d00d3f
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - `loadPlugins` is called with `paths`"
---

An agent a plugin registers lists and opens sessions in every path the daemon serves, as the built-in agents do, and not only in the first.

## What was built

- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - passes `paths: options.paths` to `loadPlugins`, its only caller in `packages/server/src`, so `host.paths` is every served path.

## Verified

- `packages/server/test/daemon-backend.test.ts`: `hands a plugin every path the daemon serves` runs the daemon with two paths and the fixture `packages/server/test/fixtures/plugin-paths`; it failed first with only the first path.
- `pnpm test` 106 files, 1492 tests; `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- none.

## Left for later

- none.

---
title: The log says when each plugin starts loading and how long it took - implemented
date: 2026-09-28
refs:
  - git://1d00d3f
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts) - `loadOne`, the loading line and the time on the end line"
---

The daemon's log shows each plugin's start before its import and its end with the time it took, so a slow plugin is visible in the log.

## What was built

- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - `loadOne` logs `plugin <name> loading` before `import()`, with the manifest's `name` or else the spec, and adds ` in <n> ms` to the end line, the import failure line and the apply failure line; plugins still load one after another.

## Verified

- `packages/server/test/plugin-load.test.ts`, four cases under `loadPlugins log`: two plugins in order, a plugin whose `apply` throws and one whose import throws; the first two failed against the old code.
- `pnpm test` 105 files, 1457 tests; `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- none.

## Left for later

- A plugin file with no `package.json` of its own logs the enclosing package's name; that is the open problem [A plugin file without its own package.json takes the enclosing package's manifest](../../../problems/a-plugin-file-without-a-manifest-takes-the-enclosing-packages.md).

---
title: Update and remove use the plugin root, and an sdk move asks for a restart
status: todo
depends: [task-11-update-answers-what-moved.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L428-L436](../../../../packages/server/src/install.ts#L428-L436) - install reads `AHPD_PLUGIN_ROOT`"
  - "[code://packages/server/src/install.ts#L484-L525](../../../../packages/server/src/install.ts#L484-L525) - `updatePlugins`, which uses only `configDir`"
  - "[code://packages/server/src/install.ts#L549-L563](../../../../packages/server/src/install.ts#L549-L563) - `removePlugins`, which uses only `configDir`"
  - "[code://packages/server/src/install.ts#L387-L399](../../../../packages/server/src/install.ts#L387-L399) - `refuseNonPlugins`, one registry call at a time"
  - "[code://packages/server/src/plugins.ts#L170-L172](../../../../packages/server/src/plugins.ts#L170-L172) - where the daemon looks for plugins"
---

## Objective

`plugin update` and `plugin remove` work in the same directory as `plugin install`: `AHPD_PLUGIN_ROOT` when it is set, else the configuration directory.
An update that moves only `@ahpd/sdk` lists it as moved, so the daemon asks for a restart.
An update with nothing from the registry says "Nothing to update."
`plugin install` asks the registry about all its names at once.

## Files

- `UPDATE: packages/server/src/install.ts` - one `pluginRoot(configDir)` gives the root; install, update and remove use it for `dependenciesIn`, `installedVersion` and `--prefix`. Messages that name the directory name the root.
- `UPDATE: packages/server/src/install.ts:511-523` - `updatePlugins` reads the `@ahpd/sdk` version before and after npm, and adds it to `moved` when it changed.
- `UPDATE: packages/server/src/install.ts:506` - the early return says "Nothing to update." first.
- `UPDATE: packages/server/src/install.ts:387-399` - `refuseNonPlugins` asks for every name with `Promise.all`.
- `UPDATE: packages/server/test/` - the plugin install tests, with the cases below.

## Steps

1. Write the tests, with `AHPD_PLUGIN_ROOT` set to a temporary directory.
2. Add `pluginRoot` and use it in install, update and remove.
3. Report the sdk move, and say "Nothing to update." on the early return.
4. Ask the registry in parallel.

## Validation

- A test: with `AHPD_PLUGIN_ROOT` set, update runs npm with `--prefix` at the root and finds the plugins installed there.
- A test: with `AHPD_PLUGIN_ROOT` set, remove runs npm with `--prefix` at the root.
- A test: an update that changes only the `@ahpd/sdk` version answers it in `moved`, and the CLI says to restart.
- A test: an update whose names all come from outside the registry says "Nothing to update."
- A test: install with three names makes three registry calls before the first answers.
- `npx vitest run packages/server` passes.

## Resume


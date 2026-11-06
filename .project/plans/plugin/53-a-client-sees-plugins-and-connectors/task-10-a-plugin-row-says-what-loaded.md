---
title: A plugin row says its version, its load and its options schema
status: done
depends: [task-04-a-client-lists-the-plugins.md]
layer: "server"
refs:
  - "[code://packages/server/src/pluginschannel.ts#L72-L125](../../../../packages/server/src/pluginschannel.ts#L72-L125) - `schemaFor` and `rowOf`, the row a client reads"
  - "[code://packages/server/src/plugins.ts#L1334-L1370](../../../../packages/server/src/plugins.ts#L1334-L1370) - `describePlugin`, which reads package.json and drops its version"
  - "[code://packages/server/src/plugins.ts#L1030-L1037](../../../../packages/server/src/plugins.ts#L1030-L1037) - where a plugin whose `apply` throws becomes one line in `problems`"
  - "[code://packages/sdk/src/types/plugin.ts#L1282-L1299](../../../../packages/sdk/src/types/plugin.ts#L1282-L1299) - `Loaded`, which only a plugin that loaded has"
---

## Objective

One read of an `x-ahpd-plugins` row is enough to show a plugin and draw its options form.
The row says which version is installed.
The row says what happened at load, so a plugin whose `apply` throws does not read as `ready`.
The row carries the options schema of a plugin that is loaded or enabled.

## Files

- `UPDATE: packages/server/src/plugins.ts:1334-1370` - `describePlugin` keeps the `version` of package.json.
- `UPDATE: packages/server/src/plugins.ts:1030-1037` - the load keeps the problem of each plugin that failed, by its id.
- `UPDATE: packages/server/src/pluginschannel.ts:72-125` - the row adds `version`, `loaded`, `loadProblem` and `optionsSchema`.
- `UPDATE: packages/server/src/commands/run.ts` - give the channel the failed plugins of the load.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - the cases below.

## Steps

1. Read `version` from package.json in `describePlugin`, and keep it on `PluginRow` when it is a string.
2. Keep each plugin that failed at load with its id and its problem.
3. Give the plugin channel these failures beside `loaded()`.
4. Add `loaded: true` to the row of a plugin that loaded.
5. Add `loaded: false` and `loadProblem` to the row of a plugin that failed at load.
6. Add `loaded: false` with no `loadProblem` to the row of a disabled plugin.
7. Mask `loadProblem` with `withoutUserinfoIn` and remove each `writeOnly` option value from it.
8. Add `optionsSchema` from `schemaFor` to the row when it is not `undefined`.
9. Do not import a disabled plugin to read its schema.
10. Run the server tests, and set this task and the plan row to `implemented`.

## Validation

- `plugins-channel.test.ts`: a row of an npm plugin has the `version` of its package.json.
- `plugins-channel.test.ts`: a plugin whose `apply` throws has `loaded: false` and a `loadProblem` that names the error.
- `plugins-channel.test.ts`: a `loadProblem` holds no `writeOnly` option value and no URL userinfo.
- `plugins-channel.test.ts`: a loaded plugin with an options schema has `loaded: true` and `optionsSchema`.
- `plugins-channel.test.ts`: a disabled plugin has `loaded: false` and no `optionsSchema`, and its module is not imported.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** the row carries `version`, `loaded`, `loadProblem` and `optionsSchema`.
  `readManifest` keeps the package `version`, and `describePlugin` puts it on `PluginRow`.
  `loadPlugins` answers `failures`: the line saying why each plugin that did not load is not running.
  The channel serves it as `loadProblem`, with URL userinfo and each `writeOnly` option value taken out.
  A disabled plugin is never imported for its schema, and its row has `loaded: false` and no `loadProblem` or `optionsSchema`.
- **Next action:** task 11.
- **Open questions:** none.
- **Departures:** two fixtures were added.
  `packages/server/test/fixtures/plugin-throws-secret` is an `apply` that quotes its own `writeOnly` option.
  `packages/server/test/fixtures/plugin-marker-off` is a package.json that names the plugin, so a listing can key its row without an import, and a module that writes `AHPD_MARKER`.
- **Watch out for:** `state` stays what the configuration and the package say; `loaded` is what the running daemon did.

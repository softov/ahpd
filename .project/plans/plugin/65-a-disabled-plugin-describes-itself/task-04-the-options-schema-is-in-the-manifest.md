---
title: The options schema is in the manifest
status: done
depends: [task-03-a-disabled-row-carries-its-manifest.md]
layer: "sdk, server, first-party plugins, docs"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L1288](../../../../packages/sdk/src/types/plugin.ts#L1288) - the `optionsSchema` export"
  - "[code://packages/server/src/plugins.ts#L696-L707](../../../../packages/server/src/plugins.ts#L696-L707) - `optionsSchemaOf`, which imports the module"
  - "[code://packages/server/src/plugins.ts#L975-L1040](../../../../packages/server/src/plugins.ts#L975-L1040) - where a load checks options against the export"
  - "[code://packages/server/src/plugins.ts#L1660-L1662](../../../../packages/server/src/plugins.ts#L1660-L1662) - `required`, which reads the `ahpd.options` flags"
  - "[code://packages/server/src/pluginschannel.ts#L150-L165](../../../../packages/server/src/pluginschannel.ts#L150-L165) - `schemaFor`, which answers nothing for a disabled plugin"
  - "[code://packages/agent-cofold/src/plugin.ts#L192](../../../../packages/agent-cofold/src/plugin.ts#L192) - code that reads its own schema"
  - "[code://packages/agent-pi/src/plugin.ts#L108](../../../../packages/agent-pi/src/plugin.ts#L108) - code that reads its own schema"
---

## Objective

A plugin's options schema is a JSON Schema in its manifest: `ahpd.optionsSchema` in package.json, and `optionsSchema` in a standalone manifest.
The daemon reads it with no import, so a disabled plugin has an Options form and its values are checked.
The module's `optionsSchema` export and the `ahpd.options` flags go.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:1288` - remove `optionsSchema` from `Plugin`, and add it to `PluginManifest`.
- `UPDATE: packages/server/src/plugins.ts:319-361` - read `ahpd.optionsSchema`, and refuse `ahpd.options` with an error that names the new key.
- `UPDATE: packages/server/src/plugins.ts:696-707` - answer the schema from the manifest, with no import.
- `UPDATE: packages/server/src/plugins.ts:975-1040` - check options against the manifest schema, and refuse a module that exports `optionsSchema`.
- `UPDATE: packages/server/src/plugins.ts:1660-1662` - take required options from the schema's `required` list.
- `UPDATE: packages/server/src/pluginschannel.ts:150-165` - answer a disabled plugin's schema from its manifest.
- `UPDATE: packages/activepieces/package.json` - move the schema from `src/plugin.ts` to `ahpd.optionsSchema`.
- `UPDATE: packages/agent-acp/package.json` - the same.
- `UPDATE: packages/agent-claude/package.json` - the same.
- `UPDATE: packages/agent-cofold/package.json` - the same.
- `UPDATE: packages/agent-pi/package.json` - the same.
- `UPDATE: packages/bot/package.json` - the same.
- `UPDATE: packages/computer/package.json` - the same.
- `UPDATE: packages/push/package.json` - the same.
- `UPDATE: packages/tasks/package.json` - the same.
- `UPDATE: packages/tunnel-devtunnel/package.json` - the same.
- `UPDATE: packages/webhook/package.json` - the same.
- `UPDATE: packages/agent-cofold/src/plugin.ts:192` - read the schema from its package.json.
- `UPDATE: packages/agent-pi/src/plugin.ts:108` - read the schema from its package.json.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - the cases below.
- `UPDATE: packages/server/test/plugin-load.test.ts` - the cases below, and fixtures that export `optionsSchema`.
- `UPDATE: docs/plugins/PLUGINS.md` - the options section and the manifest key table.

## Steps

1. Read `ahpd.optionsSchema` in `readManifest` and `optionsSchema` in a standalone manifest, and check that each is an object.
2. Refuse `ahpd.options` with an error that names `ahpd.optionsSchema`.
3. Refuse a module that exports `optionsSchema` with an error that names the manifest key.
4. Make `optionsSchemaOf` read the manifest, and remove its import.
5. Make the load check options against the manifest schema.
6. Make `required` read the schema's `required` list.
7. Make `schemaFor` answer a disabled plugin's schema from its manifest.
8. Move each first-party schema into its package.json, and remove the export from `src/plugin.ts` and `src/index.ts`.
9. Make agent-cofold and agent-pi import their package.json `with { type: 'json' }` where they read the schema.
10. Run `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- A test reads a disabled plugin's schema on the channel, and `x-ahpd/plugins/options` refuses a value the schema refuses.
- A test sets a secret option on a disabled plugin, and the row masks it.
- A test loads a package with `ahpd.options`, and the error names `ahpd.optionsSchema`.
- A test loads a module that exports `optionsSchema`, and the daemon refuses it.
- A test loads each first-party plugin from its package.json, and its schema is the one it exported before.
- `git grep -n "export const optionsSchema" -- packages` prints nothing.

## Resume

- **Done so far:** `plugin.ts` in the sdk puts `optionsSchema` on `PluginManifest` and takes it off `Plugin`. `readManifest` reads `ahpd.optionsSchema`, `standaloneOf` reads `optionsSchema`, and both checks refuse a value that is not an object. `checkManifest` refuses `ahpd.options` with an error naming `ahpd.optionsSchema`, and `loadOne` refuses a module that exports `optionsSchema` with the key to move it to. `optionsSchemaOf` answers from `locate` with no import. The load checks the options, with `defaults` merged under them, against the manifest schema through `check`, so the schema's `required` list is what the old `required` helper said; that helper is gone. `pluginschannel`'s `schemaFor` answers the loaded copy first and the manifest second, and the options handler checks a switched-off plugin too. The eleven first-party schemas moved into each `package.json` at `ahpd.optionsSchema`, and their `src/plugin.ts` and `src/index.ts` no longer export one. `agent-cofold` and `agent-pi` import their own `package.json` with `with { type: 'json' }`. The tests are `plugin-load.test.ts` (the `ahpd.options` refusal, the module-export refusal, and every first-party package loading with its schema), `plugins-channel.test.ts` (a switched-off plugin's schema and a refused value, and a secret option masked), `plugin-mask.test.ts` (the computer schema read from its package.json), and the per-package options tests, which read the schema from the manifest. `docs/plugins/PLUGINS.md` says the schema is a manifest field and gives both refusals.
- **Next action:** Review. The plan's four tasks are implemented. Task 02's two deferred validations are done too. A bare file with no manifest is refused, and the tests cover a `data:` spec with and without an inline manifest.
- **Files:** `packages/sdk/src/types/plugin.ts`, `packages/server/src/plugins.ts`, `packages/server/src/pluginschannel.ts`, `tsconfig.base.json`, the eleven packages' `package.json`, `src/plugin.ts` and `src/index.ts` (`activepieces`, `agent-acp`, `agent-claude`, `agent-cofold`, `agent-pi`, `bot`, `computer`, `push`, `tasks`, `tunnel-devtunnel`, `webhook`), `packages/agent-cofold/src/plugin.ts`, `packages/agent-pi/src/plugin.ts`, `packages/activepieces/src/plugin.ts`, `packages/computer/src/plugin.ts`, `packages/bot/src/plugin.ts`, `packages/push/src/plugin.ts`, `packages/tasks/src/plugin.ts`, `packages/tunnel-devtunnel/src/plugin.ts`, `packages/webhook/src/plugin.ts`, the per-package options tests, `packages/server/test/plugin-load.test.ts`, `packages/server/test/plugins-channel.test.ts`, `packages/server/test/plugin-mask.test.ts`, `packages/server/test/fixtures/plugin-configurable/package.json`, `packages/server/test/fixtures/plugin-configurable/index.ts`, `docs/plugins/PLUGINS.md`, this task file, the plan and the index.
- **Open questions:** none.
- **Departures:** The validation `git grep -n "export const optionsSchema" -- packages` prints one line, `packages/server/src/plugins.ts:1369`, which is the pre-existing `optionsSchemaLoaded`; a word-boundary grep for `export const optionsSchema\b` prints nothing. `pluginschannel.ts` lost its `!disabled` guard on the options handler, which task 04's Validation needs and its Files list does not name. `manifestFields` carries `optionsSchema` on the row's manifest, also beyond the list. `tsconfig.base.json` gained `resolveJsonModule` for the JSON imports. `plugin-mask.test.ts` now reads the computer schema from its package.json instead of the removed export.
- **Watch out for:** A plugin that writes `ahpd.options` is refused before the module is imported, so its author sees the new key. A row's `manifest` carries the schema, which is the same object a client draws; the channel masks values with a copy and never with the row itself.

---
title: source names the module in a config entry
status: done
depends: []
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L604-L626](../../../../packages/sdk/src/types/plugin.ts#L604-L626) - `PluginSpec`"
  - "[code://packages/server/src/config.ts#L767](../../../../packages/server/src/config.ts#L767) - `asSpec`, the one reader of a `plugins` entry"
  - "[code://packages/server/src/plugins.ts#L63](../../../../packages/server/src/plugins.ts#L63) - `nameOf`, which every caller uses for the specifier"
  - "[code://packages/server/src/install.ts#L414-L435](../../../../packages/server/src/install.ts#L414-L435) - `editEntry`, which every entry change goes through"
---

## Objective

The object form of a `plugins` entry names its module with `source`, and `name` is a display name.
An entry with `name` and no `source` still loads, and the daemon writes `source` the next time it changes the entry.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:604-626` - add `source` to the object form, and make `name` the display name.
- `UPDATE: packages/server/src/config.ts:767` - read `source`, and read `name` as the source when `source` is absent.
- `UPDATE: packages/server/src/plugins.ts:63` - rename `nameOf` to `sourceOf`, and return `source`.
- `UPDATE: packages/server/src/install.ts:414-435` - write `source` in place of an old `name`, and keep every other key.
- `UPDATE: packages/server/test/plugin-load.test.ts` - the cases below.
- `UPDATE: docs/plugins/PLUGINS.md` - say `source` wherever an entry names its module.
- `UPDATE: docs/server/PLUGINS.md` - the same.

## Steps

1. Add `source: string` to the object form of `PluginSpec`, and document `name` as the display name.
2. Make `asSpec` return `{ source }` for an object with `name` and no `source`.
3. Rename `nameOf` to `sourceOf` and change every caller.
4. Make `editEntry` write the entry with `source`, and drop an old `name` that held the source.
5. Keep a bare string as the source.
6. Run `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- A test loads `{ "name": "@acme/foo" }` and `{ "source": "@acme/foo" }`, and both load the same plugin.
- A test disables `{ "name": "@acme/foo", "options": { "a": 1 } }`, and the file then holds `{ "source": "@acme/foo", "options": { "a": 1 }, "enabled": false }`.
- A test loads `{ "source": "@acme/foo", "name": "Foo" }`, and the row's id does not change.
- `git grep -n "nameOf(" -- packages` prints nothing.

## Resume

- **Done so far:** The object form of `PluginSpec` names the module with `source`, and `name` is the display name. `asSpec` reads an entry that has `name` and no `source` as `{ source }`, and a bare string stays the source. `sourceOf` replaced `nameOf` in the loader, and every caller in `packages/server/src` uses it. `editEntry` writes `source` in place of an old `name` and keeps every other key, so turning an old entry off leaves `{ "source": ..., "options": ..., "enabled": false }`. `plugin-load.test.ts` covers the old form loading as the same plugin, a display name not changing the row id, and the rewrite; `plugin-spec.test.ts` and `config-check.test.ts` cover the reader. `docs/plugins/PLUGINS.md` and `docs/server/PLUGINS.md` say `source` wherever an entry names its module.
- **Next action:** [task-02-a-standalone-plugin-has-a-manifest.md](task-02-a-standalone-plugin-has-a-manifest.md).
- **Files:** `packages/sdk/src/types/plugin.ts`, `packages/server/src/config.ts`, `packages/server/src/plugins.ts`, `packages/server/src/install.ts`, `packages/server/src/agents/migrate.ts`, `packages/server/src/applyplugins.ts`, `packages/server/src/commands/configure.ts`, `packages/server/src/commands/options.ts`, `packages/server/src/commands/plugin.ts`, `packages/server/src/pluginschannel.ts`, `packages/server/test/plugin-load.test.ts`, `packages/server/test/plugin-spec.test.ts`, `packages/server/test/config-check.test.ts`, `docs/plugins/PLUGINS.md`, `docs/server/PLUGINS.md`, this task file, the plan and the index.
- **Open questions:** none.
- **Departures:** The validation `git grep -n "nameOf(" -- packages` prints nothing is met for the loader's function only. Unrelated local helpers named `nameOf` remain in `packages/activepieces/src/mapping.ts`, `packages/sdk/src/host/history.ts`, `packages/sdk/src/plugins/pluginparts.ts` and `packages/agent-acp/src/session/handlers.ts`, so the literal grep prints those lines.
- **Watch out for:** A client that still reads `row.spec.name` keeps working only while an old entry is unchanged. The daemon writes `source` at the entry's next change, so the two forms coexist until then.

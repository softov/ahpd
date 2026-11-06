---
title: A standalone plugin has a manifest
status: done
depends: [task-01-source-names-the-module.md]
layer: "sdk, server, docs"
refs:
  - "[code://packages/server/src/plugins.ts#L229-L250](../../../../packages/server/src/plugins.ts#L229-L250) - `resolvePlugin`, which imports a spec with a scheme as written"
  - "[code://packages/server/src/plugins.ts#L130-L140](../../../../packages/server/src/plugins.ts#L130-L140) - `nearestManifest`, which finds the package a file sits in"
  - "[code://packages/server/src/plugins.ts#L319-L361](../../../../packages/server/src/plugins.ts#L319-L361) - `readManifest`, the field checks to reuse"
  - "[code://packages/server/src/plugins.ts#L955-L970](../../../../packages/server/src/plugins.ts#L955-L970) - where a load reads the `manifest` export"
  - "[code://packages/server/src/plugins.ts#L80-L103](../../../../packages/server/src/plugins.ts#L80-L103) - the id read with no import"
  - "[code://packages/sdk/src/types/plugin.ts#L1227-L1290](../../../../packages/sdk/src/types/plugin.ts#L1227-L1290) - `PluginManifest` and the `Plugin` interface"
  - "[code://docs/plugins/PLUGINS.md#L1075-L1135](../../../../docs/plugins/PLUGINS.md#L1075-L1135) - the manifest section"
---

## Objective

A standalone plugin is a file that sits in no package with an `ahpd` field, or a spec with a scheme.
It loads only with a declarative manifest: a `plugin.json` that `source` names, or the manifest keys in its config entry.
A standalone plugin with no manifest fails with a clear error, and the module's `manifest` export goes.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:1227-1290` - add `id`, `name` and `version` to the standalone manifest type, and remove `manifest` from `Plugin`.
- `UPDATE: packages/sdk/src/types/plugin.ts:604-626` - add the manifest keys to the object form of `PluginSpec`.
- `UPDATE: packages/server/src/plugins.ts:229-250` - resolve a `source` that ends in `plugin.json` to the file its `main` names.
- `UPDATE: packages/server/src/plugins.ts:319-361` - read a standalone manifest from `plugin.json` or from the entry, with the checks `readManifest` makes.
- `UPDATE: packages/server/src/plugins.ts:955-970` - refuse a standalone plugin with no manifest, refuse a `manifest` export, and refuse a `name` export that differs from the manifest's `id`.
- `UPDATE: packages/server/src/plugins.ts:80-103` - take a standalone plugin's id from its manifest's `id`.
- `UPDATE: packages/server/test/fixtures/plugin-declared-module.ts` - move its manifest into a `plugin.json` beside it.
- `UPDATE: packages/server/test/fixtures/plugin-declared-both/index.ts` - remove the `manifest` export.
- `CREATE: packages/server/test/fixtures/plugin-standalone/plugin.json` - a standalone manifest whose `main` names `index.mjs`.
- `CREATE: packages/server/test/fixtures/plugin-standalone/index.mjs` - the module it names.
- `UPDATE: packages/server/test/plugin-load.test.ts` - the cases below, and the cases that used the `manifest` export.
- `UPDATE: docs/plugins/PLUGINS.md:1075-1135` - the two forms of a standalone manifest, and that a bare file is refused.

## Steps

1. Define the standalone manifest as the `ahpd` field keys plus `id`, `name` and `version`, and `main` in a `plugin.json`.
2. Make `resolvePlugin` read a `plugin.json` source, and resolve its `main` against the file's folder.
3. Read an inline manifest from an entry that has `id`.
4. Treat a spec as standalone when `nearestManifest` finds no package, or when the spec has a scheme.
5. Refuse a standalone plugin with neither manifest, with an error that names `plugin.json` and the inline form.
6. Refuse a module that exports `manifest`, with an error that says where the manifest goes.
7. Refuse a standalone module whose `name` export differs from the manifest's `id`, with both names in the error.
8. Take a standalone plugin's id from the manifest's `id` in `unimportedId`.
9. Run `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- A test loads `plugin-standalone/plugin.json`, and the row has the manifest's id, title, version and description.
- A test loads an inline entry `{ "id": "custom", "name": "Custom", "version": "1.0.0", "source": "./custom.mjs" }`.
- A test loads a `data:` spec with an inline manifest through Node's own import. It loads under the manifest's id.
- A test loads the same `data:` spec with no manifest, and the daemon refuses it.
- A test loads a bare `.mjs` file with no manifest, and the error names `plugin.json` and the entry.
- A test loads a bare file with a `plugin.json` beside it, and it loads under the manifest's id.
- A test names a file beside a `plugin.json` whose `main` is another, and the loader refuses it.
- A test loads a module that exports `manifest`, and the daemon refuses it.
- A test loads a standalone module whose `name` export is not its manifest's `id`, and the error holds both.

## Resume

- **Done so far:** `PluginManifest` holds `id`, `name` and `version`, and the `manifest` export is gone from `Plugin`. The object form of `PluginSpecEntry` extends `PluginManifest`, so an entry declares its manifest by declaring its `id`. `resolvePlugin` reads a source that names a `plugin.json`, resolves its `main` against the file's folder, and refuses a `main` that points outside it. `readStandalone` and `standaloneOf` read the file and the inline entry with one shape, and `checkStandalone` holds both to the same field checks. `locate` reads the standalone manifest first, then a package's, then an inline entry's. `namePlugin` takes a standalone plugin's id from the manifest, not from the module, and `loadOne` refuses a module whose `name` export differs, holding both names. A module that exports `manifest` is refused with the place to write it. `describePlugin` reads the same manifests with no import. A standalone plugin that declares no manifest is refused: `locate` answers the refusal before any import, and `describePlugin` reports the same line as `error`. `resolvePlugin` also reads a `plugin.json` beside a file the spec names, and refuses one whose `main` names another file rather than loading that one. Every fixture and test spec that loaded bare now has a `plugin.json` or an inline `id`. A `data:` spec is tested through Node's own import: one with an inline manifest loads under its id, and one without is refused.
- **Next action:** Review. The plan's four tasks are implemented, and the bare-file refusal and the scheme-spec tests this task deferred are done.
- **Files:** `packages/sdk/src/types/plugin.ts`, `packages/server/src/plugins.ts`, `packages/server/test/fixtures/plugin.json`, `packages/server/test/fixtures/plugin-declared-module.ts`, `packages/server/test/fixtures/plugin-declared-both/index.ts`, `packages/server/test/fixtures/plugin-standalone/plugin.json`, `packages/server/test/fixtures/plugin-standalone/index.mjs`, the `plugin.json` beside each bare fixture (`plugin-broken`, `plugin-throws`, `plugin-skips`, `plugin-push`, `plugin-yaml`, `plugin-late-problem`, `plugin-notes`, `plugin-notes-again`, `plugin-parser`, `plugin-parser-replace`, `plugin-unchecked`, `plugin-kept`, `plugin-env`, `plugin-slow-stop`), `packages/server/test/fixtures/plugin-multiline/{plugin.json,index.ts}`, `packages/server/test/plugin-load.test.ts`, `packages/server/test/plugin-list.test.ts`, `packages/server/test/plugins-channel.test.ts`, `packages/server/test/plugin-live.test.ts`, `packages/server/test/cli.ts`, `docs/plugins/PLUGINS.md`, `README.md`, this task file, the plan and the index.
- **Open questions:** none.
- **Departures:** The scheme cases use a `data:` spec, as review directed, rather than `https:` with a fake fetch. `resolvePlugin` reads a beside-file `plugin.json` only when its `main` names the file the spec named. The plan did not say; substituting another module would be worse than a refusal. The `plugin-multiline` fixture moved from `fixtures/plugin-multiline.ts` into its own folder to carry a `plugin.json`, since the `plugin.json` at the fixtures root belongs to `plugin-declared-module.ts`. The README's two single-file examples now say a `plugin.json` is needed beside the file.
- **Watch out for:** A standalone module's `name` export is only a check against the manifest id, never the id itself. A `plugin.json` in a folder is read for a bare file beside it, so a folder holding several modules needs one folder each.

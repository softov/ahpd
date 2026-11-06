---
title: An admin writes a plugin in the UI
status: done
depends: [task-02-the-channel-installs-and-removes.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/pluginschannel.ts#L368-L419](../../../../packages/server/src/pluginschannel.ts#L368-L419) - the commands that task 02 adds to"
  - "[code://packages/server/src/plugins.ts#L233-L248](../../../../packages/server/src/plugins.ts#L233-L248) - a path in the `plugins` list loads as written"
  - "[code://packages/server/src/install.ts#L622-L657](../../../../packages/server/src/install.ts#L622-L657) - `pluginRoot`, and the sdk that every install puts there"
---

## Objective

`x-ahpd/plugins/write` takes `{ id, source, packageJson }`, and `x-ahpd/plugins/source` takes `{ id }`.
Both need `plugin:install`.
A write keeps the plugin in `<plugin root>/plugins/<id>/`, as `index.ts` and `package.json`, and runs `npm install` there.
The `plugins` list names that folder, and a second write with the same `id` replaces the files and reloads the plugin.

## Files

- `UPDATE: packages/server/src/pluginschannel.ts` - add `write` and `source`, and delete the folder of a written plugin on `remove`, unless `keep`.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - the cases below.
- `UPDATE: docs/plugins/PLUGINS.md` - a plugin written in a client, its folder, and the two commands.

## Steps

1. Refuse an `id` that is not a slug.
2. Refuse a `packageJson` that is not a JSON object.
3. Write `index.ts` and `package.json` into `<plugin root>/plugins/<id>/`.
4. Run `npm install` in that folder.
5. Add the folder path to the `plugins` list when it is not there.
6. Call `applyPlugins` for a new plugin, and reload the plugin for a write over one that exists.
7. Answer `source` with the text of `index.ts` and `package.json`.
8. Refuse `source` for a plugin that was not written in a client.
9. Delete the folder on `remove`, unless `keep` is true.
10. Run the gate, then restore `packages/sdk/test/fixtures/wire.jsonl`.

## Validation

- A test writes a plugin that imports `@ahpd/sdk`, and the plugins channel lists it as loaded.
- A test writes the same `id` again with new text, and the plugin runs the new text.
- A test reads the text back with `source` as a second admin.
- A test refuses `write` and `source` for a `member`.
- A test removes a written plugin, and its folder is gone.
- A test shows that the folder is not under `node_modules`.
- The gate passes.

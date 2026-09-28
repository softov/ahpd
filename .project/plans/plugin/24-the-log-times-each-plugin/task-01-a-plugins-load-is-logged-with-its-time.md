---
title: A plugin's load is logged with its time
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/plugins.ts#L339-L445](../../../../packages/server/src/plugins.ts#L339-L445) - `loadOne` and its one log line at the end"
  - "[code://packages/server/src/plugins.ts#L491-L535](../../../../packages/server/src/plugins.ts#L491-L535) - `loadPlugins`"
---

## Objective

For every plugin spec, the log has `plugin <name> loading` before its import and `plugin <name> from <path> in <n> ms` after `apply`, and a plugin that fails says how long it took in its problem line.

## Files

- `UPDATE: packages/server/src/plugins.ts:339-445` - `loadOne` logs the start once the provisional name is known, and times the load to the end line and to each problem line after the import.
- `UPDATE: packages/server/test/` - the cases below.

## Steps

1. Log `plugin <provisional name> loading` right before `import()`.
2. Measure from that line to the end of `apply`, and add ` in <n> ms` to the existing end line and to the import and apply failure lines.
3. Keep the order and the one-at-a-time loading.

## Validation

- A case with two plugins on disk: the log holds, in order, the first plugin's start, its timed end, the second's start and its timed end; today there is no start line, so it fails first.
- A case: a plugin whose `apply` throws logs a start and a problem line with its time.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

- `loadOne` logs `plugin <provisional name> loading` right before `import()`, where the provisional name is the manifest's `name` or else the spec.
- The time is measured from that line with `Date.now()`, and ` in <n> ms` is added to the end line `plugin <name> from <path>`, to the import failure line after its path, and to the apply failure line after `failed`, so each keeps its message after the colon.
- Plugins still load one after another in `loadPlugins`, which did not change.
- Four cases in `packages/server/test/plugin-load.test.ts` under `loadPlugins log`: two plugins in order (`plugin-hello`, `plugin-alike`), a plugin whose `apply` throws (`plugin-configurable`), and a plugin whose import throws (`plugin-explodes`).
- The two-plugin case failed first against the old code with `AssertionError: expected [ …(2) ] to have a length of 4 but got 2`, and the apply case with `AssertionError: expected [] to deeply equal [ Array(1) ]`.
- A fixture with no `package.json` of its own, such as `plugin-throws/index.ts`, logs its start as `plugin @ahpd/server loading`, because the manifest walk reaches the server's package; the tests use fixtures that carry their own manifest.
- No existing test matched the old end line, so none needed updating.
- Gates: `pnpm typecheck` green, `pnpm boundary` green, `pnpm test` 105 files and 1457 tests passed.

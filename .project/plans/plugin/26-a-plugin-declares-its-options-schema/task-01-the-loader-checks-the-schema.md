---
title: The loader checks a plugin's declared options schema
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L210-L230](../../../../packages/sdk/src/types/plugin.ts#L210-L230) - `Plugin` gains `optionsSchema`"
  - "[code://packages/server/src/plugins.ts#L408-L434](../../../../packages/server/src/plugins.ts#L408-L434) - where the values are merged and `apply` is called"
---

## Objective

A plugin module may export `optionsSchema`, a JSON Schema object. The loader checks the merged options against it before `apply`; a failure is a reported problem naming the plugin, the key and what was expected, and the plugin is skipped. An option key the schema does not name is warned about and passed through.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:210-230` - `optionsSchema?: Record<string, unknown>` on `Plugin`, documented as JSON Schema for the options `apply` receives.
- `UPDATE: packages/server/src/plugins.ts:408-434` - read and check `optionsSchema` with `check` from `@cofold/commands`.
- `UPDATE: docs/PLUGINS.md` - the export, with an example.

## Steps

1. Tests first with fixture plugins: one with a schema, one without.
2. Check after `defaults` are merged, so a default satisfies a required key.

## Validation

- `packages/server/test/plugin-options.test.ts`: a wrong type reported and skipped with the others loaded; a missing required key reported; an unknown key warned and passed; a plugin with no schema loaded unchecked.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Changed:** `Plugin.optionsSchema?: Record<string, unknown>` in [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts), documented as the JSON Schema for the options `apply` receives; the SDK imports nothing new. [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) `loadOne` reads `optionsSchema` from the module after the import and shape check, checks `defaults` merged under the spec's options with `check(values, schema, 'plugins.<name>.options')`, and on failure returns the problem `plugin <name> skipped: plugins.<name>.options.<key> must be ...` without calling `apply`. A key the spec's options name that the schema's `properties` do not is the problem line `plugin <name>: plugins.<name>.options.<key> is not an option <name> knows; passed through`, and the plugin still loads with it. An `optionsSchema` that is not an object is `plugin <name> skipped: its optionsSchema is not an object`. The loaded `Plugin` carries the schema.
- **Only configured keys are warned about:** a key that comes only from the plugin's `defaults` is the plugin's own, so it is not warned about. `@ahpd/computer` keeps `disposableDelay` and `host` in `defaults` as constants, which is how this surfaced.
- **Tests:** [`code://packages/server/test/plugin-options.test.ts`](../../../../packages/server/test/plugin-options.test.ts), 8 cases over two new fixtures, `plugin-schema` (required `command` with no default, required `greeting` with one, bounded `retries`, a default `internal` the schema does not name) and `plugin-unchecked` (no schema): options that pass reach `apply` with defaults under them; a wrong type is reported and skipped with `plugin-hello` still loaded; a bound; a missing required key; a default not warned about; a default satisfying `required`; an unknown key warned and passed; no schema loaded unchecked.
- **Failed first, for the right reason:** before the loader change the wrong type, the bound, the missing key and the unknown key each loaded with `problems` `[]`. The default-not-warned case was added after the computer suite showed the warning on defaults: it failed with the `internal` warning, as did the three cases whose fixture gained `internal`, and passed once the warning read only the spec's own keys. The pass, default-satisfies-required and no-schema cases guard behaviour that already held.
- **Docs:** [`docs/PLUGINS.md`](../../../../docs/PLUGINS.md) gains `optionsSchema` in the contract block, a `### Declaring the options` section with an example and both sentences, the failure bullet, and the `ahpd.options` manifest row now says a load uses `optionsSchema`. The main tree's uncommitted ACP edit in the same file still applies over this (`git apply --check` clean).
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared); full `pnpm test` 117 files, 1691 tests passed. The first full run had one failure, `packages/sdk/test/changes-refresh.test.ts > re-reads a changeset when git is changed outside the host`, which passed 3 of 3 alone and on the second full run.

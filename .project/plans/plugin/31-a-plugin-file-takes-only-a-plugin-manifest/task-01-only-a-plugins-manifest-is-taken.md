---
title: Only a plugin's manifest is taken
status: implemented
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/plugins.ts#L68-L78](../../../../packages/server/src/plugins.ts#L68-L78) - `nearestManifest`"
---

## Objective

`nearestManifest` answers the nearest directory whose `package.json` has an `ahpd` field, stopping at the first `package.json` it meets; a file spec without one is named by its module's `name` or its file name, in the load and in the listing.

## Files

- `UPDATE: packages/server/src/plugins.ts` - `nearestManifest` and the name of a file spec with no manifest.
- `UPDATE:` the plugin load and listing tests.

## Steps

1. Tests first: `plugin-throws/index.ts` is named `plugin-throws` or its `name` export, and has no `sdkRange` check; a file under `packages/agent-claude/src` takes `@ahpd/agent-claude`'s manifest.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- `nearestManifest` in `packages/server/src/plugins.ts` takes the nearest `package.json` above a file spec only when it has an `ahpd` field; the plain walk it was is now `enclosingPackage`, which `resolvePlugin` keeps for a bare name resolved through the configuration directory, since an installed package is its own manifest with or without an `ahpd` field.
- A file spec with no manifest is named by `fileNameOf`: the file's name without its extension, or its directory's for an `index` file, so `plugin-throws/index.ts` is `plugin-throws`. The load uses it for the line before the import and then takes the module's `name` export when there is one; the listing, which imports nothing, names the row with it.
- Tests: `plugin-load.test.ts` "is named by its name export, and never by the package it sits in" (`plugin-throws` logs `plugin plugin-throws loading` and fails as `throws`) and "is checked against no other package's range, and named by its file when it exports no name" (a file under a `package.json` with a `^99.0.0` peer range and no `ahpd` field loads as `loose`); `plugin-list.test.ts` "lists a file whose nearest package.json is not a plugin's by its file name, unchecked by that package", "names a fixture file by its directory, not by the server package above it" and "takes a plugin package's manifest for a file inside it" (`packages/agent-claude/src/index.ts` is `@ahpd/agent-claude`, `Claude`).
- Failed first: all but the agent-claude case, which held before and after. The existing case "lists a single file with no manifest above it as (no manifest)" now expects the file name, `loose`, since the objective names a file spec in the listing too; the `(no manifest)` label is left for a spec with no path, such as one with a scheme.
- Failed after the first change: `plugin-resolve.test.ts` "resolves a bare name through the configuration directory", because `resolvePlugin` used the same walk for an installed package with no `ahpd` field; that is why the plain walk stayed as `enclosingPackage`.
- Not known to the plan: what "its file name" is for `index.ts`; the task's own example, `plugin-throws`, decided it as the directory's name.

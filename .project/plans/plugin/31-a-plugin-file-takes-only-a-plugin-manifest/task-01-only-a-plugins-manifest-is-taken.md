---
title: Only a plugin's manifest is taken
status: todo
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

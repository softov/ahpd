---
title: The sdk carries icons
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L1204](../../../../packages/sdk/src/types/plugin.ts#L1204) - `PluginManifest` gets `icons`"
  - "[code://packages/sdk/src/types/connectors.ts#L103](../../../../packages/sdk/src/types/connectors.ts#L103) - `Adapter` gets `icons`"
  - "[code://packages/sdk/src/plugins/validate.ts#L580](../../../../packages/sdk/src/plugins/validate.ts#L580) - `checkAdapter` checks the icon shape"
  - "[code://packages/sdk/src/connectors/adapters.ts#L51-L58](../../../../packages/sdk/src/connectors/adapters.ts#L51-L58) - `rowOf` sends the icons"
---

## Objective

`PluginManifest` and `Adapter` have `icons?: Icon[]`, with the `Icon` type of AHP.
`checkAdapter` refuses an icon of the wrong shape, and the adapters channel row sends the icons.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:1204` - add `icons?: Icon[]` to `PluginManifest`, with a comment that a path is relative to the package.
- `UPDATE: packages/sdk/src/types/connectors.ts:103` - add `icons?: Icon[]` to `Adapter`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:580` - check `icons` in `checkAdapter`.
- `UPDATE: packages/sdk/src/connectors/adapters.ts:51-58` - add `icons` to `rowOf` when the adapter has them.
- `UPDATE: packages/sdk/test/` - cases for the shape check and the row.

## Steps

1. Import the type `Icon` from `@microsoft/agent-host-protocol` in both type files.
2. Add `icons?: Icon[]` to `PluginManifest` and to `Adapter`.
3. Write `checkIcons(value, by)`, which accepts an array of objects with a string `src`.
4. Make `checkIcons` accept an optional string `contentType`, a string array `sizes`, and a `theme` of `light` or `dark`.
5. Call `checkIcons` from `checkAdapter`, and export it so the server checks a manifest with it.
6. Add `icons` to `rowOf` only when the adapter has at least one icon.
7. Add tests for a good icon, a missing `src`, a wrong `theme`, and a row with icons and without them.

## Validation

- `npm test -w packages/sdk` passes, with the new cases.
- `npm run typecheck` passes.

## Resume

- **Done so far:** `PluginManifest` in `packages/sdk/src/types/plugin.ts` and `Adapter` in `packages/sdk/src/types/connectors.ts` both carry `icons?: Icon[]`, with `Icon` imported from `@microsoft/agent-host-protocol` and no second type written. `checkIcons(value, by)` is exported from `packages/sdk/src/plugins/validate.ts`: it accepts a list of objects with a string `src`, an optional string `contentType`, a string list `sizes`, and a `theme` of `light` or `dark`. `checkAdapter` calls it after the `open` check. `rowOf` in `packages/sdk/src/connectors/adapters.ts` adds `icons` only when the adapter has at least one. The sdk index re-exports `checkIcons` and the `Icon` type, so the server and the Activepieces plugin use the same type without a new dependency. `packages/sdk/test/adapters-channel.test.ts` has five new cases. The row sends an adapter's icons and leaves the key out where there are none, an icon of the AHP shape is accepted, and a missing `src`, a wrong `theme` and a non-list `icons` are refused. Ten tests pass in that file.
- **Next action:** none; task 02 builds on this.
- **Files:** `packages/sdk/src/types/plugin.ts`, `packages/sdk/src/types/connectors.ts`, `packages/sdk/src/plugins/validate.ts`, `packages/sdk/src/connectors/adapters.ts`, `packages/sdk/src/index.ts`, `packages/sdk/test/adapters-channel.test.ts`, this task file.
- **Open questions:** none.
- **Departures:** `packages/sdk/src/index.ts` gained the `checkIcons` export and an `Icon` type re-export, which the task did not name. The server needs both to check a manifest with the same function and to use the same type.
- **Watch out for:** an `icons` list that is empty leaves the key off the row, so a client never sees `icons: []`.


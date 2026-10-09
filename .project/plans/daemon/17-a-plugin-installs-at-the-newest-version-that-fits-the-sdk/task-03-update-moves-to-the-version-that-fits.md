---
title: Update moves every plugin to the version that fits
status: done
depends: [task-01-the-version-that-fits-is-chosen.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L508-L540](../../../../packages/server/src/install.ts#L508-L540) - `updatePlugins` and its `targets`"
  - "[code://packages/server/src/commands/plugin.ts#L145](../../../../packages/server/src/commands/plugin.ts#L145) - `plugin update`'s description"
---

## Objective

`ahpd plugin update` moves each registry plugin to the version `fittingVersion` chooses, `@ahpd/*` or not, in one npm call or one per package with `--force`.

## Files

- `UPDATE: packages/server/src/install.ts:534-538` - `targets` from `fittingVersion`, not `pinned` or `@latest`.
- `UPDATE: packages/server/src/commands/plugin.ts:145` - the description says the version that fits the daemon's sdk.
- `UPDATE: packages/server/test/plugin-install.test.ts` - update cases.

## Steps

1. Choose each moving package's target with `fittingVersion`, all at once.
2. Fall back to `<name>@latest` when `fittingVersion` answers `undefined`.
3. Keep a name with a version or a tag as written.
4. Without `--force`, let a refusal end the update before npm runs.
5. With `--force`, say the refusal, leave that package as it is, and move the others.
6. Change the description at `commands/plugin.ts:145` to name the version that fits.
7. Update the test at `plugin-install.test.ts:281` and add the cases below.

## Validation

- `plugin-install.test.ts`: `update all` moves `@ahpd/web` to `0.1.0` and `left-pad` to its fitting version.
- `plugin-install.test.ts`: a package with no fit stops the update before npm runs.
- `plugin-install.test.ts`: with `--force`, the update says that package, leaves it, and moves the others.
- `npx vitest run packages/server/test/plugin-install.test.ts` passes.

## Resume

Built. `updatePlugins` plans every moving package at once with `fittingVersion` (from step 2 that is `<name>@<version>`, or `<name>@latest` when it answered `undefined`); a name carrying a version or a tag is kept as written; a package with no fit throws the refusal before npm runs, and with `--force` the refusal is said, that package is left where it is and the others move. `UpdateOptions` takes the `fetch` the registry is asked with, and the command passes the global one. `plugin update`'s summary and description now say the version that fits this daemon. Two existing update cases were corrected to the chosen versions and five added: the newest that fits, the newer one a plugin published on its own, no fit stopping the update, `--force` moving the others, and `latest` when the registry cannot say.


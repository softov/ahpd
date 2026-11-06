---
title: The host sends a package icon as data
status: done
depends: [task-01-the-sdk-carries-icons.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/plugins.ts#L314](../../../../packages/server/src/plugins.ts#L314) - `readManifest` reads `ahpd.icons`"
  - "[code://packages/server/src/plugins.ts#L385-L386](../../../../packages/server/src/plugins.ts#L385-L386) - `checkFields` gets `icons`"
  - "[code://packages/server/src/plugins.ts#L168-L195](../../../../packages/server/src/plugins.ts#L168-L195) - the pattern for a path outside the package"
  - "[code://packages/server/src/plugins.ts#L37-L58](../../../../packages/server/src/plugins.ts#L37-L58) - `Resolved`, which holds `packageDir`"
  - "[code://docs/plugins/PLUGINS.md#L985](../../../../docs/plugins/PLUGINS.md#L985) - the manifest docs"
---

## Objective

A manifest icon and an adapter icon with a relative `src` reach a client as a `data:` URI.
A bad icon is dropped with a problem line, and the plugin still loads.

## Files

- `CREATE: packages/server/src/icons.ts` - `resolveIcons(icons, base, by)`, which reads, checks and encodes each icon.
- `UPDATE: packages/server/src/plugins.ts:314` - read `ahpd.icons` in `readManifest`, and resolve it against the package.
- `UPDATE: packages/server/src/plugins.ts:385-386` - add `icons` to the fields that `checkFields` checks.
- `UPDATE: packages/server/src/plugins.ts` - resolve the icons of each adapter that a plugin registers, against that plugin's package.
- `CREATE: packages/server/test/plugin-icons.test.ts` - the cases below.
- `UPDATE: docs/plugins/PLUGINS.md:985` - document `ahpd.icons` and `Adapter.icons`, the limit, and that a client draws an icon as an image.
- `UPDATE: CHANGELOG.md` - one line under the next release.

## Steps

1. Write `resolveIcons` in `icons.ts`, and give it the base folder and a function for problem lines.
2. Pass an `https:` URL through as it is.
3. Pass a `data:` URI through when it is at most 32 KB, and drop a larger one.
4. Resolve any other `src` against the base folder, and drop it when the real path is outside that folder.
5. Drop the icon when the file is missing or is larger than 32 KB.
6. Take `contentType` from the manifest, or else from the extension: `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`.
7. Drop the icon when it has no `contentType` and its extension is not in that list.
8. Encode the file as `data:<contentType>;base64,<bytes>`, and keep `theme` and `sizes`.
9. Set `sizes` to `["any"]` for an SVG that has no `sizes`.
10. Call `resolveIcons` for `ahpd.icons` in `readManifest`, with `packageDir` as the base.
11. Use the file's folder as the base for a single-file plugin with no package.
12. Call `resolveIcons` for `Adapter.icons` when the loader collects the plugin's adapters, with the same base.
13. Add `icons` to `checkFields`, and check its shape with `checkIcons` from the sdk.
14. Write the docs section and the changelog line.

## Validation

- `plugin-icons.test.ts` has good cases: a relative SVG, a relative PNG, an `https:` URL and a small `data:` URI.
- It has bad cases: a large `data:` URI, a path outside the package, a missing file and a large file.
- It has cases for an unknown extension, an adapter icon and a single-file plugin.
- Each bad case gives one problem line, and the plugin still loads.
- `npm test -w packages/server` passes.
- `npm run typecheck` passes.

## Resume

- **Done so far:** `packages/server/src/icons.ts` is new. `resolveIcons(icons, base, by, problem)` passes an `https:` source through, passes a `data:` URI of at most 32 KB through and drops a larger one, and reads any other `src` against `base`. It refuses a path that resolves outside the base with the same containment test the entries use, and then compares the real path of the file with the real path of the base, so a symlink inside the package that points outside it is refused too; a path whose real path cannot be read is dropped. A missing file, a file over `ICON_LIMIT` (32 KB) and an unknown extension with no `contentType` are each dropped with a `${by}: the icon <src> ...` line. The content type comes from `contentType` or from `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`; the file is encoded as `data:<contentType>;base64,...`; `theme` and `sizes` are kept, and an SVG with no `sizes` gets `["any"]`. `readManifest` resolves `ahpd.icons` against the package folder and keeps the problem lines on `Manifest.iconProblems`, which `loadOne` adds to `problems`, so the plugin still loads. `checkField` gained an `icons` branch that calls `checkIcons` from the sdk and turns a refusal into one problem line, and `checkFields` now checks `icons` too; `manifestFields` lists it. In `loadOne`, the loader resolves the icons of a module manifest and then the icons of each adapter it collects, against `resolved.packageDir`, or the folder of the file for a single-file plugin. An adapter whose icons all drop loses the key. `packages/server/test/plugin-icons.test.ts` is new, with fourteen cases in temporary packages. They cover a relative SVG, a relative PNG, an `https:` URL, a small `data:` URI, a large `data:` URI, a path outside the package, a symlink inside the package that points outside it, a missing file, a large file, an unknown extension, a bad manifest shape, a good adapter icon, a bad adapter icon and a single-file plugin. Fourteen tests pass.
- **Next action:** none; task 03 builds on this.
- **Files:** `packages/server/src/icons.ts`, `packages/server/src/plugins.ts`, `packages/server/test/plugin-icons.test.ts`, `docs/plugins/PLUGINS.md`, this task file.
- **Open questions:** none.
- **Departures:** `CHANGELOG.md` is left alone, as asked. The docs say a client draws an icon as an image, so the SVGs that a plugin ships run no script.
- **Watch out for:** the adapter icons are resolved after `apply` returns, from the adapters the plugin registered during it, so the base folder is the plugin's package and not the daemon's working folder. An `https:` or `data:` source passes through untouched, so an adapter that sets one keeps it whether or not a file read happened.


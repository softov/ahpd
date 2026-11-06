---
title: The host fetches an https icon and sends it as data
status: done
depends: [task-02-the-host-sends-a-package-icon.md]
layer: "server"
refs:
  - "[code://packages/server/src/icons.ts#L60-L73](../../../../packages/server/src/icons.ts#L60-L73) - `resolveIcons`, which passes an `https:` source through unchanged"
  - "[code://packages/server/src/plugins.ts#L358](../../../../packages/server/src/plugins.ts#L358) - the package manifest's icons, resolved in `readManifest`"
  - "[code://packages/server/src/plugins.ts#L954](../../../../packages/server/src/plugins.ts#L954) - a module manifest's icons, resolved in `loadOne`"
  - "[code://packages/server/src/plugins.ts#L1113](../../../../packages/server/src/plugins.ts#L1113) - an adapter's icons, resolved when the plugin registers it"
  - "[code://packages/activepieces/src/logos.ts](../../../../packages/activepieces/src/logos.ts) - the pattern: a fetch with a timeout, a 32 KB limit and an `image/` type check"
---

## Objective

A client never gets an `https:` icon from the host.
The host fetches each `https:` icon of a manifest or an adapter when the plugin loads.
It sends the icon as a `data:` URI, under the rules of a file.

## Files

- `UPDATE: packages/server/src/icons.ts:60-73` - keep an `https:` source for a fetch, and add `fetchIcons`, which turns each one into a `data:` URI.
- `UPDATE: packages/server/src/plugins.ts` - await `fetchIcons` in `loadOne` on the manifest's icons and on each adapter's icons, before the plugin's contributions return.
- `UPDATE: packages/server/test/plugin-icons.test.ts` - cases for a fetched icon, a failed fetch, a large body and a type that is not an image.
- `UPDATE: docs/plugins/PLUGINS.md` - say that the host fetches an `https:` icon at load and that a client never contacts that server.

## Steps

1. Change the `https:` branch of `resolveIcons` so it keeps the source for `fetchIcons`.
2. Write `fetchIcons(icons, by, problem, fetcher)`, with `fetcher` defaulting to the global `fetch`.
3. Fetch each `https:` source with `AbortSignal.timeout(5_000)`, all of them in parallel.
4. Keep the `contentType` from the manifest when it gives one, else take the response's `image/` type.
5. Drop the icon with one problem line when the fetch fails or the type is not `image/`.
6. Drop the icon with one problem line when the body is over `ICON_LIMIT`.
7. Encode a kept body as `data:<contentType>;base64,...`, and keep `theme` and `sizes`.
8. Give an SVG with no `sizes` the value `["any"]`, as a file gets.
9. Call `fetchIcons` in `loadOne` on the manifest's icons before the manifest goes on the loaded entry.
10. Call `fetchIcons` in `loadOne` on each collected adapter's icons before the contributions return.
11. Remove the key from an adapter whose icons all drop, as for a file.
12. Add the test cases with an injected fake fetch, so no test reaches the network.
13. Update the Icons section of `docs/plugins/PLUGINS.md`.

## Validation

- `packages/server/test/plugin-icons.test.ts` passes, with a fetched SVG, a fetched PNG and a non-ok response.
- The same file passes with a throw, a body over 32 KB and a `text/html` answer.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- By hand: a plugin with an `https:` icon shows a `data:` icon in the plugins channel row.

## Resume

- **Done so far:** `fetchIcons(icons, by, problem, fetcher)` in `packages/server/src/icons.ts` fetches every `https:` source in parallel, with `AbortSignal.timeout(5_000)`, and turns each body into a `data:` URI. A `contentType` the manifest gives wins over the response's. The host drops a body over 32 KB, and it drops a type that is not `image/`, each with one line. `resolveIcons` keeps an `https:` source for it. `loadOne` awaits it on the manifest's icons and on each adapter's icons. That happens before the manifest and the contributions return. An adapter key whose icons all drop is removed. `fetchIcons` and the fetcher are injected through `LoadOneOptions.fetcher` and `LoadOptions.fetcher`, so no test reaches the network. `packages/server/test/plugin-icons.test.ts` has eight new cases, and `docs/plugins/PLUGINS.md` says the host fetches at load.
- **Next action:** none; task 05 uses the same loader path.
- **Files:** `packages/server/src/icons.ts`, `packages/server/src/plugins.ts`, `packages/server/test/plugin-icons.test.ts`, `docs/plugins/PLUGINS.md`, this task file.
- **Open questions:** none.
- **Departures:** the `data:` body of one file and of one fetched body are built by one `drawn` helper, which the task did not name. A manifest whose fetched icons all drop keeps `icons: []`, as a manifest whose files all drop does. `base` in `loadOne` now falls back to the nearest package of a file spec. So an adapter icon resolves against the package when a spec names its entry file. Task 05 needed that for the webhook adapter.
- **Watch out for:** every load fetches again, and a reload is a load. There is no cache for a manifest or adapter icon, unlike an Activepieces logo.

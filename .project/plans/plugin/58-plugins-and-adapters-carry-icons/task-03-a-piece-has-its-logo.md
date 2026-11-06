---
title: An Activepieces piece has its logo
status: done
depends: [task-02-the-host-sends-a-package-icon.md]
layer: "activepieces"
refs:
  - "[code://packages/activepieces/src/plugin.ts#L196-L213](../../../../packages/activepieces/src/plugin.ts#L196-L213) - `apply`, where each piece becomes an adapter"
  - "[code://packages/activepieces/src/mapping.ts#L219-L226](../../../../packages/activepieces/src/mapping.ts#L219-L226) - `adapterOf`, which gets the icon"
  - "[code://packages/activepieces/src/child.ts](../../../../packages/activepieces/src/child.ts) - the child that describes each piece, and must also send its `logoUrl`"
---

## Objective

Each adapter of an Activepieces piece has the piece's logo as a `data:` icon.
The logo is fetched once and cached on disk, and a failure means no icon.

## Files

- `UPDATE: packages/activepieces/src/child.ts` - send the piece's `logoUrl` with its description.
- `CREATE: packages/activepieces/src/logos.ts` - `logoOf(piece, url, dir)`, which reads the cache or fetches the logo once.
- `UPDATE: packages/activepieces/src/plugin.ts:196-213` - get the logo of each piece before it registers the adapter.
- `UPDATE: packages/activepieces/src/mapping.ts:219-226` - put the icon on the adapter when there is one.
- `UPDATE: packages/activepieces/test/` - cases for the cache, a failed fetch and a large logo.
- `UPDATE: docs/plugins/activepieces.md` - say that each piece shows its logo, and that the logos are the brands' marks.

## Steps

1. Add `logoUrl` to the description that the child sends for each piece.
2. Write `logoOf`, which reads `<configDir>/activepieces/icons/<piece>.png` when the file exists.
3. Fetch the `logoUrl` with a timeout of 5 seconds when there is no cached file.
4. Write the logo to the cache only when the fetch succeeds and the body is at most 32 KB.
5. Answer no icon, with one problem line, when the fetch fails or the body is too large.
6. Take `contentType` from the response header, and fall back to `image/png`.
7. Fetch the logos of all pieces in parallel, so one slow logo does not hold the others.
8. Give `adapterOf` the icon as `{ src: "data:...", contentType }`.
9. Add tests with a fake `fetch` for a cache hit, a failed fetch and a large body.

## Validation

- `npm test -w packages/activepieces` passes, with the new cases.
- With the config-dev pieces, the adapters channel rows have icons, and a second start makes no logo fetch.

## Resume

- **Done so far:** `PieceDescription` in `packages/activepieces/src/wire.ts` has `logoUrl?: string`, and `describePiece` in `packages/activepieces/src/child.ts` sends it when the piece has one. `packages/activepieces/src/logos.ts` is new. `logoOf(piece, url, dir, fetcher)` looks for a cached file named `<piece>.<extension>` in `<dir>/activepieces/icons` and answers it with no fetch, reading the type back from the extension (`svg` is `image/svg+xml`, `jpg` is `image/jpeg`, `ico` is `image/x-icon`, and any other extension is `image/<extension>`). With no cache, it fetches the URL with `AbortSignal.timeout(5_000)`. It answers no icon and one problem line when the response is not ok, the fetch throws, or the body is over `LOGO_LIMIT` (32 KB), and otherwise writes the body to the cache and answers it as an icon. The content type is taken from the response header only when it is an `image/` type; anything else, a `text/html` answer included, is kept as `image/png`. The cache file is named after that type, so `.png`, `.svg` and `.webp` hold their own kind. A call with no URL or no `dir` answers `{}` and makes no fetch. `mapping.ts` takes the icon as a third argument and sets `icons: [icon]` only when there is one. `plugin.ts` fetches the logos of all pieces in parallel with `Promise.all`, reports each problem as `${name}: ${problem}`, and passes the icon to `adapterOf`. Tests: `logos.test.ts` is new with nine cases, each with an injected fake fetch (a cache hit, a fetch then a cache read under `.svg`, a cached SVG read back as `image/svg+xml`, a `text/html` answer kept as `image/png`, a non-ok response, a throw, a large body, no cache folder and no URL). `mapping.test.ts` has two new cases, an adapter with an icon and one with the key left off. `child.test.ts` expects `logoUrl` on the described piece. `docs/plugins/activepieces.md` has a new section, Each piece shows its logo.
- **Next action:** none; the plan's final verification checklist is next.
- **Files:** `packages/activepieces/src/wire.ts`, `packages/activepieces/src/child.ts`, `packages/activepieces/src/logos.ts`, `packages/activepieces/src/mapping.ts`, `packages/activepieces/src/plugin.ts`, `packages/activepieces/test/logos.test.ts`, `packages/activepieces/test/mapping.test.ts`, `packages/activepieces/test/child.test.ts`, `docs/plugins/activepieces.md`, this task file.
- **Open questions:** `docs/plugins/activepieces.md` still gives the cache name as `<piece>.png`. With the type in the name, an SVG is kept as `<piece>.svg`, so that line is now only the PNG example. The doc is left as it is under "do not change anything else".
- **Departures:** `logoOf` takes a fourth `fetcher` argument, defaulting to the global `fetch`, which the task did not name. The tests need it to answer without a network and to count the calls.
- **Watch out for:** the cache file is named after the adapter and the type, `<piece>.<extension>`, where `<piece>` is `nameOf(package) ?? package`, so an `@activepieces/piece-x` piece that publishes an SVG caches as `ap-x.svg`. The cache lookup takes any cached file whose name starts with `<piece>.` and reads the type from what follows the dot, so the type survives a restart. A test host with no `configDir` makes no fetch at all, which is why the existing pieces tests still report exactly their own problem lines.


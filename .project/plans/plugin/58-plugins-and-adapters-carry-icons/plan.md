---
title: Plugins and adapters carry icons
domain: plugin
status: built
priority: medium
created: 2026-10-23
revalidated: 2026-10-23
requires: []
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L1204](../../../../packages/sdk/src/types/plugin.ts#L1204) - `PluginManifest`, which has a description, categories, links and contracts, and no icon"
  - "[code://packages/sdk/src/types/connectors.ts#L103](../../../../packages/sdk/src/types/connectors.ts#L103) - `Adapter`, which has a name, title, description, schema and capabilities, and no icon"
  - "[code://packages/sdk/src/plugins/validate.ts#L580](../../../../packages/sdk/src/plugins/validate.ts#L580) - `checkAdapter`, where an adapter's fields are checked when a plugin registers it"
  - "[code://packages/sdk/src/connectors/adapters.ts#L51-L58](../../../../packages/sdk/src/connectors/adapters.ts#L51-L58) - `rowOf`, the adapters channel row that a client reads"
  - "[code://packages/server/src/plugins.ts#L314](../../../../packages/server/src/plugins.ts#L314) - `readManifest`, which reads the `ahpd` field of a package"
  - "[code://packages/server/src/plugins.ts#L385-L386](../../../../packages/server/src/plugins.ts#L385-L386) - `checkFields`, the list of manifest fields that get checked"
  - "[code://packages/server/src/plugins.ts#L168-L195](../../../../packages/server/src/plugins.ts#L168-L195) - the pattern: an entry that resolves outside its package is refused"
  - "[code://packages/server/src/pluginschannel.ts#L157-L181](../../../../packages/server/src/pluginschannel.ts#L157-L181) - the plugins channel row, which already sends the manifest"
  - "[code://packages/activepieces/src/plugin.ts#L196-L213](../../../../packages/activepieces/src/plugin.ts#L196-L213) - `apply`, which registers one adapter for each piece"
  - "[code://packages/activepieces/src/mapping.ts#L219-L226](../../../../packages/activepieces/src/mapping.ts#L219-L226) - `adapterOf`, which builds the adapter from the piece"
  - "[code://docs/plugins/PLUGINS.md#L985](../../../../docs/plugins/PLUGINS.md#L985) - the manifest section of the plugin docs"
  - npm://@microsoft/agent-host-protocol@1.0.0 - the `Icon` type, exported from the package root, with `src`, `contentType`, `sizes` and `theme`
  - file:///github/ahp-review/briefs/icons.md - the brief, with the answers this plan builds
---

## Goal

Each plugin and each adapter can have an icon, so a client draws a Telegram connector with the Telegram mark and not only a name.
A package ships its icon as a file, and the host sends it to clients as a `data:` URI.
The Activepieces plugin gives each piece the logo that Activepieces publishes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "icon" packages/sdk/src packages/server/src` - no icon field on a manifest or an adapter.
- `rg -n "export.*Icon" node_modules/@microsoft/agent-host-protocol/dist/index.d.ts` - `Icon` is exported from the root.
- `rg -n "logoUrl" packages/activepieces/src` - the plugin does not read a piece's logo.

### Runtime path

```
package.json ahpd.icons -> readManifest -> icon files read and encoded -> PluginManifest.icons -> plugins channel row -> client
plugin apply -> registerAdapter({ icons }) -> checkAdapter -> icon files read and encoded -> adapters channel row -> client
activepieces apply -> piece logoUrl -> one fetch, cached on disk -> Adapter.icons as data: -> adapters channel row
```

### Gaps

- `PluginManifest` and `Adapter` have no `icons` field.
- The host has no step that turns a relative icon path into a `data:` URI.
- The adapters channel row has no `icons`.
- The Activepieces plugin drops each piece's `logoUrl`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Reuse AHP's `Icon`: `icons?: Icon[]` on the manifest's `ahpd` field and on `Adapter` | Softov, 2026-10-23 | 01, 02 |
| Any image type AHP takes, SVG, PNG or others | Softov, 2026-10-23 | 02 |
| A plugin declares a local file, such as `./icon.svg`, and the host sends it as a `data:` URI | Softov, 2026-10-23 | 02 |
| An adapter gives a path in `Adapter.icons`, relative to its package, and the host turns it into `data:` as for the manifest | Softov, 2026-10-23 | 02 |
| The Activepieces plugin fetches each piece's `logoUrl` once at load, caches it on disk, and sends it as `data:`. A failed fetch means no icon | Softov, 2026-10-23 | 03 |
| A client draws an icon as an image (`<img>` or a native image view), never inline. The host adds no sanitizer | Softov, 2026-10-23 | 02 |
| One icon file is at most 32 KB | Softov, 2026-10-23 | 02, 03 |
| A `data:` URI goes out as it is. A `data:` URI over 32 KB is refused | (defaulted: from the brief's shape) | 02 |
| The host fetches an `https:` icon at load and sends it as `data:`, under the rules of a file. A client never contacts the plugin's server | Softov, 2026-10-23 | 04 |
| An icon problem goes to the daemon log only | Softov, 2026-10-23 | 02, 04 |
| Each plugin in this repository ships an SVG in its own package folder. Candidates come from Lucide or the vendor's mark, and Softov curates each one | Softov, 2026-10-23 | 05 |
| A path that resolves outside the package is refused, as for an entry | (defaulted: from the brief's shape) | 02 |
| `contentType` comes from the extension (`.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`) unless the manifest gives one. Another extension with no `contentType` is refused | (defaulted: the brief names the extension as the source) | 02 |
| `theme` and `sizes` from the manifest are kept. An SVG with no `sizes` gets `["any"]` | (defaulted: the brief's example) | 02 |
| A bad icon is dropped with a problem line, and the plugin still loads | (defaulted: an icon is decoration, not a reason to fail a load) | 02 |
| A single-file plugin with no package reads its icon paths relative to the file's folder | (defaulted: that folder is what it has in place of a package) | 02 |
| The cache is `<configDir>/activepieces/icons/<piece>.png`, and a cached file is used without a fetch | (defaulted: "fetches once" means once for each piece) | 03 |
| A logo fetch has a timeout of 5 seconds | (defaulted: a slow CDN must not hold the load) | 03 |
| A logo is at most 32 KB, so a piece whose logo is larger gets an SVG shipped in the package, which wins over the cache and the CDN | Softov, 2026-10-24 ("Ship curated SVGs") | 06 |
| The shipped marks come from Simple Icons, under CC0 1.0, and Softov curates each one | (defaulted: Simple Icons holds all four) | 06 |

## Proposed architecture

- **Data flow** - the sdk types carry `Icon[]`. The server resolves each icon once, at load or at registration, and holds only the encoded result. The channels send what the server holds.
- **State flow** - nothing new is stored, except the Activepieces logo cache on disk.
- **Layer responsibilities** - sdk: the type, the check and the row. server: the file read, the checks and the docs. activepieces: the logo cache.
- **Source-of-truth files** - [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The sdk carries icons](task-01-the-sdk-carries-icons.md) | done | - |
| [02 - The host sends a package icon as data](task-02-the-host-sends-a-package-icon.md) | done | 01 |
| [03 - An Activepieces piece has its logo](task-03-a-piece-has-its-logo.md) | done | 02 |
| [04 - The host fetches an https icon](task-04-the-host-fetches-an-https-icon.md) | done | 02 |
| [05 - Our plugins ship an icon](task-05-our-plugins-ship-an-icon.md) | done | 02 |
| [06 - A piece with a large logo has a shipped SVG](task-06-a-large-logo-has-a-shipped-svg.md) | dropped | 03 |

## Risks and tradeoffs

- An SVG can carry a script, and the host does not remove it. The docs say that a client draws an icon as an image, which runs no script.
- Every client receives each `data:` URI in full. The limit of 32 KB keeps the plugins and adapters lists small.
- The Activepieces logos are the brands' trademarks. The plugin passes on what Activepieces publishes, and the README says so.

## Resume state

- **Done so far:** all five tasks are implemented. The sdk types carry `icons?: Icon[]` with AHP's `Icon`, `checkIcons` checks the shape and the adapters channel row sends the list. `packages/server/src/icons.ts` turns a package file, an `https:` URL or a `data:` URI into a `data:` icon. It drops a file whose real path is outside the package. The loader resolves a manifest's icons, and each adapter's icons, against the plugin's package. An `https:` icon is fetched at load with a 5 second timeout, a 32 KB limit and an `image/` check. The fetcher is injected, so no test reaches the network. The Activepieces plugin fetches each piece's `logoUrl` once, and caches it at `<configDir>/activepieces/icons/<piece>.<extension>`, with the type in the name. The adapter gets the logo as a `data:` icon. Each of the eleven packages ships an `icon.svg`, names it in `ahpd.icons` and lists it in `files`, and the webhook adapter uses the same file. The docs have an Icons section in `PLUGINS.md` and a logo section in `activepieces.md`.
- **Reopened:** no plugin declared an icon, so tasks 04 and 05 were added. Tasks 01 to 03 are merged in #80.
- **Reopened again:** the Jira, Linear, Resend and WhatsApp logos are 48 to 77 KB on the CDN, so they show no icon. Plan 69 task 03 replaced task 06: the four marks are host marks in `packages/server/icons/`, and `logoOf` answers a `mark:` source for them.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** which icons Softov keeps, and whether Cofold takes a vendor mark.
- **Watch out for:** an adapter icon path is relative to the package of the plugin that registered it. It is not relative to the daemon's working folder.

## Final verification checklist

- [ ] A package with `ahpd.icons: [{ "src": "./icon.svg" }]` shows a `data:image/svg+xml` icon in the plugins channel row.
- [ ] A connector of an Activepieces piece shows its logo in ahpapp.
- [ ] A plugin with an `https:` icon shows a `data:` icon in the plugins channel row.
- [ ] Each plugin in this repository shows its curated icon in ahpw.
- [ ] A path outside the package and a file over 32 KB each give a problem line, and the plugin still loads.

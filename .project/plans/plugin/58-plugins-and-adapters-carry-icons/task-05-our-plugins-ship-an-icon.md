---
title: Each of our plugins ships an icon
status: done
depends: [task-02-the-host-sends-a-package-icon.md]
layer: "packages"
refs:
  - "[code://packages/server/src/plugins.ts#L358](../../../../packages/server/src/plugins.ts#L358) - `readManifest` reads `ahpd.icons` against the package folder"
  - "[code://packages/webhook/src/plugin.ts#L235](../../../../packages/webhook/src/plugin.ts#L235) - the webhook plugin registers its adapter here"
  - https://lucide.dev/icons/ - a source of generic icons, under the ISC licence
---

## Objective

Each plugin in this repository ships one SVG icon in its own package folder, and names it in `ahpd.icons`.
The webhook adapter names the same icon as its plugin.
Softov curates each SVG before it is kept.

## Files

- `CREATE: packages/activepieces/icon.svg` - the plugin's icon.
- `CREATE: packages/agent-acp/icon.svg` - the plugin's icon.
- `CREATE: packages/agent-claude/icon.svg` - the plugin's icon.
- `CREATE: packages/agent-cofold/icon.svg` - the plugin's icon.
- `CREATE: packages/agent-pi/icon.svg` - the plugin's icon.
- `CREATE: packages/bot/icon.svg` - the plugin's icon.
- `CREATE: packages/computer/icon.svg` - the plugin's icon.
- `CREATE: packages/push/icon.svg` - the plugin's icon.
- `CREATE: packages/tasks/icon.svg` - the plugin's icon.
- `CREATE: packages/tunnel-devtunnel/icon.svg` - the plugin's icon.
- `CREATE: packages/webhook/icon.svg` - the plugin's icon, also used by its adapter.
- `UPDATE: packages/*/package.json` - add `ahpd.icons: [{ "src": "./icon.svg" }]`, and add `icon.svg` to `files` so the package ships it.
- `UPDATE: packages/webhook/src/plugin.ts:235` - give the adapter `icons: [{ src: "./icon.svg" }]`.
- `CREATE: .project/pending/plugin-58-icon-curation.md` - one row per plugin with the candidate SVG, its source URL and its licence, for Softov.
- `UPDATE: packages/server/test/` - a case that each of our packages loads with one `data:image/svg+xml` icon.

## Steps

1. Find one candidate SVG for each plugin, from Lucide or from the vendor's own published mark.
2. Record the source URL and the licence of each candidate in the pending file.
3. Keep each SVG at most 32 KB, and remove any `<script>` element or event attribute from it.
4. Put each candidate at `packages/<name>/icon.svg`.
5. Add `ahpd.icons` and the `files` entry to each `package.json`.
6. Give the webhook adapter the same icon.
7. Add the test that each package loads with its icon.
8. Stop and ask Softov to curate each candidate in the pending file.
9. Replace each candidate that Softov rejects with the SVG that Softov gives.

## Validation

- The new test passes, and the gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- `npm pack --dry-run` in each package lists `icon.svg`.
- By hand: Softov approves each icon in the pending file.
- By hand: ahpw shows each plugin with its icon after a restart.

## Resume

- **Done so far:** each of the eleven packages has an `icon.svg`, between 401 and 1921 bytes. Nine are Lucide drawings under the ISC licence, and each of those keeps the licence comment. Claude carries the starburst that Simple Icons publishes under CC0. The pi package carries the three-square mark from `https://pi.dev/logo-auto.svg`. Those two replace the first Lucide choices, which you said were wrong. Every `package.json` names `./icon.svg` in `ahpd.icons` and lists `icon.svg` in `files`. The webhook adapter carries the same file. `packages/server/test/plugin-icons.test.ts` reads each package's manifest and checks one `data:image/svg+xml` icon. It also checks a size under 32 KB, no script or event attribute, and the `files` entry. One more case checks the webhook adapter's icon. `.project/pending/plugin-58-icon-curation.md` holds one row per plugin with its file, source and licence, and waits for your reply.
- **Next action:** you curate each candidate in the pending file, and a rejected one is replaced with the SVG you give.
- **Files:** `packages/activepieces/icon.svg`, `packages/agent-acp/icon.svg`, `packages/agent-claude/icon.svg`, `packages/agent-cofold/icon.svg`, `packages/agent-pi/icon.svg`, `packages/bot/icon.svg`, `packages/computer/icon.svg`, `packages/push/icon.svg`, `packages/tasks/icon.svg`, `packages/tunnel-devtunnel/icon.svg`, `packages/webhook/icon.svg`, the eleven `package.json` files, `packages/webhook/src/adapter.ts`, `packages/server/src/plugins.ts`, `packages/server/test/plugin-icons.test.ts`, `.project/pending/plugin-58-icon-curation.md`, this task file.
- **Open questions:** which candidates you keep, and whether Cofold takes a vendor mark.
- **Departures:** the task did not name `packages/server/src/plugins.ts`. An adapter icon resolved against `src/` when a test named a package's entry file. So `base` now falls back to the nearest package. Lucide has no `tunnel` icon, so Dev Tunnel uses `waypoints`. The test reads each package's manifest rather than applying all eleven plugins, because several need options and services a test host does not have.
- **Watch out for:** the pi and Claude marks are the vendors' trademarks. A later change to either needs the vendor's terms, not only a licence from the drawing's author.

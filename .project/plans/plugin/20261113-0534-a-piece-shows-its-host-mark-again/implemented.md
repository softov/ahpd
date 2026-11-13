---
title: A piece shows its host mark again - implemented
date: 2026-11-13
refs:
  - git://dd6d29c40 - main when the build started
  - "[code://packages/activepieces/src/logos.ts](../../../../packages/activepieces/src/logos.ts)"
  - "[code://packages/activepieces/test/logos.test.ts](../../../../packages/activepieces/test/logos.test.ts)"
---

The GitHub, Jira Cloud, Linear, Postgres, Resend and WhatsApp pieces show the mark the host ships, with a dark file for GitHub and Resend. Their CDN logos are neither read nor cached, so the five logos over 32 KB no longer leave a piece with the plugin's Activepieces mark.

## What was built

- [`code://packages/activepieces/src/logos.ts`](../../../../packages/activepieces/src/logos.ts) - the exported `MARKS` table, from adapter name to mark name. `logoOf` answers `{ icon: { src: "mark:<name>" } }` for a piece in it, before the configuration folder check, so a daemon with no folder sends the mark too.
- `packages/server/icons/postgres.svg` - the PostgreSQL mark of Simple Icons, in `#4169E1`, 5.2 KB, with the source comment the other marks carry.
- [`code://packages/activepieces/test/logos.test.ts`](../../../../packages/activepieces/test/logos.test.ts) - three cases, one of them changed:
  - A piece with no mark, Airtable, fetches its own logo. The case used GitHub before.
  - Every piece in `MARKS` answers its mark with a cached logo and a fetcher that throws, and with no configuration folder.
  - `MARKS` holds the five pieces whose logos are over 32 KB, and each mark it names is a file in `packages/server/icons/`.
- `docs/plugins/activepieces.md` *Each piece shows its logo* - the six pieces show a host mark.
- `.project/pending/plugin-58-icon-curation.md` - a Postgres row, and Softov's answer in place of the question on `1ea68fcb8`.

## Verified

- `npx vitest run packages/activepieces` under the shared lock: 10 files, 176 passed.
- `npx vitest run packages/server` under the shared lock: 95 files, 1877 passed, 3 skipped, 1 failed. The failed case, `plugin-load.test.ts` *loads bot with the options schema in its package.json*, ran before the worktree had a build. After `pnpm build`, its file passes 59 of 59.
- `pnpm typecheck`, `pnpm boundary`, `pnpm build` and `pnpm docs:build` pass.
- A script ran `logoOf` and then the server's `resolveIcons` for each piece in `MARKS`. Each answered a `data:image/svg+xml` icon with no problem line, and GitHub and Resend a dark one too.
- The Postgres file has no script and no event attribute.

## Departures from the plan

- The check by hand ran as a script over `logoOf` and `resolveIcons`, not on the test daemon. `test-daemon.sh` runs `origin/main`, and the six pieces need an npm install of each.

## Left for later

- Softov curates the Postgres mark in [the curation file](../../../pending/plugin-58-icon-curation.md).

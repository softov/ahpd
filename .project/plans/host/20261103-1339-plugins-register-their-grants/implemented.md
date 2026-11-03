---
title: Plugins register their grants - implemented
date: 2026-11-03
refs:
  - git://fdcea4d2
  - "[code://packages/sdk/src/plugins/plugins.ts](../../../../packages/sdk/src/plugins/plugins.ts)"
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts)"
---

Every grant the host and the repository's plugins require is on `ahpd.grants`, so ahpw's role editor shows it. A plugin registers the grants it uses with `registerGrants`, and the host reports a required grant that nothing registered.

## What was built

- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `registerGrants` and `GrantEntry`.
- [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts) - the fold merges registrations into `HostOptions.grants`, and checks each required grant against the list.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `advertisedGrants` adds the registered subjects, with groups from `operationsOf`.
- [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts) - `apply` and `reload` in the `write` group of `plugin`.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the daemon registers `client`, `tunnel` and `operation`.
- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - the bot plugin registers `bot` with `chat`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) and [`code://docs/sdk/USERS.md`](../../../../docs/sdk/USERS.md) - the call and the new rows.

## Verified

- `plugin-grants.test.ts`, `plugin-grants-check.test.ts` and `grants-advertised.test.ts` pass.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- `pnpm --filter @ahpd/sdk test` passes 4092, `@ahpd/server` passes 1759, and `@ahpd/bot` passes 234.
- `holds` and `groupOf` have no change.
- On 2026-11-03, a daemon of this branch loaded ten of the repository's plugins. It wrote no "requires" line.
- activepieces did not load in that run, because its `pieces` option was not set.
- ahpw's role editor reads `ahpd.grants` as a whole map in `grantCatalog`. Nobody looked at the new subjects in a browser.

## Departures from the plan

- `x-ahpd/invokeOperation` requires `operation:invoke`, which no entry listed. The daemon registers `operation` with `invoke`.
- A plugin declares `grants` in its manifest's `contracts` before it calls `registerGrants`, as for `registerResourceProvider`. The bot's `package.json` declares `bot`.
- Six existing tests assert that the fold reports no problems. Their methods and channels now require a listed grant, such as `session:list`, or their plugin registers its subject.

## Left for later

- none.

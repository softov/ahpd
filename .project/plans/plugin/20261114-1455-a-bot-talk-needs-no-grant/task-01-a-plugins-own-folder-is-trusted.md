---
title: A plugin's own folder is trusted
status: todo
depends: []
layer: "sdk, bot, docs"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1343-L1356](../../../../packages/sdk/src/host/sessionmethods.ts#L1343-L1356) - the placed folder's trust check"
  - "[code://packages/sdk/src/host/automations.ts#L1014-L1017](../../../../packages/sdk/src/host/automations.ts#L1014-L1017) - the plugin start's trust check"
---

## Objective

A plugin whose manifest lists `contracts.folders` calls `host.registerFolder(path)` when it applies.
A session of the plugin placed or started in that folder, or under it, is trusted with no `session:trust`.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:233-266` - `PluginStarts.folders`, and `registerFolder` on `PluginHost`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1963` - `registerFolder`, beside `registerRoute`, which needs `contracts.folders`.
- `UPDATE: packages/sdk/src/host/trust.ts:95-111` - `mayTrust(starts, folder)`: the plugin's `session:trust`, or the folder under one it registered.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1353-1357` - the placed folder's check calls `mayTrust`.
- `UPDATE: packages/sdk/src/host/automations.ts:1015-1017` - the plugin start's check calls `mayTrust`.
- `UPDATE: packages/bot/package.json` - `contracts.folders`.
- `UPDATE: packages/bot/src/plugin.ts:423` - `host.registerFolder(root)`.
- `UPDATE: docs/plugins/PLUGINS.md` - the `folders` contract and `registerFolder`.
- `UPDATE: docs/plugins/BOTS.md:311` - a talk's trust needs no grant.

## Steps

1. Add `folders?: readonly string[]` to `PluginStarts`, and `registerFolder(path: string): void` to `PluginHost`.
2. Write `registerFolder` in `plugins.ts`: refuse it with no contracts, call `declared(by, options.contracts, 'folders')`, require an absolute path, push it to `starts.folders`.
3. Export `mayTrust` from `trust.ts`, comparing with `under` after `settled`.
4. Call `mayTrust` at both trust checks, with the folder the session gets, and keep the refusal's words.
5. Add `"folders": ["the bots' workspaces, one folder per bot under root"]` to the bot manifest's contracts.
6. Call `host.registerFolder(root)` in the bot plugin, after the line that sets `root`.
7. Document the contract and the call in PLUGINS.md, and the talk's trust in BOTS.md.

## Validation

- An sdk test: the host trusts a placed folder under a registered folder with no grant.
- An sdk test: the host refuses a placed trusted folder outside it, and names `session:trust`.
- An sdk test: the host refuses a link inside the registered folder that points out of it.
- An sdk test: `registerFolder` without `contracts.folders`, and with no contracts, fails the plugin.
- An sdk test: a plain session in the registered folder is not trusted.
- A bot test: a client creates a talk with no grants on the plugin's entry.
- Run the sdk suite, then the bot suite, one at a time.

## Resume


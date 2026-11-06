---
title: Adapters and connectors are two channels
status: done
depends: [task-12-plugins-and-connectors-have-grants.md]
layer: "sdk, server, webhook"
refs:
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts) - the one channel that lists kind rows and connector rows today"
  - "[code://packages/sdk/src/types/connectors.ts#L75-L97](../../../../packages/sdk/src/types/connectors.ts#L75-L97) - `ConnectorKind` and `ServedConnectorKind`, which become `Adapter` and `ServedAdapter`"
  - "[code://packages/sdk/src/types/plugin.ts#L1034](../../../../packages/sdk/src/types/plugin.ts#L1034) - `registerConnector`, which becomes `registerAdapter`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L343-L447](../../../../packages/sdk/src/plugins/plugins.ts#L343-L447) - `connectorKinds`, the fold of each registration"
  - "[code://packages/sdk/src/plugins/validate.ts#L527-L557](../../../../packages/sdk/src/plugins/validate.ts#L527-L557) - `checkConnectorKind`, the check of one registration"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L39-L47](../../../../packages/sdk/src/resources/recordschannel.ts#L39-L47) - `mayRead` and `ownerOf`, how a records channel narrows the rows a reader sees"
  - "[code://packages/sdk/src/access/users.ts#L123-L220](../../../../packages/sdk/src/access/users.ts#L123-L220) - `OPERATIONS`, where the `connector` subject is"
  - "[code://packages/webhook/src/kind.ts#L113](../../../../packages/webhook/src/kind.ts#L113) - `webhookKind`, the first registration"
  - "[code://packages/server/src/commands/run.ts#L685](../../../../packages/server/src/commands/run.ts#L685) - where the daemon makes the connectors channel"
  - "[code://packages/server/src/pluginschannel.ts](../../../../packages/server/src/pluginschannel.ts) - the plugins channel, the pattern for a channel of one record type"
---

## Objective

A plugin registers an adapter, and a person makes connectors from an adapter.
`x-ahpd-adapters` lists the adapters, and `x-ahpd-connectors` lists only connectors.
Each channel holds one record type.
Every connector action takes a `connector:` grant, the caller's own connector included.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts:75-97` - rename `ConnectorKind` to `Adapter` and `ServedConnectorKind` to `ServedAdapter`.
- `UPDATE: packages/sdk/src/types/plugin.ts:1034` - rename `registerConnector` to `registerAdapter`, and the contract key `connectors` to `adapters`.
- `UPDATE: packages/sdk/src/types/host.ts:152` - rename `connectorKinds` to `adapters`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:343-447` - the fold and the contract check use the new names.
- `UPDATE: packages/sdk/src/plugins/validate.ts:527-557` - rename `checkConnectorKind` to `checkAdapter`.
- `UPDATE: packages/sdk/src/access/users.ts:123-220` - the `connector` subject gains `all` in the read group and `host` in the write group.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - remove the kind rows, rename the record field `kind` to `adapter`, and apply the new grant rules.
- `CREATE: packages/sdk/src/connectors/adapters.ts` - the `x-ahpd-adapters` channel.
- `UPDATE: packages/sdk/src/index.ts` - export the adapters channel and the new type names.
- `UPDATE: packages/webhook/src/kind.ts` - rename the file to `adapter.ts` and `webhookKind` to `webhookAdapter`.
- `UPDATE: packages/webhook/src/plugin.ts:221` - call `registerAdapter`, and declare `adapters` in the contract.
- `UPDATE: packages/server/src/commands/run.ts:685` - serve both channels.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the connector cases below.
- `CREATE: packages/sdk/test/adapters-channel.test.ts` - the adapter cases below.

## Steps

1. Rename `ConnectorKind`, `ServedConnectorKind`, `registerConnector`, `connectorKinds` and `checkConnectorKind` to the adapter names.
2. Rename the contract key `connectors` to `adapters`, and update every shipped plugin that declares it.
3. Rename the connector record field `kind` to `adapter`.
4. Rename the webhook plugin's `kind.ts` and `webhookKind` to `adapter.ts` and `webhookAdapter`.
5. Add `all` to the read group and `host` to the write group of the `connector` subject.
6. Make `x-ahpd-adapters` a read-only channel with one row per adapter, keyed by its name.
7. Require `connector:list` to read `x-ahpd-adapters`.
8. Remove every kind row, the `kind:` prefix and its checks from `x-ahpd-connectors`.
9. Let `connector:all` read every connector.
10. Let `connector:list` read the caller's own connectors, their teams' connectors and the host's.
11. Give a caller with neither grant no connector row.
12. Require `connector:put` to make and `connector:remove` to remove a connector of any owner.
13. Also require `connector:host` for a connector owned by `host`.
14. Also require a membership of the team for a team connector, and stop requiring `team:write`.
15. Keep the person check for a connector owned by `user:<id>`.
16. Apply the old owner's remove rule to a put that moves a connector.
17. Serve both channels from `run.ts`, and advertise both in the handshake.
18. Run the SDK, server and webhook tests, and set this task and the plan row to `implemented`.

## Validation

- `adapters-channel.test.ts`: a role with `connector:list` reads every adapter, keyed by name, before any connector exists.
- `adapters-channel.test.ts`: the host refuses a role without `connector:list`.
- `connectors-channel.test.ts`: no row of `x-ahpd-connectors` is an adapter, and a connector row names its `adapter`.
- `connectors-channel.test.ts`: `connector:list` reads the caller's own, their team's and the host's connectors, and not another person's.
- `connectors-channel.test.ts`: `connector:all` reads every connector.
- `connectors-channel.test.ts`: a person without `connector:put` cannot make their own connector.
- `connectors-channel.test.ts`: `connector:put` without `connector:host` cannot make a host connector.
- `connectors-channel.test.ts`: `connector:put` and a membership make a team connector without `team:write`.
- A plugin that declares `connectors` in its contract and calls `registerAdapter` fails to load, with a message that names `adapters`.
- The handshake's `ahpd.grants` lists `connector` with `list`, `all`, `put`, `remove` and `host`.
- `rg -n "ConnectorKind|registerConnector|connectorKinds|kind:" packages/*/src` finds no connector use.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** implemented on 2026-10-22.
  `ConnectorKind`, `ServedConnectorKind`, `registerConnector`, `connectorKinds` and `checkConnectorKind` are `Adapter`, `ServedAdapter`, `registerAdapter`, `adapters` and `checkAdapter`; the contract key is `adapters`.
  The connector record names its adapter in `adapter`, and a put takes `adapter`, not `kind`.
  `x-ahpd-adapters` is a read-only channel keyed by adapter name, needs `connector:list`, and is served beside `x-ahpd-connectors` from `run.ts`.
  `x-ahpd-connectors` holds connector rows only; `connector:list` reads own, team and host rows, `connector:all` reads every row, and neither grant reads no row.
  A put and a remove take `connector:put` or `connector:remove` of any owner. A host connector also takes `connector:host`, and a team connector a membership of its team. A `user:` connector takes the caller to be the person. A move also passes the old owner's remove rule.
  The webhook plugin registers `webhookAdapter` from `adapter.ts` and declares `adapters` in its manifest.
  `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.
  The six touched test files pass, 86 tests: `connectors-channel`, `adapters-channel`, `plugin-fold`, `plugin-host`, `webhook-bot`, `webhook-kind`.
  The validation grep finds no `ConnectorKind`, `registerConnector`, `connectorKinds` or `ServedConnectorKind`. The `kind:` in that grep also matches unrelated fields such as `clientplugins.ts`'s `load: { kind: 'loaded' }`, `validate.ts`'s parameter and `pluginparts.ts`'s `state: { kind: 'stopped' }`, and none of those is a connector.
- **Next action:** task 16, the docs.
- **Open questions:** none.
- **Departures:** `webhook-kind.test.ts` keeps its name, because the Files list renames only `src/kind.ts`; its body uses the adapter names.
  `plugin-fold.test.ts`, `plugin-host.test.ts` and `webhook-bot.test.ts` were updated too, because the renamed contribution field and type live in them.
  The contract check's new case is in `plugin-fold.test.ts`.
- **Watch out for:** a stored connector with a `kind` field and no `adapter` field reads as `unavailable`.
  A person who made their own connector with no grant cannot change it any more; the changelog says which grants to add.
  A `connector:list` caller with no readable connector is refused the subscription, an empty store included. A records channel admits a reader through one readable id.
  `connector:all` holders are admitted by the channel grant and read an empty store as an empty snapshot.

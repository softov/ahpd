---
title: The host lists tunnels and runs operations
status: implemented
depends:
  - task-01-a-plugin-registers-a-tunnel-kind.md
layer: sdk
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L264](../../../../packages/sdk/src/connectors/channel.ts#L264) - `connectorsChannel`, the shape `tunnelsChannel` copies: a collection, kinds, a vault and a check"
  - "[code://packages/sdk/src/connectors/channel.ts#L623-L695](../../../../packages/sdk/src/connectors/channel.ts#L623-L695) - `prepare`, where a secret moves to the vault and a blank one keeps the stored value"
  - "[code://packages/sdk/src/connectors/channel.ts#L15-L19](../../../../packages/sdk/src/connectors/channel.ts#L15-L19) - a secret's vault path, which a tunnel copies as `tunnel/<id>/<field>`"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L1-L60](../../../../packages/sdk/src/resources/recordschannel.ts#L1-L60) - `recordsChannel`, which serves the list"
  - "[code://packages/computer/src/catalogue.ts#L27-L54](../../../../packages/computer/src/catalogue.ts#L27-L54) - `ownerOf`, which answers `?owner=me`"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L287-L310](../../../../packages/sdk/src/host/resourcemethods.ts#L287-L310) - `invokeChangesetOperation`, the checks the command copies"
  - "[code://packages/sdk/src/types/plugin.ts#L522-L545](../../../../packages/sdk/src/types/plugin.ts#L522-L545) - `PluginMethod`'s `grant` and `authorize`"
---

## Objective

`tunnelsChannel` serves `x-ahpd-tunnels://`: every tunnel with its status, and the operations offered now.
`x-ahpd/invokeOperation` runs one operation on any channel that offers operations.
The host checks the operation, the target, the input and the grant, and then calls the kind.

## Files

- `CREATE: packages/sdk/src/kinds/operations.ts` - the operations a kind offers, their status, and the `x-ahpd/invokeOperation` command over the channels that offer operations.
- `CREATE: packages/sdk/src/tunnels/channel.ts` - `tunnelsChannel`: the records channel, the record writes, the start and stop of each tunnel, and the URLs.
- `UPDATE: packages/sdk/src/index.ts` - export `tunnelsChannel`, the invoke command and their types.
- `CREATE: packages/sdk/test/kinds-operations.test.ts` - the command against a fake channel.
- `CREATE: packages/sdk/test/tunnels-channel.test.ts` - the channel against an in-memory collection and a fake kind.
- `UPDATE: docs/plugins/PLUGINS.md:1485` - `x-ahpd-tunnels` and `x-ahpd/invokeOperation`, after `x-ahpd-connectors`.

## Steps

1. Build `create` for each kind on the `list` scope, with its `schema` as `input` and its title as `label`.
2. Build `update` on the `tunnel` scope for a kind with an `update` handler, with the kind's `schema` as `input`.
3. Build `remove` on the `tunnel` scope, with a confirmation and the grant `tunnel:delete`.
4. Build `enable` and `disable` on the `tunnel` scope for every kind.
5. Build each operation the kind lists, on the `tunnel` scope, with its own label, icon, input and grant.
6. Give every operation with no grant of its own the grant `tunnel:put`.
7. Name each operation `<kind>/<name>`.
8. Serve `x-ahpd/invokeOperation` with `{ channel, operationId, target?, input? }`.
9. Give the command the grant `operation:invoke`, and let `authorize` admit a caller who holds the operation's grant.
10. Refuse an operation the channel's state does not list now.
11. Refuse a `tunnel` operation with no `target.id`, and a `list` operation with a target.
12. Refuse an input that the operation's `input` schema refuses, with the host's schema check.
13. Set the operation's `status` to `running`, then to `idle`, or to `error` with its `error`.
14. Keep a `tunnel` operation's status on the record's `operation` as `{ id, status, error? }`.
15. Answer the caller with the record, or `{}` for an operation that removed it.
16. Serve the list with `recordsChannel` at `x-ahpd-tunnels`, with the grant `tunnel:read`.
17. Add `operations` to the snapshot, and send `x-ahpd-tunnels/operations` with the list when a list operation's status changes.
18. Answer `?owner=me` from the record's `owner`, which a tunnel leaves empty.
19. On `create`, check the input, move each secret to the vault at `tunnel/<id>/<field>`, and save the record.
20. Save the record with `kind`, `plugin`, `purpose: person`, `enabled: true`, an empty `owner` and the settings.
21. Then call the kind's `create` with the resolved settings and a `report` for the record.
22. Remove the record and its secrets when the kind's `create` throws, and answer the error.
23. On `update`, keep a blank secret as the stored one, save the record, and call the kind's `update`.
24. On `remove`, call the kind's `remove`, then remove the record and its secrets.
25. On `disable`, call `invoke('stop')`, and set `enabled` to false. On `enable`, set `enabled` to true, and call `invoke('start')`.
26. Pass every other operation to `invoke` with its name and input.
27. Keep `status`, `url`, `error` and `operation` in memory, and merge them into each record the channel sends.
28. Send `changed` to the subscribers when a `report` changes a record.
29. Give the channel `startAll(port)`: ask each kind's `system`, create what it answers with `purpose: system`, then start each enabled record.
30. In `startAll`, skip `system` for a kind that already has a record with `purpose: system`.
31. Give the channel `stopAll()`, which calls `invoke('stop')` for each running record.
32. Give the channel `urls()`, which answers the URL of each running record.
33. Log a kind's failure as one line with the record's id, and never a setting marked secret.
34. Write `x-ahpd-tunnels` and `x-ahpd/invokeOperation` in `PLUGINS.md`, with the state shape and the refusals.

## Validation

- `packages/sdk/test/kinds-operations.test.ts` refuses an operation not offered, a target of the wrong scope, and an input its schema refuses.
- The same file refuses a caller without the operation's grant, and admits one with a kind's own grant.
- The same file holds: an operation's status goes from `running` to `idle`, or to `error` with its error.
- `packages/sdk/test/tunnels-channel.test.ts` holds: `create` saves the record with `purpose: person`, calls the kind, and a `report` reaches a subscriber.
- The same file holds: a secret field reaches the vault, and the record keeps only a reference.
- The same file holds: a blank secret on `update` keeps the stored one.
- The same file holds: a kind that throws in `create` leaves no record and no secret.
- The same file holds: `disable` stops a tunnel and keeps it, and `enable` starts it.
- The same file holds: `startAll` adds one system tunnel and starts the enabled ones.
- The same file holds: a second `startAll` adds no second system tunnel.
- The same file holds: no snapshot, answer, error or log carries a secret value.
- `pnpm --filter @ahpd/sdk test -- kinds-operations` and `pnpm --filter @ahpd/sdk test -- tunnels-channel` pass.
- `pnpm typecheck` passes.

## Resume

Built the shared operations core and the tunnels channel. `packages/sdk/src/kinds/operations.ts` holds `OperationChannel`, `InvokeOperationOptions` and `invokeOperation`, which serves `x-ahpd/invokeOperation` with the grant `operation:invoke`. Its `authorize` admits a caller who holds the operation's own grant. `packages/sdk/src/tunnels/channel.ts` holds `tunnelsChannel`. It serves the records channel at `x-ahpd-tunnels`, with the host's four operations and each kind's own. It writes the records, moving their secrets to the vault, and gives the host `startAll`, `stopAll` and `urls`. `packages/sdk/src/index.ts` exports both, and `packages/sdk/src/channels/owners.ts` gained the `tunnel` secret subject and `TUNNEL_SECRETS`.

Departures from the steps:

- `packages/sdk/src/channels/owners.ts` gained `'tunnel'` in `SecretSubject` and `TUNNEL_SECRETS`, because a tunnel's secret needs the subject and the vault name `host:tunnel/<id>/<field>`. The Files list did not name this file.
- A record keeps its settings as fields of its own, as the plan's answer says, and the kind is handed them as `tunnel.settings`. The host's fields are `id`, `kind`, `plugin`, `purpose`, `enabled` and `owner`.
- The host makes a new tunnel's id as `<kind>-<8 hex>`. Neither the kind's schema nor the command carries one, and the brief calls it the host's id.
- The whole operations array is sent on `x-ahpd-tunnels/operations` when a list operation's status changes, not a diff. A tunnel operation's change rides the record's `changed`.
- `startAll` starts only enabled records that are not already running, so a second call starts nothing twice and adds no second system tunnel.
- `invokeOperation` checks an operation's input with the label `<id>'s input`, and passes no input when the operation declares no schema.

Gates: `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm -s boundary` pass. `packages/sdk/test/kinds-operations.test.ts` (7 tests) and `packages/sdk/test/tunnels-channel.test.ts` (7 tests) pass. The prose lint reports no finding in the two new sections; it still reports the file's pre-existing long sentences.

---
title: A client makes connectors
status: done
depends: [task-05-a-plugin-registers-connector-kinds.md, task-06-a-collection-keeps-json-records.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/resources/recordschannel.ts#L72](../../../../packages/sdk/src/resources/recordschannel.ts#L72) - `recordsChannel`, with `ownerOf` and `?owner=me`"
  - "[code://packages/sdk/src/types/vault.ts#L18-L26](../../../../packages/sdk/src/types/vault.ts#L18-L26) - `Vault.set` and `delete`"
  - "[code://packages/server/src/rootconfig.ts#L117-L140](../../../../packages/server/src/rootconfig.ts#L117-L140) - `conforming`, the JSON Schema subset a client already draws"
  - "[code://packages/server/src/commands/run.ts#L632-L647](../../../../packages/server/src/commands/run.ts#L632-L647) - `servedRecords('ahpd', ...)`"
---

## Objective

A client subscribes to `x-ahpd-connectors` and gets the kinds and the connectors.
A client calls `x-ahpd/connectors/put` and `remove`, and the host opens or closes the connector.
A secret is written to the vault, and is in no record and no snapshot.

## Files

- `CREATE: packages/sdk/src/connectors/channel.ts` - the channel, the two methods and the open connectors.
- `UPDATE: packages/sdk/src/index.ts` - export `connectorsChannel`.
- `UPDATE: packages/server/src/commands/run.ts:632-647` - open the `connectors` JSON collection, and add the channel and methods to `servedRecords`.
- `CREATE: packages/sdk/test/connectors-channel.test.ts` - the cases below.

## Steps

1. Serve one row for each kind, with its name, title, description, schema, capabilities and plugin.
2. Serve one row for each connector, with `state` as `open`, `unavailable` or `invalid`.
3. Give `ownerOf` from the connector's owner, so `?owner=me` lists the caller's own.
4. In `put`, refuse a kind that is not registered.
5. In `put`, check `config` against the kind's schema, and answer the first error.
6. Move each `writeOnly` value to the vault, as `connector/<id>/<field>` in the owner's scope.
7. Write the record with a `{ "$secret": "<name>" }` in place of each moved value.
8. Close the open connector with the same id, then call the kind's `open` with the secrets read back.
9. In `remove`, close the connector, delete its secrets and delete the record.
10. Require the owner's grant: root for `host`, the team's secret grant for `team:<team>`, and that person for `user:<id>`.
11. Open every stored connector of a registered kind when the daemon starts.
12. Run the SDK tests, and set this task and the plan row to `implemented`.

## Validation

- `connectors-channel.test.ts`: a kind shows before any connector exists.
- `connectors-channel.test.ts`: two `put` calls of one kind make two connectors, and the host calls `open` for each.
- `connectors-channel.test.ts`: a `writeOnly` value is in the vault and in no record and no snapshot.
- `connectors-channel.test.ts`: a `put` of an empty `writeOnly` field keeps the stored secret.
- `connectors-channel.test.ts`: a connector of an unregistered kind shows as `unavailable` and does not open.
- `connectors-channel.test.ts`: `?owner=me` lists only the caller's connectors.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `packages/sdk/src/connectors/channel.ts` serves the kinds, the connectors, the two methods and `openAll`.
  `index.ts` exports `connectorsChannel`.
  `run.ts` opens the `connectors` JSON collection on the store the host is built over, and serves the channel and its methods.
  It fills the kinds after the load, and opens the stored connectors once the host is built.
- **Done so far:** `packages/sdk/test/connectors-channel.test.ts` has 16 cases.
  They cover the kind before a connector, two puts and two opens, and a secret in the vault and in no record or snapshot.
  They also cover an empty `writeOnly` field keeping the secret, an unregistered kind, an invalid config and `openAll`.
  The rest are `?owner=me`, the grants for reading and for host, team and person, and a refused config and kind.
- **Fixed in review:** `put` checked only the new owner, so a caller took a person's or a team's connector by its id.
  A put that changes the owner now passes the owner rule of the record it replaces, and a record with no owner takes `config:write`.
  The old owner's secrets leave the vault after the record is written, and two cases hold both.
- **Next action:** task 08, which makes the `webhook` kind the first one.
- **Open questions:** none.
- **Departures:**
  - Step 3 reads `ownerOf` from a cache the last listing filled, because `recordsChannel` asks `mayRead` synchronously.
    The cache is filled by `ids`, `find` and `put`.
  - The channel takes the schema checker as an option, because the sdk declares no `@cofold/commands` and the boundary check forbids one.
  - A kind row needs `config:read`: the Answer reads "every row" with the grant, and "the connectors owned by" without it.
    A reader without the grant sees no kind row, so a person with no connector of their own is refused the channel.
  - `put` answers the row as written, with its `state`, rather than `{}`.
  - A put under a different owner keeps none of the old owner's secrets, and the old names are taken out of the vault.
  - `openAll` runs after `createHost` and before the listener binds, so the vault a plugin replaced is the one it reads.
  - A stored `writeOnly` field is checked against the schema as `HELD`, the placeholder a client is shown.
    A value nobody may read is never read to ask a rule of it.
- **Watch out for:** a client sends an empty `writeOnly` field to keep the secret, because it never sees the stored value.

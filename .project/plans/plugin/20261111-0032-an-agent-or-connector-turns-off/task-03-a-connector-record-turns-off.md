---
title: A connector record turns off
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L392-L400](../../../../packages/sdk/src/connectors/channel.ts#L392-L400) - `stateOf`, which answers `disabled` first"
  - "[code://packages/sdk/src/connectors/channel.ts#L616-L629](../../../../packages/sdk/src/connectors/channel.ts#L616-L629) - `close`, which `disable` calls"
  - "[code://packages/sdk/src/connectors/channel.ts#L879-L905](../../../../packages/sdk/src/connectors/channel.ts#L879-L905) - `put`, which carries `enabled` over and does not open a disabled record"
  - "[code://packages/sdk/src/connectors/channel.ts#L1569-L1615](../../../../packages/sdk/src/connectors/channel.ts#L1569-L1615) - the methods map and `openAll`"
  - "[code://packages/sdk/src/tunnels/channel.ts#L524-L541](../../../../packages/sdk/src/tunnels/channel.ts#L524-L541) - the tunnel toggle this copies"
---

## Objective

`x-ahpd/connectors/disable` closes a connector and writes `enabled: false`, and `x-ahpd/connectors/enable` writes `enabled: true` and opens it.
The host opens a disabled connector neither at start nor after a `put`.
Its row shows the state `disabled` and no alerts, and it answers no call and lists no model.

## Files

- `UPDATE: packages/sdk/src/connectors/channel.ts:120-141` - add the method names `ENABLE` and `DISABLE`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:150` - `ConnectorState` adds `disabled`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:392-400` - `stateOf` answers `disabled` for a record with `enabled: false`, before any other state.
- `UPDATE: packages/sdk/src/connectors/channel.ts:879-905` - `put` keeps the stored `enabled`, refuses an `enabled` in its params, and does not open or check a disabled record.
- `UPDATE: packages/sdk/src/connectors/channel.ts:1569-1590` - add `enable` and `disable` with the grant `connector:put` and the owner's rule, as `check` has them.
- `UPDATE: packages/sdk/src/connectors/channel.ts:1596-1615` - `openAll` skips a disabled record.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the cases in *Validation*.
- `UPDATE: docs/plugins/PLUGINS.md:1740-1832` - the two methods, the field and the state `disabled`.
- `UPDATE: docs/updates/v0_15.md` - under *Unreleased*, *Plugins*: a connector record turns off and on.

## Steps

1. Add `disabled` to `ConnectorState`, and the two method names beside `PUT` and `CHECK`.
2. Make `stateOf` answer `disabled` for `enabled === false`.
3. Write `disable`: `close` the connector, write `enabled: false`, refresh, and answer the row.
4. Write `enable`: write `enabled: true`, open and check it as `put` does, refresh, and answer the row.
5. Authorize both with the rule that `check` uses.
6. Carry `enabled` from the stored record in `put`, and skip the open and the check for a disabled record.
7. Skip a disabled record in `openAll`.
8. Keep a disabled connector in `refs`.
9. Update the docs and the release notes.
10. Write the tests.

## Validation

- `packages/sdk/test/connectors-channel.test.ts`: `disable` closes the connector, and its row is `disabled` with no alerts.
- A disabled provider connector is not in `providers()`, and `models` refuses it.
- An action through `run` on a disabled connector fails.
- `openAll` does not open a disabled record, and reads none of its secrets.
- `enable` opens and checks it again, and its row is `ready`.
- A `put` on a disabled record keeps it disabled and closed.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes.

## Resume

---
title: A connector row lists its alerts
status: todo
depends: [task-01-an-alert-says-when-and-each-gap.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L258-L266](../../../../packages/sdk/src/types/connectors.ts#L258-L266) - `ConnectorHealth`, which goes"
  - "[code://packages/sdk/src/connectors/channel.ts#L150](../../../../packages/sdk/src/connectors/channel.ts#L150) - `ConnectorState` gets `failed`"
  - "[code://packages/sdk/src/connectors/channel.ts#L392-L400](../../../../packages/sdk/src/connectors/channel.ts#L392-L400) - `stateOf`"
  - "[code://packages/sdk/src/connectors/channel.ts#L416-L431](../../../../packages/sdk/src/connectors/channel.ts#L416-L431) - `connectorRow`"
  - "[code://packages/sdk/src/connectors/channel.ts#L553-L645](../../../../packages/sdk/src/connectors/channel.ts#L553-L645) - `checkOne`, `note`, `close` and `openOne`"
  - "[code://packages/server/src/proxy/listener.ts#L834](../../../../packages/server/src/proxy/listener.ts#L834) - the model proxy's note, which keeps its call"
---

## Objective

A connector row carries `alerts` and no `health`.
A failed open raises one alert per gap, or one `open` alert, and the row's state is `failed`.
A check that is not `ok` raises `check`, and a failed call raises `call` until a call works.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts:258-266` - remove `ConnectorHealth`; `CallOutcome` stays for `note`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:150` - `ConnectorState` adds `failed`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:344-347` - replace `healths` with one `alertList` per id, and a map of each id's last check result.
- `UPDATE: packages/sdk/src/connectors/channel.ts:392-400` - `stateOf` answers `failed` for an id in `openFailures`, and `unauthorized` when the last check result is `denied`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:416-431` - `connectorRow` serves `alerts` when the list is not empty.
- `UPDATE: packages/sdk/src/connectors/channel.ts:553-571` - `checkOne` keeps the result and raises or clears `check`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:597-613` - `note` raises `call` for a failed call and clears it for one that worked.
- `UPDATE: packages/sdk/src/connectors/channel.ts:616-645` - `close` drops the list; `openOne` raises the gap alerts or `open`, and clears them on a good open.
- `UPDATE: packages/sdk/src/index.ts` - stop exporting `ConnectorHealth`.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the cases in *Validation*.
- `UPDATE: docs/plugins/PLUGINS.md:1740-1832` - the connector row's `alerts`, the refs, the state `failed`, and what `note` does.
- `UPDATE: docs/plugins/WEBHOOKS.md:49` - a `failed` connector answers 404, as an `invalid` one does.
- `UPDATE: docs/updates/v0_15.md` - the connector half of task 02's lines.

## Steps

1. Add `failed` to `ConnectorState`, and remove `ConnectorHealth` and its export.
2. Keep an `alertList` per id, and each id's last check result apart from it.
3. In `openOne`, raise one `error` alert per gap of `RecordGaps`, or one `open` alert; clear them on a good open.
4. Make `stateOf` answer `failed` for an id in `openFailures`, and `unauthorized` from the last check result.
5. In `checkOne`, raise `check` with level `error` for `denied` and `warning` for `unreachable` or `failed`; clear it on `ok`.
6. In `note`, raise `call` with level `warning` for a failed call, and clear it for a call that worked.
7. In `close`, drop the list and the last check result.
8. Serve `alerts` on the row, and no `health` key.
9. Update the docs and the release notes.
10. Write the tests.

## Validation

- `packages/sdk/test/connectors-channel.test.ts`: a connector with a missing vault secret is `failed` with a `secret:` alert.
- A check that answers `denied` makes the row `unauthorized` with a `check` alert of level `error`.
- A failed `note` raises `call`, and a later `note` with `ok: true` clears it.
- A check alert and a call alert show together.
- No row has a `health` key.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes, then `packages/server`.

## Resume

---
title: A data event sets a value
status: done
depends: [task-02-a-record-shows-its-views.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/resources/recordschannel.ts#L87-L96](../../../../packages/sdk/src/resources/recordschannel.ts#L87-L96) - `RecordsChannel`, which gains `notify`"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L207-L262](../../../../packages/sdk/src/resources/recordschannel.ts#L207-L262) - `send` and `apply`: who may read an action, and the `last` record each refresh compares"
  - "[code://packages/sdk/src/types/plugin.ts#L943-L963](../../../../packages/sdk/src/types/plugin.ts#L943-L963) - `showView` and `clearView` on the plugin host, beside which `setViewData` goes"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1043-L1049](../../../../packages/sdk/src/plugins/plugins.ts#L1043-L1049) - the `showView` and `clearView` hooks"
  - "[code://packages/server/src/plugins.ts#L1922-L1935](../../../../packages/server/src/plugins.ts#L1922-L1935) - `setView` and `dropView`"
  - "[code://packages/server/src/plugins.ts#L2083-L2084](../../../../packages/server/src/plugins.ts#L2083-L2084) - the plugin host's `showView` and `clearView`"
  - npm://@softov/scena@0.5.18 - `surface:update` with a `path` and a `value`, which a client applies
---

## Objective

`setViewData(path, value, surface?)` sets one value of a view's data model, on the plugin host and on a record's handle.
The channel sends `<scheme>/viewData` `{ id, surface, path, value }` to each reader of that record, and does not send the row again.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:943-963` - `PluginHost` and `ViewHandle` gain `setViewData`.
- `UPDATE: packages/sdk/src/plugins/views.ts` - one function sets a value at a path, for the plugin host and the records.
- `UPDATE: packages/sdk/src/resources/recordschannel.ts:87-262` - `notify(id, action)` sends one action to each reader of a record.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - `setViewData` sends `x-ahpd-connectors/viewData`.
- `UPDATE: packages/sdk/src/agents/channel.ts` - `setViewData` sends `x-ahpd-agents/viewData`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1043-1049` - a `setViewData` hook beside `showView` and `clearView`.
- `UPDATE: packages/server/src/plugins.ts:1922-1935` - the plugin's view keeps the value, as `setView` keeps a view.
- `UPDATE: packages/server/src/plugins.ts:2083-2084` - the plugin host's `setViewData`.
- `UPDATE: packages/server/src/pluginschannel.ts` - `setViewData` sends `x-ahpd-plugins/viewData`.
- `UPDATE: packages/sdk/test/recordschannel.test.ts` - the `notify` cases.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the data event cases.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - the same cases for an agent.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - the plugin host's data event.

## Steps

1. Add `setViewData(path, value, surface?)` to `PluginHost` and `ViewHandle`.
2. Write in its doc that it sets one value, and that a path of `/` replaces the whole model.
3. Add to `views.ts` one function that sets a value at a path of a data model.
4. Refuse a path that is not `/` or `/a/b`, and a value that is not JSON.
5. Refuse a surface with no view, and a result over 64 KiB.
6. Send each refusal to the problem log, and keep the data as it was.
7. Add `notify(id, action)` to `RecordsChannel`.
8. Make `notify` reach each reader of that id, with the checks that `send` uses.
9. Make `notify` update the record in `last`, so the next refresh sends no `changed` for it.
10. Send `<scheme>/viewData` from the connectors, agents and plugins channels.
11. Make the plugin host's `setViewData` keep the value in the plugin's view.

## Validation

- `recordschannel.test.ts`: `notify` reaches a reader of the record, and not a reader who cannot read it.
- `recordschannel.test.ts`: the refresh after a `notify` sends no `changed` for that record.
- `connectors-channel.test.ts`: `setViewData` sends `viewData` once, and the row is not sent again.
- `connectors-channel.test.ts`: a new subscriber reads the new value in `views.main.dataModel`.
- `connectors-channel.test.ts`: a path of `/` replaces the whole model.
- `connectors-channel.test.ts`: the channel refuses a bad path, a surface with no view, and a result over 64 KiB.
- `agents-channel.test.ts`: the same cases for an agent.
- `plugins-channel.test.ts`: the plugin host's `setViewData` sends `x-ahpd-plugins/viewData`, and the plugin row holds the value.
- `pnpm typecheck` and `pnpm boundary` pass.
- `pnpm exec vitest run packages/sdk/` and `pnpm exec vitest run packages/server/` pass, one at a time.

## Resume

Done. `setViewData` is on `PluginHost` and on `ViewHandle`.
`withViewData` in `views.ts` sets a value at a path for the records and for the server's plugin views.
`RecordsChannel.notify(id, action, change)` sends one action to each reader who holds the record.
`change` applies the same change to the last record sent, so the next refresh sends no `changed`.
The connectors, agents and plugins channels send `<scheme>/viewData`.

Verified: `recordschannel.test.ts` passes 28 tests, and the data event cases pass in the connectors, agents and plugins channel tests.
`pnpm typecheck` and `pnpm boundary` are clean.
`pnpm exec vitest run packages/sdk/` passes 4298 tests with 4 skipped, and `packages/server/` passes 1804 with 3 skipped.

Found: the tunnels channel builds its `RecordsChannel` by hand, so it passes `notify` through.
`packages/server/src/commands/run.ts` connects the plugin host's `viewData` to the plugins channel.
A record's handle sends a refusal to the problem log, and the plugin host's `setViewData` throws, as its `showView` does.

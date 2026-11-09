---
title: A record shows its views
status: done
depends: [task-01-a-view-takes-a-data-model.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L943-L963](../../../../packages/sdk/src/types/plugin.ts#L943-L963) - `showView` and `clearView`, the calls that `ViewHandle` copies"
  - "[code://packages/sdk/src/types/connectors.ts#L28-L56](../../../../packages/sdk/src/types/connectors.ts#L28-L56) - `CapabilityType`, where `ui` becomes `view`"
  - "[code://packages/sdk/src/types/connectors.ts#L447-L500](../../../../packages/sdk/src/types/connectors.ts#L447-L500) - `Adapter.open`, which gets the handle"
  - "[code://packages/sdk/src/types/agents.ts#L105-L151](../../../../packages/sdk/src/types/agents.ts#L105-L151) - `Engine.open`, which gets the handle"
  - "[code://packages/server/src/plugins.ts#L1922-L1935](../../../../packages/server/src/plugins.ts#L1922-L1935) - `setView` and `dropView`, the shape a record's views copy"
  - "[code://packages/sdk/src/connectors/channel.ts#L399](../../../../packages/sdk/src/connectors/channel.ts#L399) - the connector row"
  - "[code://packages/sdk/src/agents/channel.ts#L300](../../../../packages/sdk/src/agents/channel.ts#L300) - the agent row"
  - git://c21ad3d1 - #248's `uiFor`, whose lifecycle the holder keeps: one handle for each opening, and an old handle writes nothing
---

## Objective

A connector and an agent show views by surface, from a `ViewHandle` that `open` hands the plugin.
Their rows carry `views`, as a plugin row does, and the `view` capability names the surfaces a record may show.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - add `ViewHandle`, with `showView` and `clearView` as `PluginHost` has them; `UiHandle` goes.
- `UPDATE: packages/sdk/src/types/connectors.ts:28-56` - the type `ui` becomes `view`, and `Capability.ui` goes.
- `UPDATE: packages/sdk/src/types/connectors.ts:447-500` - `open(connector, view?: ViewHandle)`.
- `UPDATE: packages/sdk/src/types/agents.ts:105-151` - `open(record, view?: ViewHandle)`, and the `capabilities` list that #248 added.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - a `view` capability's name is a surface the host knows, `main` now.
- `CREATE: packages/sdk/src/plugins/views.ts` - the views of each record by id and surface, and the handle that changes them.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - the holder replaces `uis`, `uiFor` and `uiProblem`, and the row carries `views`.
- `UPDATE: packages/sdk/src/agents/channel.ts` - the same change as the connectors channel.
- `UPDATE: packages/sdk/src/index.ts` - export `ViewHandle`; the export of `UiHandle` goes.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - #248's `ui` cases become view cases.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - the same cases for an agent.
- `UPDATE: packages/sdk/test/plugin-validate.test.ts` - the `view` capability cases.
- `UPDATE: packages/sdk/test/engines-channel.test.ts` - the engine row carries a `view` capability.

## Steps

1. Add `ViewHandle` to `types/plugin.ts` with `showView(view, surface?)` and `clearView(surface?)`.
2. Write in its doc that the handle names one record and nothing else.
3. Remove `UiHandle`.
4. Rename the capability type `ui` to `view`, and remove `Capability.ui`.
5. Write in the doc of `Capability` that a `view` capability's `name` is the surface a record shows.
6. Change `Adapter.open` and `Engine.open` to take `view?: ViewHandle`.
7. Refuse a `view` capability whose name is not a surface the host knows.
8. Create `views.ts` with one holder that keeps the views of each record by id and surface.
9. Make the holder check each view with `checkView`.
10. Make the holder refuse a surface that no `view` capability of the adapter or engine names.
11. Make each opening get its own handle, and make an old handle write nothing.
12. Remove a record's views at a close, a removal, or an unload of its plugin.
13. Use the holder in the connectors channel and the agents channel.
14. Make the connector row and the agent row carry `views` by surface, in place of `ui`.
15. Search `packages/` for `UiSchema`, `UiComponent`, `UiHandle`, `checkUi`, `uiFor` and `uiProblem`, and remove each one left.

## Validation

- `connectors-channel.test.ts`: `showView` puts `views.main` on the row, and a subscriber gets the changed row.
- `connectors-channel.test.ts`: a second `showView` replaces the view, and `clearView` removes it.
- `connectors-channel.test.ts`: a close and a removal remove the views, and the old handle writes nothing.
- `connectors-channel.test.ts`: the holder refuses a view on a surface that no capability names, and the row keeps what it held.
- `agents-channel.test.ts`: the same cases, and an unloaded engine removes the views.
- `plugin-validate.test.ts`: a `view` capability named `main` registers on an adapter and on an engine.
- `plugin-validate.test.ts`: the check refuses a `view` capability with another name.
- `engines-channel.test.ts`: the engine row carries its `view` capability.
- `rg -n "UiSchema|UiComponent|UiHandle|checkUi|uiFor|uiProblem" packages/` finds nothing.
- `pnpm typecheck` and `pnpm boundary` pass.
- `pnpm exec vitest run packages/sdk/` passes.

## Resume

Done. `ViewHandle` has `showView`, `setViewData` and `clearView`, and `UiHandle` is removed.
The capability type `ui` is `view`, and a `view` capability's name must be a surface in `VIEW_SURFACES`.
`plugins/views.ts` holds `recordViews`: the views of each record by id and surface, one handle for each opening.
The connectors channel and the agents channel use it, and their rows carry `views`.

Verified: `connectors-channel.test.ts` passes 62 tests, `agents-channel.test.ts` 41, `plugin-validate.test.ts` 38 and `engines-channel.test.ts` 6.

Found: a Button in a record's view needs the methods of its plugin for `checkView`.
`ServedAdapter` and `ServedEngine` have `methods` now, the plugin's own map, which `registerAdapter` and `registerEngine` set.
`types/connectors.ts` and `plugins/plugins.ts` changed for it, beside the task's *Files*.

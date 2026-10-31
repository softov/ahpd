---
title: The row carries the view
status: implemented
depends:
  - task-01-a-plugin-gives-a-view.md
layer: server
refs:
  - "[code://packages/server/src/plugins.ts#L1815-L1860](../../../../packages/server/src/plugins.ts#L1815-L1860) - `alerted`, `addAlert` and `dropAlert`"
  - "[code://packages/server/src/plugins.ts#L1998-L2003](../../../../packages/server/src/plugins.ts#L1998-L2003) - the sinks of one load"
  - "[code://packages/server/src/plugins.ts#L2107](../../../../packages/server/src/plugins.ts#L2107) - `alerts()` on the holdings"
  - "[code://packages/server/src/commands/run.ts#L1440-L1448](../../../../packages/server/src/commands/run.ts#L1440-L1448) - `alertsChanged`"
  - "[code://packages/server/src/pluginschannel.ts#L234-L280](../../../../packages/server/src/pluginschannel.ts#L234-L280) - `rowOf`"
  - "[code://packages/server/src/pluginschannel.ts#L315-L339](../../../../packages/server/src/pluginschannel.ts#L315-L339) - `translate`"
  - "[code://packages/server/test/plugins-channel.test.ts](../../../../packages/server/test/plugins-channel.test.ts) - the alert tests to copy"
---

## Objective

The server holds one view per surface of each plugin, and serves them as the field `views` on the plugin's row.
A new or cleared view sends the row again, in the reader's locale.

## Files

- `UPDATE: packages/server/src/plugins.ts:1815-1860` - add `viewed`, `setView` and `dropView`, next to `alerted`.
- `UPDATE: packages/server/src/plugins.ts:1998-2003` - add the sinks `showView` and `clearView`, with the `current.get(id) === self` check.
- `UPDATE: packages/server/src/plugins.ts:2107` - add `views()` to the holdings.
- `UPDATE: packages/server/src/plugins.ts:1656` - add the option `viewsChanged`.
- `UPDATE: packages/server/src/commands/run.ts:1440-1448` - add `viewsChanged`, which reads `views()` and refreshes the plugins channel.
- `UPDATE: packages/server/src/pluginschannel.ts:106` - add the option `views()`.
- `UPDATE: packages/server/src/pluginschannel.ts:234-280` - add `views` to the row of a loaded plugin that has a view.
- `UPDATE: packages/server/src/pluginschannel.ts:315-339` - translate the texts of each view.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - add the cases of this task.
- `UPDATE: docs/plugins/PLUGINS.md:1397-1412` - add `views` to the fields of a row.

## Steps

1. Add a map `viewed` from the plugin id to a map from the surface to its view.
2. In `setView(id, surface, view)`, replace the view and call `viewsChanged` when the load has answered.
3. In `dropView(id, surface)`, remove the view and call `viewsChanged` when there was one.
4. Remove the views of a plugin when its load starts again or it unloads, as for its alerts.
5. Add the sinks to the load, and drop a call from a host that is not `current`.
6. Serve `views()` as a copy, the same as `alerts()`.
7. Add `viewsChanged` in `run.ts`, next to `alertsChanged`.
8. In `rowOf`, add `views` to the row of a loaded plugin that has a view.
9. In `translate`, copy each view and translate each Text `text` and Link `label`.
10. Read each text at the path `['views', surface, componentId, prop]`, with the plugin's catalogs first.
11. Add a test that a view raised after the load sends the row again with `views.main`.
12. Add a test that a clear and a reload remove `views` from the row.
13. Add a test that a stale host cannot set a view.
14. Add a test that a reader with locale `pt` gets the translated text.
15. Document the field `views` in the table of a row.

## Validation

- `pnpm vitest run packages/server/test/plugins-channel.test.ts` passes, with the new cases.
- `pnpm vitest run packages/server/test` passes.
- `pnpm typecheck` is clean.

## Resume

Built on 2026-10-31, and not committed: `git add` is refused in this session, so the task waits with task 01.
The server holds one view per surface of each plugin in `viewed`, and serves them as `views` on the row of a loaded plugin.
`setView` and `dropView` say `viewsChanged` once the load has answered, and a reload or an unload removes the views.
`translate` replaces a Text's `text` and a Link's `label` with the reader's catalog at `views.<surface>.<componentId>.<prop>`.
`packages/server/test/plugins-channel.test.ts` holds three cases for this task, and the server suite passes.
Files to commit: `packages/server/src/plugins.ts`, `packages/server/src/commands/run.ts`, `packages/server/src/pluginschannel.ts`, `packages/server/test/plugins-channel.test.ts` and `docs/plugins/PLUGINS.md`.
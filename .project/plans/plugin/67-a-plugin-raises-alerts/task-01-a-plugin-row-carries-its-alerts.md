---
title: A plugin row carries its alerts
status: done
depends: []
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L761-L773](../../../../packages/sdk/src/types/plugin.ts#L761-L773) - `problem(line)` on `PluginHost`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L868-L874](../../../../packages/sdk/src/plugins/plugins.ts#L868-L874) - where a `problem` line goes"
  - "[code://packages/server/src/plugins.ts#L1339](../../../../packages/server/src/plugins.ts#L1339) - `told` and the log after load"
  - "[code://packages/server/src/plugins.ts#L1737-L1744](../../../../packages/server/src/plugins.ts#L1737-L1744) - `failed`, by plugin id"
  - "[code://packages/server/src/pluginschannel.ts#L234-L252](../../../../packages/server/src/pluginschannel.ts#L234-L252) - the row"
---

## Objective

`host.alert`, `host.clearAlert` and `host.problem` put alerts on the plugin's row, with the loader's own lines, and a client reads them as `alerts`.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:761-773` - the `Alert` type, `alert(alert)` and `clearAlert(ref)` on `PluginHost`, and `problem` documented as a `warning` alert.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:868-874` - the host option takes an alert in place of a line.
- `UPDATE: packages/server/src/plugins.ts` - the plugin set keeps alerts by id in place of `failed`, and `loadOne` sends alerts there during and after `apply`.
- `UPDATE: packages/server/src/applyplugins.ts:94-97` - the loader lines of each plugin become alerts on that plugin, and still go to the log.
- `UPDATE: packages/server/src/pluginschannel.ts:70-82` - `loadProblemOf` masks every alert text.
- `UPDATE: packages/server/src/pluginschannel.ts:234-252` - the row carries `alerts` and no `loadProblem`.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - each `loadProblem` check reads the `error` alert.
- `UPDATE: docs/plugins/PLUGINS.md:809-815` - `alert`, `clearAlert` and `problem`.
- `UPDATE: docs/plugins/PLUGINS.md:1265-1276` - the `alerts` row field in place of `loadProblem`.

## Steps

1. Add `Alert` to the sdk as `{ level: 'notice' | 'info' | 'warning' | 'error'; text: string; ref?: string }`.
2. Add `alert(alert)` and `clearAlert(ref)` to `PluginHost`, and keep `problem(line)`.
3. Make `problem(line)` raise a `warning` alert with no `ref`.
4. Replace the `failed` map in the plugin set with alerts by plugin id.
5. Store the line that says a plugin did not load as an `error` alert.
6. Store every other loader line about a plugin as a `warning` alert on that plugin.
7. Replace an alert that has the same `ref` as a new one.
8. Keep at most 50 alerts on a plugin, and drop the oldest first.
9. Clear a plugin's alerts when it reloads or unloads.
10. Accept an alert after `apply` returns, and call the plugins channel `refresh`.
11. Mask each alert text with `loadProblemOf` before the row carries it.
12. Remove `loadProblem` from the row, and add `alerts` when the plugin has any.
13. Change each test that reads `loadProblem` to read the `error` alert.
14. Update the two `PLUGINS.md` sections.

## Validation

- `plugins-channel.test.ts`: a plugin that throws in `apply` has one `error` alert, and the masking tests still pass on its text.
- A new test: a plugin that calls `problem` in `apply` loads.
- The same test: its row has one `warning` alert with that text.
- A new test: `alert` after `apply` with the same `ref` twice leaves one alert, and `clearAlert` takes it out.
- A new test: a reload clears the alerts, and 60 alerts leave the newest 50.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- By hand, in a test daemon: add a piece that does not exist to the Activepieces options.
- The Activepieces row then has one `warning` alert.

## Resume

- **Done so far:** `Alert`, `PluginHost.alert` and `clearAlert` are in the sdk, and `problem(line)` raises a `warning` alert with no `ref`. The plugin set keeps alerts by id. One with the same `ref` replaces the one before it, and a plugin holds at most 50. The oldest goes first, and a reload or an unload clears them. Every loader line about a plugin is an alert. It is an `error` for the line that says it did not load, and a `warning` for the rest. An alert raised after the load answered calls `alertsChanged`. `loadPlugins` and `applyPlugins` answer `alerts`. The row carries `alerts`, masked by `loadProblemOf`, and no `loadProblem`. The three tests the plan names are in `plugins-channel.test.ts`. `run.ts` replaces its alerts list and refreshes the channel when one arrives late.
  The full gate passes: 425 files and 7026 tests, with 29 skipped.
- **Next action:** none, this task is implemented.
- **Files:** `packages/sdk/src/types/plugin.ts`, `packages/sdk/src/types/index.ts`, `packages/sdk/src/plugins/plugins.ts`, `packages/server/src/plugins.ts`, `packages/server/src/applyplugins.ts`, `packages/server/src/pluginschannel.ts`, `packages/server/src/commands/run.ts`, `packages/server/test/plugins-channel.test.ts`, `packages/server/test/plugin-load.test.ts`, `packages/tasks/test/tasks-meta.test.ts`, `packages/tasks/test/tasks-view.test.ts`, `packages/tasks/test/tasks-channel.test.ts`, `packages/tasks/test/tasks-plugin.test.ts`, `packages/tasks/test/tasks-approve.test.ts`, `packages/tasks/test/tasks-harnesses.test.ts`, `packages/tasks/test/tasks-plans.test.ts`, `packages/tasks/test/tasks-tasks.test.ts`, `packages/tasks/test/tasks-translate.test.ts`, `packages/bot/test/bot-chat.test.ts`, `packages/bot/test/bot-names.test.ts`, `packages/bot/test/bot-post.test.ts`, `packages/bot/test/bot-provider.test.ts`, `packages/sdk/test/plugin-host.test.ts`, `docs/plugins/PLUGINS.md`.
- **Open questions:** none.
- **Departures:** a plugin's `problem` line stays in the load's `problems` as well as on its row. So `ahpd start` and `ahpd restart` still print it as `skipped:`, and `daemon.json.skipped` still carries it; two end-to-end CLI tests assert that. Step 4 of the Files takes the line option out of the sdk. `loadOne` then hands `apply` a frozen copy of the host, with `problem` wrapped. The line goes to the loader and the host raises the alert. The set keeps the line once. A line said after `apply` returned still goes to the log as well as the row. The Files list does not name `run.ts`, `types/index.ts` or the tests of tasks, bot and sdk. The `Alert` export and the `alert` option need them. An alert with an existing `ref` is appended as the newest rather than left where it was. The two by-hand checks in the plan's checklist were not run.
- **Watch out for:** `row.problem` is the spec's config problem and stays. `alerts` is `[]` when a plugin has none. Each load has its own token, so a host that outlives its unload raises nothing. The channel reads a copy of the alerts, so a late alert has to be written back before a refresh. `run.ts` does that.

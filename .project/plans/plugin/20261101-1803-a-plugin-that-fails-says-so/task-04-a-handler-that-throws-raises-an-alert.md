---
title: A handler that throws raises an alert
status: todo
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L1834-L1863](../../../../packages/sdk/src/plugins/plugins.ts#L1834-L1863) - `raise`, whose `onProblem` gets the line and now the plugin"
  - "[code://packages/server/src/plugins.ts#L1844-L1880](../../../../packages/server/src/plugins.ts#L1844-L1880) - `alerted` and `addAlert`, which the holdings set exposes"
  - "[code://packages/server/src/commands/run.ts#L1808-L1821](../../../../packages/server/src/commands/run.ts#L1808-L1821) - `listening`, raised with `stamp`"
  - "[code://packages/server/src/commands/run.ts#L1954](../../../../packages/server/src/commands/run.ts#L1954) - `stopping`, raised with `stamp`"
---

## Objective

When a plugin's handler throws at an event the daemon raises, the plugin's row gets an `error` alert, and stderr keeps its line.

## Files

- `UPDATE: packages/sdk/src/plugins/plugins.ts:1834-1863` - `onProblem` gets `listener.by` as a second argument.
- `UPDATE: packages/server/src/plugins.ts:1844-1880` - the holdings set exposes `alert(id, alert)` over `addAlert`.
- `UPDATE: packages/server/src/commands/run.ts:1808-1821` - `listening` is raised with an `onProblem` that stamps and alerts.
- `UPDATE: packages/server/src/commands/run.ts:1954` - `stopping` uses the same `onProblem`.
- `UPDATE: packages/server/test/plugin-live.test.ts` - the cases in *Validation*.

## Steps

1. Change `onProblem` in `raise` to `(line: string, by: string) => void`, and pass `listener.by`.
2. Add `alert(id: string, alert: Alert): void` to the holdings set, over `addAlert`.
3. In `run.ts`, write one `onProblem` that calls `stamp(line)` and `pluginHoldings.alert(by, ...)`.
4. Give the alert `level: 'error'`, the `ref` `event:<type>` and a plain sentence.
5. Use that `onProblem` for `listening` and `stopping`, and for the late events of task 02.
6. Leave every other caller of `raise` as it is.

## Validation

- A plugin whose `listening` handler throws has an `error` alert with the `ref` `event:listening` on its row.
- The same throw still writes its line on stderr.
- A second throw at the same event replaces the alert.
- `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/server test` pass, one at a time.

## Resume

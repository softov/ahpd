---
title: A snapshot follows the subscribe's view
status: done
depends:
  - task-01-the-cut-is-shown.md
layer: sdk
refs:
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/common/commands.ts - `SubscribeParams.view` and `SubscribeView.turns`
  - "[code://packages/sdk/src/sessions/paging.ts#L22-L56](../../../../packages/sdk/src/sessions/paging.ts#L22-L56) - `PAGE`, `tail` and `older`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L380-L434](../../../../packages/sdk/src/host/sessionmethods.ts#L380-L434) - `subscribe`, which drops `params.view`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L466-L476](../../../../packages/sdk/src/host/sessionmethods.ts#L466-L476) - `fetchTurns` with no cursor"
  - "[code://packages/sdk/src/host/snapshots.ts#L19](../../../../packages/sdk/src/host/snapshots.ts#L19) - the `snapshotOf` type"
  - "[code://packages/sdk/src/host/snapshots.ts#L73](../../../../packages/sdk/src/host/snapshots.ts#L73) - `snapshotOf`"
  - "[code://packages/sdk/src/host/snapshots.ts#L322-L351](../../../../packages/sdk/src/host/snapshots.ts#L322-L351) - a live chat's snapshot"
  - "[code://packages/sdk/src/host/snapshots.ts#L411-L500](../../../../packages/sdk/src/host/snapshots.ts#L411-L500) - the three `tail` calls for a chat that is not running"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L278-L381](../../../../packages/sdk/test/host-catalogue.test.ts#L278-L381) - the paging cases"
  - "[code://packages/sdk/test/sessions.test.ts#L1182-L1203](../../../../packages/sdk/test/sessions.test.ts#L1182-L1203) - the oldest-page case"
---

## Objective

`subscribe` gives its `view` to `snapshotOf`, and every chat snapshot takes its turns through one function in `paging.ts`.
With no view, a chat that is not running gets every turn and no cursor.
With `view.turns`, it gets the newest `view.turns` turns, and a cursor when older turns are left.

## Files

- `UPDATE: packages/sdk/src/sessions/paging.ts:14-37` - `windowOf(turns, view)`, beside `tail`, and the `PAGE` comment says it is the size of a page and of a window.
- `UPDATE: packages/sdk/src/host/snapshots.ts:19` - `snapshotOf` takes an optional view.
- `UPDATE: packages/sdk/src/host/snapshots.ts:322-351` - a live chat's turns go through `windowOf`, after `linkedTurns`.
- `UPDATE: packages/sdk/src/host/snapshots.ts:411-500` - the three `tail` calls become `windowOf`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:380-434` - `subscribe` reads `params.view` and gives it to `snapshotOf`.
- `UPDATE: packages/sdk/src/host.ts:1127-1142` - the wrapper on `snapshotOf` takes the view and passes it on.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:466-476` - `fetchTurns` with no cursor answers with nothing older and sends no action.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:277-380` - the restored case of task 01 becomes `it`, and the paging cases subscribe with a view.
- `UPDATE: packages/sdk/test/sessions.test.ts:1182-1203` - the oldest-page case subscribes with a view and sends the cursor it got.

## Steps

1. Add `windowOf(turns, view)` to `paging.ts`, which returns `{ turns }` with every turn when `view` is `undefined`.
2. For a positive integer `view.turns`, make `windowOf` return `tail(turns, view.turns)`.
3. For any other `view.turns`, make `windowOf` return `tail(turns)`, the newest `PAGE`.
4. Add an optional `view` argument to `snapshotOf` in its type and in its body.
5. In `subscribe`, read `params.view` as a view only when it is an object, and give it to `snapshotOf`.
6. Give the wrapper on `snapshotOf` in `host.ts` the view, and pass it on to the snapshot's own function.
7. Leave the `snapshotOf` calls in `handshake.ts` without a view.
8. Replace the three `tail` calls in `snapshots.ts` with `windowOf` and the view.
9. In the live chat path, give `state.turns` to `windowOf` after `linkedTurns`, and set or delete `state.turnsNextCursor` from its answer.
10. Make the no-cursor branch of `fetchTurns` return `{}` and dispatch no action.
11. Change the restored case from task 01 from `it.fails` to `it`.
12. Make `opened()` in `host-catalogue.test.ts` subscribe with `view: { turns: 50 }`, so the paging cases keep cursor `70`.
13. Make the oldest-page case in `sessions.test.ts` subscribe with a view and send the cursor from its snapshot.
14. Add a case that sends `fetchTurns` with no cursor to a 120-turn chat, and expects `{}` and no `chat/turnsLoaded`.
15. Add a case that subscribes with `view: { turns: 20 }`, and expects 20 turns and cursor `100`.
16. Add a case that subscribes with `view: { turns: 0 }`, and expects 50 turns and cursor `70`.
17. Run the sdk tests, and set this task and its plan row to `implemented`.

## Validation

- `pnpm vitest run packages/sdk/test/host-catalogue.test.ts packages/sdk/test/sessions.test.ts` passes.
- The live Claude case from task 01 is still `it.fails`, because Claude's `chatState()` still cuts.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.
- `pnpm test` passes.

## Resume

Done 2026-10-28. `windowOf` is in `paging.ts`, beside `tail`, and `snapshotOf` takes an optional view. The three `tail` calls for a chat that is not running and the live chat path now go through `windowOf`. `subscribe` reads `params.view` when it is an object, and `fetchTurns` with no cursor answers `{}` and sends nothing. Step 6 and a Files line were added for `host.ts`: the wrapper on `snapshotOf` took three arguments, so it dropped the view. `opened()` in `host-catalogue.test.ts` takes `null` for a subscribe with no view, because its default of `{ turns: 50 }` applies when `undefined` is passed. The two sdk test files pass, 128 tests, and the live Claude case is still `it.fails`. `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass. `pnpm test` failed four cases in `packages/computer/test/computer-plugin.test.ts` under load, and `pnpm exec vitest run --maxWorkers=2 --testTimeout=20000` passed the full suite, 448 files and 7444 tests.

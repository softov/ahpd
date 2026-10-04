---
title: Past sessions and snapshots are their own files
status: done
depends: [task-01-catalogue.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L6397-L6556](../../../../packages/sdk/src/host.ts#L6397-L6556) - `history` to `past`"
  - "[code://packages/sdk/src/host.ts#L490](../../../../packages/sdk/src/host.ts#L490) - `LISTING_FRESH`"
  - "[code://packages/sdk/src/host.ts#L6557-L6931](../../../../packages/sdk/src/host.ts#L6557-L6931) - `value` and `snapshotOf`"
  - "[code://packages/sdk/src/host.ts#L431-L434](../../../../packages/sdk/src/host.ts#L431-L434) - `runState`, pure and read by `snapshotOf` only"
---

## Objective

`host/history.ts` exports `createHistory(ctx: HostContext): History` and `host/snapshots.ts` exports `createSnapshots(ctx: HostContext): Snapshots`, with the declarations above unchanged.

## Files

- `CREATE: packages/sdk/src/host/history.ts` - `LISTING_FRESH`, `history`, `reading`, `subHistory`, `restoredSubagents`, `restoredParentChat`, `linkedTurns`, `titles`, `listed`, `pastAt`, `listNow`, `catalogue`, `past`.
- `CREATE: packages/sdk/src/host/snapshots.ts` - `value`, `snapshotOf`.
- `CREATE: packages/sdk/src/host/automations.ts` - `runState` alone, which p8 adds the automation runtime to.
- `UPDATE: packages/sdk/src/host.ts` - those removed; history built after the catalogue, snapshots after history.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. `runState` is module-level in `host.ts`, which a new file cannot import without a cycle, so it moves now to `host/automations.ts`, the file p8 fills, and `snapshots.ts` imports it from there.
3. The factory's result is assigned onto `ctx`; `host.ts` destructures `past`, `history`, `subHistory`, `titles`, `catalogue`, `snapshotOf`, `value`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed; `test/subscribe.test.ts` and `test/wire.test.ts` read snapshots.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

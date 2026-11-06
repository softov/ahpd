---
title: A devtunnel shows key values
status: implemented
depends: [task-08-a-view-draws-a-gauge-and-a-time.md]
layer: "tunnel-devtunnel, sdk"
refs:
  - "[code://packages/tunnel-devtunnel/src/adapter.ts](../../../../packages/tunnel-devtunnel/src/adapter.ts) - `TUNNEL_VIEW`"
---

## Objective

A devtunnel connector shows its account and its last refresh as `KeyValue` lines, as a Claude login does.
The refresh time is a `DateTime`, so a client shows it in its reader's own zone.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/adapter.ts` - `TUNNEL_VIEW` is two `KeyValue` lines, and the second one's value is a `DateTime`.
- `UPDATE: packages/sdk/src/plugins/view.ts` - the doc of `VIEW_KINDS` says a `KeyValue` may draw its `child` as its value.
- `UPDATE: docs/plugins/PLUGINS.md` - the same, for plugin authors.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-adapter.test.ts` - the view's lines, and the host check.

## Steps

1. Make the account line a `KeyValue` with the label `Account` and the value at `/account`.
2. Make the refresh line a `KeyValue` with the label `Last refresh` and a `DateTime` as its `child`.
3. Write that a `KeyValue` draws its `child` in place of `value`.

## Validation

- `tunnel-devtunnel-adapter.test.ts`: the view has the two lines, and it passes `checkView`.
- `pnpm exec vitest run packages/tunnel-devtunnel/` passes.
- By hand, once ahpw's `KeyValue` draws its `child`: the refresh shows in local time.

## Resume

Done. `pnpm exec vitest run packages/tunnel-devtunnel/` passes 55 tests.

Left: ahpw's `KeyValue` draws its `child` in place of `value`, in Softov's other session.

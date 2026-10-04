---
title: applyDispatch is one file
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L9876-L11478](../../../../packages/sdk/src/host.ts#L9876-L11478) - `applyDispatch`"
  - "[code://packages/sdk/src/host.ts#L584](../../../../packages/sdk/src/host.ts#L584) - `dispatchable`"
---

## Objective

`host/actions.ts` exports a per-connection factory returning `applyDispatch`, whose body is today's, and `applyNow` in `accept` calls it.

## Files

- `CREATE: packages/sdk/src/host/actions.ts` - `dispatchable` and `applyDispatch`.
- `UPDATE: packages/sdk/src/host.ts:9876-11478` - removed; the factory built in `accept` after the method tables.

## Steps

1. Move `applyDispatch` with every comment inside it, unchanged but for indentation.
2. What the body reads comes off `ctx` and the `ConnectionContext`; `alive` is a field on the `ConnectionContext`, read as `conn.alive`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

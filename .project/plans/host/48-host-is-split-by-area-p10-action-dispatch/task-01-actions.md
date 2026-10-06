---
title: applyDispatch is one file
status: done
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

Built 2026-10-04. `packages/sdk/src/host/actions.ts` (1,664 lines) holds `dispatchable` at module level and `applyDispatch` whole, moved with every comment inside it. `accept` does `const { applyDispatch } = createActions(ctx, conn);` after the method tables, and `applyNow` calls it exactly as before.

`host.ts` is 1,141 lines.

Five names the body read were not on either context and had to be, which the plan did not say and the move made unavoidable:

- `refuse` on `HostContext`. `applyDispatch` builds `no` out of it, and `refuse` is per host - it reads `ctx.serverSeq` and the aliases of every connection. Its long comment stayed where it was, above the declaration in `host.ts`; the context field carries the short version.
- `lifeOf` and `restarting` on `HostContext`. Both are per host, both are read and written inside `applyDispatch`, and both were plain closure constants.
- `bounded` and `applyNow` on the `ConnectionContext`, assigned in `accept` right after `applyNow` is defined. They stay in `accept` as the plan's third `ref` says - the ordering of one connection's dispatches - and `applyDispatch` reaches them as `conn.bounded` and `conn.applyNow` rather than by destructuring, because the factory is built before either exists and a destructured copy would have been `undefined` for the life of the host.

`ctx.dispatch` was declared with two parameters and called with three in nine places. It is the host's own `dispatch`, whose third parameter defaults to the origin being applied, so the declaration was simply short; it now says so.

`annotationsReducer`, `IS_CLIENT_DISPATCHABLE`, `AnnotationsAction`, `Grant`, `HOSTS_OWN`, `dispatchNeeds`, `computerNeeds`, `ACTION_HOMES`, `HOME_WORDS`, `claimOf`, `join` and `accepts` left `host.ts` with the code that used them. `Home`, `chatReducer`, `Space`, `NameKind`, `UNGATED` and the rest of the dead list were already dead at `f1b3bd1` and were left alone.

Validation: `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` all pass, 176 files and 2,707 tests, with no test changed.

One wrong turn worth recording: the first wiring read `bounded` and `applyNow` off `conn` by destructuring at the point the factory was built, which is before either is assigned. Every refusal inside `applyDispatch` then threw `refuse is not a function` or silently did nothing, and 71 tests failed. Reading them as `conn.bounded` and `conn.applyNow` is the fix, and it is the same rule `ctx.serverSeq` follows: a mutable field is read off the object, never copied at construction.

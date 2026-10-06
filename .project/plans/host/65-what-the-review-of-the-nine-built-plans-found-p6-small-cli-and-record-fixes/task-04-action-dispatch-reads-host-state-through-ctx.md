---
title: Action dispatch reads host state through ctx
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/actions.ts#L31-L40](../../../../packages/sdk/src/host/actions.ts#L31-L40) - the destructuring"
  - "[code://packages/sdk/src/host/actions.ts#L350-L374](../../../../packages/sdk/src/host/actions.ts#L350-L374) - where the four are written, through `ctx`"
  - "[code://packages/sdk/src/host/context.ts#L140-L181](../../../../packages/sdk/src/host/context.ts#L140-L181) - the four mutable fields"
---

## Objective

`createActions` destructures no field of `ctx` that changes after the host is built: `advancedTools`, `contributed`, `contributing` and `restartNeeded` are read as `ctx.<name>` only.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:34-38` - drop the four from the destructuring. Today they are bound at factory time, while `actions.ts:350-374`, `tooling.ts:85-94` and `host.ts:828-829` reassign them on `ctx`; nothing reads the bare names yet, so a later read would see the value from when the connection opened.

## Steps

1. Remove the four names. No case can fail first, because no line reads them; the next one written would.

## Validation

- `pnpm typecheck` passes; `rg -nw "advancedTools|contributed|contributing|restartNeeded" packages/sdk/src/host/actions.ts` finds only `ctx.` reads and comments.

## Resume

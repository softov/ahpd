---
title: The tools and titles a session is offered are one file
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L5879-L6222](../../../../packages/sdk/src/host.ts#L5879-L6222) - `permitted`, `advancedTools`, `contributed`, `contributing`, `compactPrompts`, `strategies`, `strategyOf`, `shapedDefinition`, `toolDefinitions`, `clientTools`, `retool`, `chatMeant`, `moving`, `renameChat`, `toolContext`, `mcpFor`, `served`, `toolsServersGone`, `boundTools`, `instructions`"
  - "[code://packages/sdk/src/host.ts#L7308-L7311](../../../../packages/sdk/src/host.ts#L7308-L7311) - `Host.setTools`"
  - "[code://packages/sdk/src/host.ts#L10168-L10171](../../../../packages/sdk/src/host.ts#L10168-L10171) - the writer of `advancedTools`"
---

## Objective

`host/tooling.ts` exports `createTooling(ctx: HostContext): Tooling` with the declarations above unchanged, and `Host.setTools` and the `advancedTools` key behave as before.

## Files

- `CREATE: packages/sdk/src/host/tooling.ts` - the declarations above, but `moving`, `served` and `strategies`, which stay shared maps on the context, and the three `let`s, which become context fields.
- `UPDATE: packages/sdk/src/host.ts:5879-6222` - removed; `setTools` assigns `ctx.contributed` and `ctx.contributing`; the `advancedTools` writer reads and writes `ctx.advancedTools`.
- `UPDATE: packages/sdk/src/host/context.ts` - `advancedTools`, `contributed`, `contributing` and the tooling functions.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. Every read and write of the three `let`s, inside and outside the moved code, becomes `ctx.<name>`; those prefixes are the only lines outside the moved code that change.
3. `rootConfig` is `ctx.rootConfig`, the same object since p5.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

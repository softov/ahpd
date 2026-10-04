---
title: The automation runtime is one file
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L988-L1018](../../../../packages/sdk/src/host.ts#L988-L1018) - `origins`, `linked`, `settleRun`"
  - "[code://packages/sdk/src/host.ts#L2607-L2652](../../../../packages/sdk/src/host.ts#L2607-L2652) - the `onChanged` callback"
  - "[code://packages/sdk/src/host.ts#L7168-L7295](../../../../packages/sdk/src/host.ts#L7168-L7295) - `beginAutomation`, `startForAutomation`, the `onDue` callback"
  - "[code://packages/sdk/src/automations.ts#L30](../../../../packages/sdk/src/automations.ts#L30) - `memoryAutomations`, the store, which this file does not touch"
---

## Objective

`host/automations.ts`, which holds `runState` since p6, also exports `createAutomations(ctx: HostContext): Automations` with the declarations above, and both callbacks are registered from the same lines of `host.ts`.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts` - adds `origins`, `linked`, `settleRun`, `changed` (the `onChanged` callback's body), `beginAutomation`, `startForAutomation`, `due` (the `onDue` callback's body).
- `UPDATE: packages/sdk/src/host.ts` - those removed; `options.automations?.onChanged?.(automations.changed)` and `options.automations?.onDue?.(automations.due)` stay where the registrations are today.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. Each callback's arrow function becomes the named member, its body unchanged, and the comment above the registration moves with the body.
3. `starting` is a shared set on the context and `closed` a context field, both still written by `close` in `host.ts`; `startForAutomation` reads `ctx.closed` and `ctx.starting`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed; `test/automations.test.ts`, `test/scheduled.test.ts` and `test/host-close.test.ts` cover it.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

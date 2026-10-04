---
title: Opening, moving, restarting and removing a session is one file
status: todo
depends: [task-01-spawn.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L5100-L5554](../../../../packages/sdk/src/host.ts#L5100-L5554) - `removeSession` to `isolated`"
  - "[code://packages/sdk/src/host.ts#L5620-L5723](../../../../packages/sdk/src/host.ts#L5620-L5723) - `beginOrRun`, `beginTurn`"
  - "[code://packages/sdk/src/host.ts#L6932-L6990](../../../../packages/sdk/src/host.ts#L6932-L6990) - `modelIn`, `messageFrom`, `messageAttachments`"
  - "[code://packages/sdk/src/host.ts#L7078-L7167](../../../../packages/sdk/src/host.ts#L7078-L7167) - `openSession`"
---

## Objective

`host/lifecycle.ts` exports `createLifecycle(ctx: HostContext): Lifecycle` with the declarations above unchanged.

## Files

- `CREATE: packages/sdk/src/host/lifecycle.ts` - `removeSession`, `restart`, `moveSession`, `restartChat`, `HOSTS_OWN`, `backendsOwn`, `isolated`, `beginOrRun`, `beginTurn`, `modelIn`, `messageFrom`, `messageAttachments`, `openSession`.
- `UPDATE: packages/sdk/src/host.ts` - those removed; the factory built after spawn.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. `BANG` is read by `beginOrRun` and by `initialize`; it is in `host/common.ts` since p1.
3. What the bodies read comes off `ctx`, and the area's offered fields are added to `host/context.ts`.
4. The factory's result is assigned onto `ctx`; `host.ts` destructures every function another area calls.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

---
title: The catalogue and its rows are one file
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1040-L1130](../../../../packages/sdk/src/host.ts#L1040-L1130) - the chat rows"
  - "[code://packages/sdk/src/host.ts#L1433-L1505](../../../../packages/sdk/src/host.ts#L1433-L1505) - a session's status and activity"
  - "[code://packages/sdk/src/host.ts#L2467-L2600](../../../../packages/sdk/src/host.ts#L2467-L2600) - the catalogue rows and their notifications, `learnModels`"
  - "[code://packages/sdk/src/host.ts#L4177-L4396](../../../../packages/sdk/src/host.ts#L4177-L4396) - `listing`, `waitingFor`, `readStored`"
---

## Objective

`host/catalogue.ts` exports `createCatalogue(ctx: HostContext): Catalogue` with the declarations above unchanged, and `readStored` is still scheduled from the same line of `host.ts`.

## Files

- `CREATE: packages/sdk/src/host/catalogue.ts` - `startedBy`, `chatSummary`, `subagentSummary`, `restoredSubagentSummary`, `statusOf`, `urgency`, `drivingOf`, `modifiedOf`, `activityOf`, `announced`, `activeSessionsMoved`, `changesOf`, `summaryOf`, `sessionAdded`, `summaryMoved`, `learnModels`, `listing`, `waitingFor`, `readStored`.
- `UPDATE: packages/sdk/src/host.ts` - those removed; the factory built after root.

## Steps

1. Move each declaration with its comment, unchanged but for indentation; `announced` is a `let` written only by `activeSessionsMoved`, so it moves with it.
2. What the bodies read comes off `ctx`: shared maps and options at the top of the factory, another area's functions and every `let` as `ctx.<name>` where used; the area's offered fields are added to `host/context.ts`.
3. The factory's result is assigned onto `ctx`; `host.ts` destructures every function another area calls, and `setTimeout(() => { void readStored(); }, 0)` stays at the same point of construction.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

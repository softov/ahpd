---
title: A session's changesets are one file
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2680-L2697](../../../../packages/sdk/src/host.ts#L2680-L2697) - `dirOf`"
  - "[code://packages/sdk/src/host.ts#L2720-L2997](../../../../packages/sdk/src/host.ts#L2720-L2997) - `catalogueOf`, `changesetAt`, `changesetOf`, `inFlight`, `lastError`, `opKey`, `operationContext`, `operationsOf`, `operationsMoved`, `shown`, `sameFiles`, `told`, `contentMoved`, `changesetsOf`"
---

## Objective

`host/changesets.ts` exports `createChangesets(ctx: HostContext): Changesets` with the functions above, and `host.ts` calls them through it.

## Files

- `CREATE: packages/sdk/src/host/changesets.ts` - the offered interface and the declarations above; the area's fields are added to `host/context.ts`.
- `UPDATE: packages/sdk/src/host.ts:2680-2997` - removed but for `logs` and `stateFileOf`; the factory built after routing.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. `inFlight`, `lastError` and `shown` move into the factory.
3. The factory's result is assigned onto `ctx`; `host.ts` destructures `dirOf`, `changesetAt`, `changesetOf`, `operationsMoved`, `contentMoved`, `changesetsOf`, `catalogueOf`, `operationContext`, `opKey`, `inFlight`, `lastError` under their own names for the callers that stay.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

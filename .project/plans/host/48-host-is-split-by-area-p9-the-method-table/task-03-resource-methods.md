---
title: The resource methods are one file
status: todo
depends: [task-01-the-classification-test-reads-every-file.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7470-L7493](../../../../packages/sdk/src/host.ts#L7470-L7493) - `storeFor`"
  - "[code://packages/sdk/src/host.ts#L8484-L8512](../../../../packages/sdk/src/host.ts#L8484-L8512) - `resourceList`, `resourceRead`"
  - "[code://packages/sdk/src/host.ts#L8708-L8995](../../../../packages/sdk/src/host.ts#L8708-L8995) - `createResourceWatch` to `resourceResolve`, `invokeChangesetOperation` among them; `fetchAutomationRuns` at the top of the range is not this file's"
  - "[code://packages/sdk/src/host.ts#L118](../../../../packages/sdk/src/host.ts#L118) - `WRITE_MODES`, read by `resourceWrite` only"
---

## Objective

`host/resourcemethods.ts` exports a per-connection factory that offers `storeFor` and returns the resource methods, unchanged.

## Files

- `CREATE: packages/sdk/src/host/resourcemethods.ts` - `WRITE_MODES`, `storeFor`, `resourceList`, `resourceRead`, `createResourceWatch`, `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove`, `resourceCopy`, `resourceRequest`, `invokeChangesetOperation`, `resourceResolve`.
- `UPDATE: packages/sdk/src/host.ts` - those removed; the factory built before `createAdmission`, which is handed its `storeFor`.

## Steps

1. Move each method with its comment, unchanged but for indentation.
2. `storeFor` is built before the admission factory, which reads it.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/resource-write.test.ts`, `test/writes.test.ts`, `test/uri-resources.test.ts`, `test/watches.test.ts`, `test/operations.test.ts` cover it.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

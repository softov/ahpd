---
title: The resource methods are one file
status: done
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

Built 2026-10-04. `packages/sdk/src/host/resourcemethods.ts` (356 lines) holds `WRITE_MODES`, `storeFor` and the eleven resource methods, moved by name rather than by line range, so `fetchAutomationRuns` - which sits between `authenticate` and `createResourceWatch` in the literal - stayed where it was for task 05.

`host.ts` is 4,227 lines.

The factory returns `{ storeFor, methods }` rather than one flat table, because `storeFor` is offered to `createAdmission` and must not become a method a client can call. `accept` does `const { storeFor, methods } = createResourceMethods(ctx, conn); conn.storeFor = storeFor;` before the admission factory is built, and spreads `...methods` after `...handshake`.

`notServed`, `schemeOf` and the `WriteMode` type left `host.ts` with the code that used them; `PROXY_ENV`, `PROBE_TIMEOUT` and `MAX_BODY` stay until task 05 takes them, since `resolved` at module level still reads `PROBE_TIMEOUT`.

Validation: `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` all pass, 176 files and 2,707 tests. `users-gate.test.ts` still finds the 45 task 01 recorded.

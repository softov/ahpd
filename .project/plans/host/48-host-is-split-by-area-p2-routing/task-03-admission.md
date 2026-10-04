---
title: A connection's gate is one file
status: todo
depends: [task-01-routing.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7494-L7697](../../../../packages/sdk/src/host.ts#L7494-L7697) - `read`, `capabilityFor`, `ownRecord`, `excusedBy`, `denied`, `admit`"
  - "[code://packages/sdk/src/host.ts#L7484-L7493](../../../../packages/sdk/src/host.ts#L7484-L7493) - `storeFor`, which `excusedBy` asks and which stays in `accept` until p9"
---

## Objective

`host/admission.ts` exports `createAdmission(ctx: HostContext, conn: ConnectionContext): Admission`, built once per connection in `accept`, and `admit` answers exactly as it does today.

## Files

- `CREATE: packages/sdk/src/host/admission.ts` - `Admission`, and `read`, `capabilityFor`, `ownRecord`, `excusedBy`, `denied`, `admit`.
- `UPDATE: packages/sdk/src/host.ts:7494-7697` - removed; in `accept`, the `ConnectionContext` (`connection`, `storeFor`) is built and `const { admit } = createAdmission(ctx, conn)` follows it.
- `UPDATE: packages/sdk/src/host/context.ts` - `storeFor` on `ConnectionContext`.

## Steps

1. Move the declarations with their comments, unchanged but for indentation.
2. Keep the comment above `capabilityFor` that names `NEEDS`, `subscribe` and the resource methods with `capabilityFor`.
3. `NEEDS` is imported from `./gate.js`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/users-gate.test.ts` and `test/people.test.ts` cover the gate.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

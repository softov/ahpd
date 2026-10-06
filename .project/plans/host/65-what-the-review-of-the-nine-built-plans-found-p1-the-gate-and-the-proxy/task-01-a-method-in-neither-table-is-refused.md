---
title: A method in neither table is refused
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/admission.ts#L113-L114](../../../../packages/sdk/src/host/admission.ts#L113-L114) - `capabilityFor` answers `undefined` for a method with no `NEEDS` entry"
  - "[code://packages/sdk/src/host/admission.ts#L237-L239](../../../../packages/sdk/src/host/admission.ts#L237-L239) - `admit` admits `undefined`"
  - "[code://packages/sdk/src/host/gate.ts#L9-L23](../../../../packages/sdk/src/host/gate.ts#L9-L23) - the comment that says a method with no entry is served to anybody"
  - "[code://packages/sdk/src/host.ts#L912](../../../../packages/sdk/src/host.ts#L912) - `handlers`"
  - "[code://packages/sdk/test/users-gate-tables.test.ts#L23-L55](../../../../packages/sdk/test/users-gate-tables.test.ts#L23-L55) - the regex the test reads handlers with"
---

## Objective

On a host with a users directory, a served method that is in neither `NEEDS` nor `UNGATED` is refused with `-32009`, and the classification test lists every key of the handler table a connection is served from.

## Files

- `UPDATE: packages/sdk/src/host/admission.ts:113-114,239` - a method in neither table is refused; today `capabilityFor` returns `undefined` for it and `admit` serves it to any connection that completed a handshake.
- `UPDATE: packages/sdk/src/host/gate.ts:9-23` - the comment says a method with no entry is refused; today it says it is served.
- `UPDATE: packages/sdk/src/host.ts:912` - the handler table's keys reachable by a test (an export of the names, or the table built for one connection); today they exist only inside `createHost`.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts:23-55` - reads those keys; today `handlerKeys` needs a `(params)` parameter, so `ping`, `shutdown`, `getManagedSettingsDiagnostics` and `getNetworkDiagnosticsInfo` are never read, and `SERVED = 45` counts only what the regex sees.
- `UPDATE: packages/sdk/test/users-gate-commands.test.ts` - the case below.

## Steps

1. Failing case first, in `users-gate-commands.test.ts`: a host with a users directory and a `diagnostics.shutdown` spy; a connection that has not signed in sends `shutdown`. Today it answers `{}` and the spy is called, which in the daemon is `SIGTERM`; after, it is refused and the spy is not called.
2. Change the classification test to read the handler table's keys, and see it fail naming `shutdown` and `getManagedSettingsDiagnostics`.
3. In `capabilityFor`, a method in `UNGATED` answers no grant; a method in neither table is refused `-32009` naming the method, before any handler runs.
4. A method the host does not serve keeps its `-32601`, which is answered before the gate (host.ts:1030-1035).

## Validation

- The case in step 1 and the test in step 2 fail on `e1c4ccc`; both pass once task 02 classifies the two methods.
- `pnpm exec vitest run packages/sdk/test/users-gate-*.test.ts`.

## Resume

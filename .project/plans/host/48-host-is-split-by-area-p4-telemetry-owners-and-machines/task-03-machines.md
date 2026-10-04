---
title: The machine a session runs in is one file
status: todo
depends: [task-02-owners.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1745-L1807](../../../../packages/sdk/src/host.ts#L1745-L1807) - `sessionMachines`, `enteredIn`, `inMachine`, `leaveForgotten`"
  - "[code://packages/sdk/src/host.ts#L4752-L4808](../../../../packages/sdk/src/host.ts#L4752-L4808) - `machineFor`, `admitted`"
  - "[code://packages/sdk/src/host.ts#L5555-L5631](../../../../packages/sdk/src/host.ts#L5555-L5631) - `placedIn`"
---

## Objective

`host/machines.ts` exports `createMachines(ctx: HostContext): Machines` with the declarations above; the per-connection dev container relay is not here and moves in p9.

## Files

- `CREATE: packages/sdk/src/host/machines.ts` - the declarations above.
- `UPDATE: packages/sdk/src/host.ts` - those removed; the factory built after owners.

## Steps

1. Move each declaration with its comment, unchanged but for indentation; `sessionMachines` and `enteredIn` move into the factory.
2. It reads `options.computers`, `openComputer`, `machineRefusal`, `checked`, `kept` and `log`.
3. The factory's result is assigned onto `ctx`; `host.ts` destructures `inMachine`, `leaveForgotten`, `machineFor`, `admitted`, `placedIn`, `sessionMachines`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed; `test/machine-*.test.ts`, `test/computer-count.test.ts` and the `packages/computer/test/` suites cover it.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

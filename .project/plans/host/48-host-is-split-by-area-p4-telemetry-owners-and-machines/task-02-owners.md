---
title: Owners and charging are one file
status: todo
depends: [task-01-telemetry-and-auth.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L4630-L4750](../../../../packages/sdk/src/host.ts#L4630-L4750) - `charged`, `ownerFor`, `principals`, `principalFor`, `forWhom`, `senders`, `senderOf`, `charge`, `checked`"
  - "[code://packages/sdk/src/host.ts#L4809-L4885](../../../../packages/sdk/src/host.ts#L4809-L4885) - `scoping`, `settle`"
  - "[code://packages/sdk/src/host.ts#L7369](../../../../packages/sdk/src/host.ts#L7369) - `accept` writes `principals` for a connection handed a principal"
---

## Objective

`host/owners.ts` exports `createOwners(ctx: HostContext): Owners` with the declarations above, and every writer of `principals`, `senders` and `charged` writes the same map through it.

## Files

- `CREATE: packages/sdk/src/host/owners.ts` - the declarations above.
- `UPDATE: packages/sdk/src/host.ts:4630-4885` - removed but for `machineFor` and `admitted` (task 03); the factory built after telemetry.

## Steps

1. Move each declaration with its comment, unchanged but for indentation.
2. `checked` reads `options.policies`, `options.policiesCheck` and `decide`; `charge` reads `kept`, `options.users` and `scopeFor`; `settle` reads `scoping` and `ctx.isolating` (p5).
3. The factory's result is assigned onto `ctx`; `host.ts` destructures `ownerFor`, `principals`, `principalFor`, `forWhom`, `senders`, `senderOf`, `charge`, `charged`, `checked`, `scoping`, `settle`.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed; `test/session-scope.test.ts`, `test/usage-meter.test.ts`, `test/policy-checks.test.ts` cover it.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

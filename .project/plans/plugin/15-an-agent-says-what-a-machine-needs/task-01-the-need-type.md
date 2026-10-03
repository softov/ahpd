---
title: The SDK has machine() and the need type
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L335-L353](../../../../packages/sdk/src/types/agent.ts#L335-L353) - `Agent`, where `machine?()` sits after `defaults()`"
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts) - the need types"
  - "[code://packages/sdk/src/validate.ts#L72](../../../../packages/sdk/src/validate.ts#L72) - `machine` checked as an optional function"
---

## Objective

`Agent.machine?()` answers `Record<string, MachineNeed>`, where a need is a mount (`directory` or `file`, `target`, `readOnly`), an env value (`name`) or a copy-in (`source`, `target`), each with an optional `default`, `required` and `description`.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - `machine?()`.
- `CREATE: packages/sdk/src/types/machine.ts` - `MachineNeed` and `ResolvedNeed`.
- `UPDATE: packages/sdk/src/index.ts` - the exports.

## Steps

1. Write the types with doc comments that say what each field is.
2. A `default` may name `~`; resolution expands it (task 02), the type does not.

## Validation

- `pnpm typecheck`; a type test that a need of each kind is accepted and a mount without `target` is not.

## Resume

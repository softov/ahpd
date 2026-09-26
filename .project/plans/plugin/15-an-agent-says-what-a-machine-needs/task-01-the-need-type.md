---
title: The SDK has machine() and the need type
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L275-L283](../../../../packages/sdk/src/types/agent.ts#L275-L283) - `Agent`"
  - "[code://packages/sdk/src/types/computers.ts#L47-L49](../../../../packages/sdk/src/types/computers.ts#L47-L49) - the port"
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

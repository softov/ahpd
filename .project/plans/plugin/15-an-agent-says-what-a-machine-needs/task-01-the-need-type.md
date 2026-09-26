---
title: The SDK has machine() and the need type
status: implemented
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

Done 2026-09-26. `MachineNeed` is a union of `DirectoryNeed`, `FileNeed`, `EnvNeed` and `CopyNeed` in `packages/sdk/src/types/machine.ts`, with `ResolvedNeed` beside it; both are exported from `types/index.ts`. `Agent.machine?()` sits after `defaults()` in `types/agent.ts` and is checked as an optional function in `validate.ts`. The type test is in `test/machine-needs.test.ts`, where a mount with no `target` carries `@ts-expect-error`.

Found: a need carries its own host path in the field that names its kind (`directory`, `file`, `source`), so `default` is the env value and a further fallback; resolution expands `~` in either.

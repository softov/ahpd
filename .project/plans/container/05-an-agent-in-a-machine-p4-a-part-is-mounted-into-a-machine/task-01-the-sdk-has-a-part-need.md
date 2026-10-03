---
title: The SDK has a part need
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/machine.ts#L74-L78](../../../../packages/sdk/src/types/machine.ts#L74-L78) - the four kinds"
  - "[code://packages/sdk/src/machine.ts#L62-L106](../../../../packages/sdk/src/machine.ts#L62-L106) - `resolveNeeds`"
---

## Objective

`PartNeed { part: string }` is a fifth `MachineNeed`, `NeedKind` has `'part'`, and `resolveNeeds` answers `{ kind: 'part', source: <part id>, target: '/opt/ahpd/<part id>' }`.

## Files

- `UPDATE: packages/sdk/src/types/machine.ts` - the interface, with a comment saying what a part is.
- `UPDATE: packages/sdk/src/machine.ts` - resolution; a profile value for a part need names another part id.
- `UPDATE: packages/sdk/test/machine-needs.test.ts` - the new kind.

## Steps

1. Add the type and the kind; a part has no host path, so `~` and absolute-path checks do not apply.
2. A profile or option value replaces the part id, which is how a profile pins another build.

## Validation

- A part need resolves with its target; a profile value renames it.
- `pnpm --filter @ahpd/sdk test` and `pnpm typecheck` green.

## Resume

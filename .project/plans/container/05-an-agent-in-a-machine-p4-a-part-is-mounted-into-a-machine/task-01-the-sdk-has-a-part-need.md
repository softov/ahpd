---
title: The SDK has a part need
status: implemented
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

- Built 2026-10-05 on 2caabb1. `PartNeed { part }` is the fifth `MachineNeed` and `'part'` the fifth `NeedKind` in `packages/sdk/src/types/machine.ts`; `resolveNeeds` in `packages/sdk/src/machine.ts` answers `{ kind: 'part', source: <id>, target: '/opt/ahpd/<id>' }`, with the profile's, then the option's, then the default's value naming another part id, never expanded or looked for on the host. `partTarget` and `PART_ROOT` are exported from the SDK.
- Beyond the steps: a part id that is not a plain name (`../etc`) is refused naming the need and where the value came from, since it becomes a path inside the machine.
- Test: `packages/sdk/test/machine-needs.test.ts` "resolves a part to its place under /opt/ahpd, and a profile value names another part"; it failed before the change.

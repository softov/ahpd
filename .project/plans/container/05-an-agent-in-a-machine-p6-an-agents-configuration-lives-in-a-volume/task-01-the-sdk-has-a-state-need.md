---
title: The SDK has a state need, and a need may belong to one mode
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/machine.ts#L18-L94](../../../../packages/sdk/src/types/machine.ts#L18-L94) - the kinds, the common fields and `ResolvedNeed`"
  - "[code://packages/sdk/src/machine.ts#L62-L106](../../../../packages/sdk/src/machine.ts#L62-L106) - `resolveNeeds`"
---

## Objective

`StateNeed { state: string; seed?: { source: string; target?: string; keep?: string[]; drop?: string[] }[] }` is a need kind, any need may carry `when: 'host' | 'volume'`, and `resolveNeeds(…, mode)` drops the needs of the other mode.

## Files

- `UPDATE: packages/sdk/src/types/machine.ts` - `StateNeed`, `when`, `ResolvedNeed.seed`.
- `UPDATE: packages/sdk/src/machine.ts` - the mode argument, `~` expansion in seed sources.
- `UPDATE: packages/sdk/test/machine-needs.test.ts` - the cases below.

## Steps

1. A need without `when` belongs to both modes.
2. A seed `target` is relative to the state directory and defaults to the source's base name.
3. `keep` (top-level keys kept) and `drop` (dotted paths removed) are only valid on a JSON file; refuse them on a directory at resolution.

## Validation

- Mode `volume` keeps the state need and drops a `when: 'host'` need; mode `host` the reverse.
- A seed with `~` resolves to the home.

## Resume

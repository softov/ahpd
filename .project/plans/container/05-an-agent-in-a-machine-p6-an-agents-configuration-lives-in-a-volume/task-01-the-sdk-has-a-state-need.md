---
title: The SDK has a state need, and a need may belong to one mode
status: done
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

- Built 2026-10-05 on cecc459.
- `StateNeed`, `Seed`, `ResolvedSeed`, `StateMode`, `when` on every need, and `seed` and `provider` on `ResolvedNeed` are in `packages/sdk/src/types/machine.ts`; `resolveNeeds(needs, sources, home, mode = 'volume')` in `packages/sdk/src/machine.ts`.
- A state need belongs to `volume` alone, so mode `host` drops it, as the validation asks.
- A profile's or an option's value names another state directory; the directory is an absolute path inside the machine and is never looked for on the host.
- A seed source must be absolute once `~` is read, and a seed target stays inside the state directory.
- A seed whose `keep` or `drop` names `__proto__`, `constructor` or `prototype` is refused in `seedsOf` (2026-10-06).
- Tests in `packages/sdk/test/machine-needs.test.ts` (3 new, and the prototype keys added to the refusal case), each failing before the change.

---
title: The listing gives each id to one harness
status: done
depends: [task-01-the-store-records-the-provider.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L3897-L3940](../../../../packages/sdk/src/host.ts#L3897-L3940) - `listing()`"
---

## Objective

`listing()` collects every agent's rows first, then keeps one row per id: the recorded provider's when that agent is loaded and listed it, else the first loaded agent that listed it (the order of `agents`).
`names`, `owners`, `wheres`, `births` and `moves` are set from the kept row only, so opening an id reaches its own harness.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `listing()`.
- `UPDATE: .project/plans/host/00-host.md` - one line on the listing, if it describes it.

## Validation

- A host test with two fake agents listing the same ids: one row per id; a recorded provider wins whichever agent loaded first; an unrecorded id and one recorded for an agent that is not loaded go to the first; opening the kept row resumes on its agent; a row only one agent lists is unchanged.

## Resume

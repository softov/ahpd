---
title: The joined image's tag covers the parts inside it
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/parts.ts#L902-L926](../../../../packages/computer/src/parts.ts#L902-L926) - `ensureJoined`"
  - "[code://packages/computer/src/parts.ts#L222-L229](../../../../packages/computer/src/parts.ts#L222-L229) - `hashOf`"
---

## Objective

The joined image's tag is a hash of the file, the ahpd part's tag and the ids of the parts it holds, so an image built without a part is never reused as the image with it, and `missing` always names what the image lacks.

## Files

- `UPDATE: packages/computer/src/parts.ts:902-926` - fold the held ids into the tag; today the tag is `hashOf(hash, named)`, the same whichever parts failed, so one failed part build leaves `ahpd-agents:<hash>` without it, every later run finds the tag and reuses it, and once the part builds the answer says `missing: []` for an image that does not hold it.
- `UPDATE: packages/computer/test/computer-parts-build.test.ts` - the case below.

## Steps

1. Failing case first, with the fake runtime: the first `ensureJoined` has one part's build fail; the second has it succeed. Today the second answers the first run's tag with `missing: []` and builds nothing; after, it builds a new tag holding the part.
2. Hash the sorted ids of `held` with what `hashOf` hashes.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-parts-build.test.ts`.

## Resume

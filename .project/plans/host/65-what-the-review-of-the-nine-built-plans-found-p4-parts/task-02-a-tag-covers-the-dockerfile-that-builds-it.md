---
title: A tag covers the Dockerfile that builds it
status: todo
depends: [task-01-the-joined-images-tag-covers-the-parts-inside-it.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/parts.ts#L193-L211](../../../../packages/computer/src/parts.ts#L193-L211) - `pinnedOf` and `tagOf`"
  - "[code://packages/computer/src/parts.ts#L570](../../../../packages/computer/src/parts.ts#L570) - `dockerfileOf`"
  - "[code://packages/computer/src/parts.ts#L866](../../../../packages/computer/src/parts.ts#L866) - `joinedDockerfile`"
---

## Objective

A part's tag and the joined image's tag change when the Dockerfile text that builds them changes, so an upgrade of ahpd that changes how an image is written builds it again.

## Files

- `UPDATE: packages/computer/src/parts.ts:193-211` - the tag carries a short hash of `dockerfileOf(part, source)`; today it is the versions alone, so after an upgrade that changes `dockerfileOf`, `ensurePart` finds the old tag and keeps the image the older code built.
- `UPDATE: packages/computer/src/parts.ts:902-926` - the joined tag hashes `joinedDockerfile(held, tags)` too.
- `UPDATE: packages/computer/test/computer-parts-build.test.ts` - the case below.

## Steps

1. Failing case first: build a part with the fake runtime, then change what its Dockerfile says (a seam that wraps `dockerfileOf`), and ask again. Today no build happens; after, one does.
2. The fill volume named from the tag moves with it; check the mount cases still pass.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-parts*.test.ts`.

## Resume

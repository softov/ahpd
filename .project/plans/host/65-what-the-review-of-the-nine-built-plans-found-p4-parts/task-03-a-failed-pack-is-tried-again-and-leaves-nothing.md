---
title: A failed pack is tried again and leaves nothing
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/parts.ts#L311-L319](../../../../packages/computer/src/parts.ts#L311-L319) - `packedOf`, its `mkdtempSync` never removed"
  - "[code://packages/computer/src/parts.ts#L321-L343](../../../../packages/computer/src/parts.ts#L321-L343) - `answered ??=`"
---

## Objective

A pack that fails is asked again by the next build rather than until the daemon restarts, and the scratch directory a pack uses is gone once its bytes are read.

## Files

- `UPDATE: packages/computer/src/parts.ts:321-343` - a rejected `answered` is cleared; today `answered ??=` keeps the rejected promise, so one `pnpm pack` failure (a build not run yet) fails every ahpd part build until restart.
- `UPDATE: packages/computer/src/parts.ts:311-319` - remove `into` after the tarballs are read, in a `finally`; today every pack leaves an `ahpd-pack-*` directory in the temp directory.
- `UPDATE: packages/computer/test/computer-parts-build.test.ts` - the cases below.

## Steps

1. Failing case first: the first `ahpdSourceOf()` rejects (a pack seam that fails once), the second resolves. Today the second rejects too.
2. Failing case: after `ahpdSourceOf()` resolves, no `ahpd-pack-*` directory it made is left. Today one is.

## Validation

- Both cases fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/computer/test/computer-parts-build.test.ts`.

## Resume

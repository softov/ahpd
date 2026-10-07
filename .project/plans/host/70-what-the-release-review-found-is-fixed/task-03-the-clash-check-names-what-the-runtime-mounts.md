---
title: The clash check names what the runtime mounts
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L1050-L1052](../../../../packages/computer/src/manifest.ts#L1050-L1052) - the folder in the clash check"
  - "[code://packages/computer/src/runtime.ts#L3021-L3023](../../../../packages/computer/src/runtime.ts#L3021-L3023) - what the runtime mounts"
---

## Objective

The clash check folds in the path the runtime mounts, so a clash gets the manifest's sentence and not Docker's error.

## Files

- `UPDATE: packages/computer/src/manifest.ts:1050-1052` - use `repository ?? folder`, and nothing under `copy`.
- `UPDATE: packages/computer/test/computer-options.test.ts` - the cases below.

## Steps

1. Pass the repository and the session tree to the clash check where it reads the folder.
2. Fold in `repository ?? folder` at its own path.
3. Fold in nothing for the folder when the session tree is `copy`.

## Validation

- `it('refuses a profile mount at the repository of a session in a subfolder')`
- `it('accepts a profile mount at the subfolder, which the runtime does not mount')`
- `it('folds in no folder mount under copy')`
- Run the full gates from the plan. All pass.

## Resume


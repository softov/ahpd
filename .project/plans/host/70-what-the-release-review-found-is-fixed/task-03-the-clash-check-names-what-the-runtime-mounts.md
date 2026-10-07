---
title: The clash check names what the runtime mounts
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L1071-L1081](../../../../packages/computer/src/manifest.ts#L1071-L1081) - the folder in the clash check"
  - "[code://packages/computer/src/runtime.ts#L3069-L3071](../../../../packages/computer/src/runtime.ts#L3069-L3071) - what the runtime mounts"
---

## Objective

The clash check folds in the path the runtime mounts, so a clash gets the manifest's sentence and not Docker's error.

## Files

- `UPDATE: packages/computer/src/manifest.ts:1071-1081` - use `repository ?? folder`, and nothing under `copy`.
- `UPDATE: packages/computer/src/plugin.ts:1481-1494` - read `withGit` before the manifest and pass what it decided.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the cases below.

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

- **Implemented** 2026-10-07 on `build/agents/4f2c8f8e`.
- `manifest.ts`: `ManifestDefaults` carries `repository` and `sessionTree`. `mountedAt` is the path the runtime mounts for the folder: `repository ?? folder`, and nothing under `copy`, where the machine's own volume holds the tree. The clash check folds that path in, so a profile mount there is refused as `the profile's mount ... and the session's repository ... both land at ...`.
- `plugin.ts`: the disposable path reads `withGit` before `manifestOf`, and passes the repository and the tree it decided. `making` builds the creation sentence in one place, so the refusal a session reads for a `copy` profile is what it was.
- `computer-disposable.test.ts`: the three cases, beside the `sessionFolder` and `sessionRepository` cases. Each one fails without the fix. The first asks Docker for two mounts at one path, and Docker answers with its duplicate mount point. The second asks for the folder the runtime does not mount. The third, under `copy`, asks for the folder the machine does not bind.
- **Found and left alone:** the plan's Files line names `packages/computer/test/computer-options.test.ts`. That file holds the options schema, and it has no session and no Docker fixture. These cases need a session, so they went to the file that makes one.

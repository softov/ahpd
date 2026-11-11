---
title: The version check reads the chosen folder
status: todo
depends: []
layer: "scripts/install"
refs:
  - "[code://scripts/install/install.sh#L775-L806](../../../../scripts/install/install.sh#L775-L806) - the block this task runs for either `ahpd`"
  - "[code://scripts/install/test/install-sh.test.ts#L394-L405](../../../../scripts/install/test/install-sh.test.ts#L394-L405) - the case the new ones copy"
---

## Objective

`install.sh` checks the version of an `ahpd` in the bin folder it chose, as it does for one on the PATH.

## Files

- `UPDATE: scripts/install/install.sh:775-806` - when the PATH has no `ahpd`, run `resolve_prefix` first and take `$BIN/ahpd` for the version check.
- `UPDATE: scripts/install/test/install-sh.test.ts:394-405` - two cases with the `ahpd` in the prefix and not on the PATH.

## Steps

1. In `do_install`, when `command -v ahpd` is empty, run `resolve_prefix`, and set `ahpd` to `$BIN/ahpd` when that file is executable.
2. Run the version check block when `ahpd` holds a path from either lookup.
3. Keep the `else` branch for the case with no `ahpd`, with `resolve_prefix` already run.
4. Update the comment over the block to name both lookups.
5. Add a test: an `ahpd` 0.13.0 in the prefix and off the PATH gives "Nothing to update." and no `npm install`.
6. Add a test: the same at 0.12.0 with `--yes` installs into that prefix and prints the restart line.

## Validation

- `install-sh.test.ts`: the two new cases pass, and the existing cases pass.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run scripts/install` passes.
- `pnpm typecheck` passes.

## Resume


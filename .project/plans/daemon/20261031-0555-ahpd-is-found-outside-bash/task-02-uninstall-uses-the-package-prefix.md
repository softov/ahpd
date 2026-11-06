---
title: The uninstall uses the prefix of the package
status: done
depends: []
layer: scripts/install
refs:
  - "[code://scripts/install/install.sh#L787-L847](../../../../scripts/install/install.sh#L787-L847) - `do_uninstall`"
  - "[code://scripts/install/install.sh#L309-L316](../../../../scripts/install/install.sh#L309-L316) - `ahpd_prefix`"
  - "[code://scripts/install/test/install-sh.test.ts#L566-L655](../../../../scripts/install/test/install-sh.test.ts#L566-L655) - the uninstall cases"
---

## Objective

`--uninstall` removes `@ahpd/server` from the npm prefix that holds the found `ahpd`.
An install under `~/.npm-global` is removed from there.

## Files

- `UPDATE: scripts/install/install.sh:787-847` - pass `--prefix` to `npm uninstall -g` when `ahpd_prefix` finds the prefix.
- `UPDATE: scripts/install/test/install-sh.test.ts:566-655` - add the `~/.npm-global` case, and keep the case where no prefix is found.

## Steps

1. In `do_uninstall`, call `ahpd_prefix "$AHPD"` when `AHPD` has a value.
2. When `ahpd_prefix` answers, run `npm uninstall -g --prefix <prefix> <package>`.
3. When it does not answer, run `npm uninstall -g <package>` as today.
4. Keep the Bun path as it is.
5. Add a test: an install into `~/.npm-global` and then `--uninstall` calls npm with `--prefix` and that folder.
6. Add a test: `--uninstall` with an `ahpd` that is not in a prefix calls `npm uninstall -g @ahpd/server`.
7. Add a test: under `--dry-run`, the script prints the command with `--prefix` and runs nothing.

## Validation

- `scripts/install/test/install-sh.test.ts` passes, with the new cases.
- By hand on Debian 13: `--uninstall` leaves no `@ahpd/server` under `~/.npm-global/lib/node_modules`.

## Resume

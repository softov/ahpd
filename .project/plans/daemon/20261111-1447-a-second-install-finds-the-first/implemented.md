---
title: A second install finds the first one off the PATH - implemented
date: 2026-11-11
refs:
  - git://deded4031
  - "[code://scripts/install/install.sh](../../../../scripts/install/install.sh) - `do_install` and `check_installed_version` read the chosen bin folder"
  - "[code://scripts/install/test/install-sh.test.ts](../../../../scripts/install/test/install-sh.test.ts) - the two cases"
---

`install.sh` run again finds the `ahpd` it installed in the bin folder it chose, when the shell's PATH does not have it. At the same version it says "Nothing to update." and installs nothing. At an older one it updates there and says to restart.

## What was built

- [`code://scripts/install/install.sh`](../../../../scripts/install/install.sh) - `do_install` runs `resolve_prefix` when the PATH has no `ahpd`, and takes `$BIN/ahpd` for the version check when it is there.
- [`code://scripts/install/install.sh`](../../../../scripts/install/install.sh) - `check_installed_version` reads `$BIN/ahpd` when the PATH has no `ahpd`.
- [`code://scripts/install/test/install-sh.test.ts`](../../../../scripts/install/test/install-sh.test.ts) - an `ahpd` 0.13.0 off the PATH stops with "Nothing to update."; one at 0.12.0 updates and says to restart.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - one line under *Daemon*.

## Verified

- `pnpm typecheck` is clean.
- `npx vitest run scripts/install` under the shared lock: 37 passed, and the 24 cases of `install-ps1.test.ts` skipped on Linux.
- Not run on a VM. The case of 2026-11-09 was a Debian 13 VM under `sudo -iu`, and the tests stand in for it with a PATH that lacks the prefix.

## Departures from the plan

- `check_installed_version` also reads `$BIN/ahpd`. The plan named only the check before the install, and the update off the PATH failed after it with "ahpd is not on the PATH".

## Left for later

- `install.ps1` is unchanged, as the plan says.

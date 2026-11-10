---
title: An install at the same version says to load a new version
status: open
date: 2026-11-09
severity: minor
refs:
  - "[code://scripts/install/install.sh#L779-L806](../../scripts/install/install.sh#L779-L806) - only an `ahpd` on the PATH gets the version check and \"Nothing to update.\""
  - "[code://scripts/install/install.sh#L724-L730](../../scripts/install/install.sh#L724-L730) - `resolve_ahpd` also finds an `ahpd` in the chosen bin folder"
  - "[code://scripts/install/install.sh#L808-L835](../../scripts/install/install.sh#L808-L835) - a found `ahpd` makes the run an upgrade, which updates the plugins and prints the restart line"
  - git://fd9a94e5b - the last commit that holds `pending/install-path-checks.md`, the check where this showed
---

## Symptom

Softov saw this on 2026-11-09, in step 4 of the install check, on a Debian 13 test VM.
`install.sh` ran again for a user who had `@ahpd/server` 0.14.0, the version it installs.
It printed "Run ahpd restart to load the new version and its plugins.", but no new version was installed.

## Cause

Not confirmed by a test. The code shows this path.

- `sudo -iu <user> bash install.sh` runs a login shell that is not interactive. Debian's `~/.bashrc` returns at once in such a shell, and step 4 had removed the line from `~/.profile`.
- So `ahpd` is not on the PATH, and the run skips the version check and its "Nothing to update." stop.
- `resolve_prefix` picks `~/.npm-global`, and `resolve_ahpd` finds the `ahpd` in its bin folder.
- A found `ahpd` makes the run an upgrade: it installs the same version again, runs `ahpd plugin update all`, and prints the restart line.

## Impact

A person who runs the script twice is told to restart for a version that did not change.
The run also installs the package again and updates the plugins, which "Nothing to update." would skip.

## Workaround

None needed. The restart does no harm.

## Fix

No fix is chosen.

- Read the version of the `ahpd` that `resolve_ahpd` finds, and give it the same check as an `ahpd` on the PATH.
- Or read the version before and after the install, and print the restart line only when it changed.

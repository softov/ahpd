---
title: The image of a version not on npm cannot install a plugin
status: open
date: 2026-11-12
severity: minor
refs:
  - "[code://packages/server/src/install.ts#L575](../../packages/server/src/install.ts#L575) - `daemonsSdk` pins `@ahpd/sdk` to the daemon's own version for every install"
  - "[code://docker/entrypoint.sh#L15](../../docker/entrypoint.sh#L15) - a fresh volume installs `@ahpd/web`"
  - "[code://docker/entrypoint.sh#L80](../../docker/entrypoint.sh#L80) - a failed install stops the start"
  - "[code://.github/workflows/ci.yml#L77-L83](../../.github/workflows/ci.yml#L77-L83) - `check` needs `linux` alone, so a red `image` job leaves it green"
---

## Symptom

On 2026-11-12 the CI `image` job of PR #313, the bump to `0.15.0-rc.2`, failed at its first smoke check.
The log says "Installing @ahpd/web@0.8.0 with npm.", then "No matching version found for @ahpd/sdk@0.15.0-rc.2", then "ahpd: the plugin install failed: ahpd plugin install @ahpd/web".

## Cause

`ahpd plugin install` adds `@ahpd/sdk@<daemon version>` to the npm command.
An image built from a bump has a version that npm does not serve until the release is staged and approved.
So a fresh volume cannot install its default plugin, and the container never gets healthy.

## Impact

- The `image` job is red on every bump PR, and on main after a bump merges, until npm serves the new version.
- `release.yml` pushes the image after the packages are staged and before they are approved. A fresh volume on that image fails its start until the approval.
- `check` does not include `image`, so the red job does not block a merge.

## Workaround

Rerun the `image` job after npm serves the version. Approve the staged packages soon after the tag run.

## Fix

Not chosen. Two candidates:

- Install the image's own `@ahpd/sdk` from `/opt/ahpd`, in place of the one on npm.
- Skip the default plugin install in the smoke test when npm does not serve the version.

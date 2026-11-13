---
title: The ahpd machine part does not follow the release
status: open
date: 2026-11-12
severity: major
refs:
  - "[code://packages/computer/images/versions.json#L22-L23](../../packages/computer/images/versions.json#L22-L23) - the ahpd part's version, which a release bump does not change"
  - "[code://packages/computer/src/parts.ts#L469-L478](../../packages/computer/src/parts.ts#L469-L478) - `ahpdSourceOf` installs that version from npm, unless `AHPD_PART_AHPD_ROOT` names a checkout"
  - "[code://scripts/parts-bump.mjs#L150](../../scripts/parts-bump.mjs#L150) - the parts bump skips the ahpd part, because its version moves with the package"
  - git://32c4e7cb0 - container/05 p3, which wrote the ahpd part at 0.8.0 on 2026-10-04
  - git://cbe5bde97 - the ahpd part is installed by `npm ci` from a committed `package.json` and lock, still at 0.8.0
---

## Symptom

On 2026-11-12 `packages/computer/images/versions.json` named the ahpd part at `0.8.0`, while the packages were at `0.15.0-rc.1`.
The rc.2 dry run, run 43336912861, built `ghcr.io/ahpio/ahpd-part/ahpd:0.8.0-<hash>`.
`@ahpd/server@0.8.0` was published on 2026-09-28.

## Cause

The ahpd part's version is written by hand in `versions.json`.
The parts bump skips it, and says that its version moves with the package.
A release bump changes each package's `package.json` and not `versions.json`, so nothing moves it.

## Impact

Some machines run an ahpd of their own: a cofold or pi session in a machine, and a nested host on an ssh box.
On a host installed from npm, that ahpd is the part's pinned version, not the host's own.
Since `0.15.0-rc.2` the part is pinned at `0.15.0-rc.1`, one release behind (Softov, 2026-11-12).

## Workaround

Set `AHPD_PART_AHPD_ROOT` to a checkout of this repository, and the part is built from it.

## Fix

Not chosen. A release cannot pin its own version in the bump, because npm does not serve that version until the tag run.
Candidates:

- The release's `parts` job builds the ahpd part from the packages the tag packed, and a host finds it by the release's version.
- The parts job runs after the npm publish, and the bump moves the part to the release's version.

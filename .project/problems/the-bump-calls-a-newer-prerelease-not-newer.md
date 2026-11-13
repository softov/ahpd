---
title: The parts bump calls a newer prerelease not newer
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://scripts/parts-bump.mjs#L166-L198](../../scripts/parts-bump.mjs#L166-L198) - `newerThan`, which refuses every prerelease"
  - "[code://scripts/parts-bump.mjs#L221-L235](../../scripts/parts-bump.mjs#L221-L235) - the skip lines of an npm part and an archive part"
  - "[code://packages/computer/images/versions.json#L125-L132](../../packages/computer/images/versions.json#L125-L132) - the dsh part, held at a prerelease"
---

## Symptom

Run 43381150088 of `parts-bump.yml`, on 2026-11-13, printed `skipped dsh: the feed has 0.2.2-rc.1, which is not newer than 0.2.0-rc.2`.
`0.2.2-rc.1` is newer than `0.2.0-rc.2`.

## Cause

`newerThan` answers `false` for every prerelease, by design: a part moves to a release, not to a candidate.
The skip line reads that `false` as "not newer", so it says something false.
A part that is already on a prerelease, such as dsh, never moves to a newer prerelease. It moves only when its package publishes a release.

## Impact

The run log misleads whoever reads why a part did not move.
dsh stays on `0.2.0-rc.2` until it is moved by hand, or until `@deepseek-ai/dsh` publishes a release.

## Workaround

None.

## Fix

- Keep refusing a prerelease, and say so in the skip line: "the feed has 0.2.2-rc.1, a prerelease".
- Or let a part that is already on a prerelease move to a newer prerelease, and keep a part on a release off them.

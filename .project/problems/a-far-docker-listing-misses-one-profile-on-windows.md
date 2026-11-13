---
title: A far Docker listing misses one of two profiles on Windows
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/computer/test/computer-far-docker.test.ts#L213-L221](../../packages/computer/test/computer-far-docker.test.ts#L213-L221) - \"lists, for two profiles on one box, only each profile's own machines\""
---

## Symptom

The case fails in `windows (4/4)` in run 42807821787, with `expected [ 'docker-far.one' ] to deeply equal [ 'docker-far.one', 'docker-near.two' ]`.
It passed when the job ran again on the same commit, and it passes on Linux.

## Cause

Unknown.
The two profiles name one box, so both listings read the same scripted Docker state file at once. On Windows one of the two came back without its machine.

## Impact

A Windows CI job fails at random. If a real host lists two profiles on one box the same way, a machine can be missing from the picker.

## Workaround

None. Running the job again is not a fix.

## Fix

- Find whether the scripted Docker or the plugin lost the second listing, with a log of each listing's answer.
- If the plugin drops a listing that fails or overlaps, it is a fault in the plugin, not in the case.

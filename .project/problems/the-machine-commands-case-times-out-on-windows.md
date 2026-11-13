---
title: The machine commands case times out on Windows
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/computer/test/commands.test.ts#L92](../../packages/computer/test/commands.test.ts#L92) - \"makes, stops, starts, restarts and removes a machine, and the channel hears each\""
---

## Symptom

The case fails in `windows (4/4)` in run 42747912760, with `Test timed out in 30000ms`.
It passed when the job ran again on the same commit, and it passes on Linux.

## Cause

Unknown.
The case runs five commands on one machine, and each one calls the scripted Docker, which is a new Node process for each call. On a Windows runner those calls can take most of 30 s.

## Impact

A Windows CI job fails at random, and blocks a merge until it runs again.

## Workaround

None. Running the job again is not a fix.

## Fix

- Take the timings of each command on a Windows runner.
- Split the case into one case per command, each with a limit of its own, if the calls are the slow part.

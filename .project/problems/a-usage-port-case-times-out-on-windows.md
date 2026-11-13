---
title: A usage port case times out on Windows
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/server/test/usage-port.test.ts#L89-L105](../../packages/server/test/usage-port.test.ts#L89-L105) - \"tells a plugin that its usage store was not wanted, and lets one take the port over\""
  - "[code://packages/server/test/usage-port.test.ts#L49-L60](../../packages/server/test/usage-port.test.ts#L49-L60) - `cli`, which starts a whole daemon from source for each call"
---

## Symptom

The case fails with `Test timed out in 20000ms` in `windows (3/4)` on main, in runs 42832274878 and 43351930159.
It passes on Linux.

## Cause

Unknown.
The case starts the daemon twice, each time from source with `--import ./scripts/dev.mjs`, which compiles the TypeScript as it loads. On a Windows runner two such starts can take most of 20 s.

## Impact

A Windows CI job on main fails at random.

## Workaround

None. Running the job again is not a fix.

## Fix

- Take the timings of each start on a Windows runner.
- Start the daemon from the built `dist`, as `plugin-install.test.ts` does, if the source start is the slow part.
- Or check the refusal and the takeover in one start each, in two cases with a limit of their own.

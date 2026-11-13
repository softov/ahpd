---
title: A dropped client's call case loses its window on Windows
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/sdk/test/host-tools.test.ts#L3080-L3107](../../packages/sdk/test/host-tools.test.ts#L3080-L3107) - \"fails a dropped client's streaming call once the daemon's window runs out, readied first\""
---

## Symptom

The case fails in `windows (4/4)` on main, in run 42842552404, with `expected undefined to be 'a'` at `expect(calls.owner('call-2')).toBe('a')`.
It passes on Linux.

## Cause

The case sets `clientToolCallDisconnectTimeoutMs` to 50 ms, closes client `a`, and calls `settle` on a real timer before it reads the owner.
When `settle` takes more than 50 ms, the window has run out and the call has no owner when the case reads it.

## Impact

A Windows CI job on main fails at random.

## Workaround

None. Running the job again is not a fix.

## Fix

- Read the owner with fake timers, so the window cannot run out before the read.
- Or read the owner before `settle`, right after the client closes.

---
title: A cofold titling case times out on Windows
status: open
date: 2026-11-04
severity: minor
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L704-L733](../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L704-L733) - \"titles a row by the subject cofold sent rather than the model spelling\""
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L35-L41](../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L35-L41) - `when`, which waits 5000 ms of wall-clock time"
---

## Symptom

On the Windows CI runners, the case fails with "timed out waiting" at its wait for the turn to end.
It failed in main's run 41356874909 on 2026-11-01, in #211's run 41759175381 and in #213's run 41765190223.
The reruns of the failed jobs in #211 and #213 passed.
It passes on Linux.

## Cause

Unknown.
The turn runs three tool calls, and `when` gives the whole turn 5000 ms of wall-clock time.
A loaded Windows runner may need more than that.

## Impact

A Windows CI job fails at random, and a PR waits for a rerun.

## Workaround

Rerun the failed jobs.

## Fix

- Measure the case's turn on a Windows runner.
- Give the wait the time the other Windows waits get, if the turn is only slow.

---
title: Three cases fail at random on Windows
status: open
date: 2026-11-04
severity: minor
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L494](../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L494) - \"reports an edit before the row that runs it\", which timed out waiting"
  - "[code://packages/computer/test/computer-needs.test.ts#L1197](../../packages/computer/test/computer-needs.test.ts#L1197) - \"drops only the unreadable variable and logs it, where the profile says drop\", which got no `-e` arguments"
  - "[code://packages/computer/test/computer-disposable.test.ts#L2100](../../packages/computer/test/computer-disposable.test.ts#L2100) - \"fetches what a machine committed before the machine goes\", which timed out after 20 s"
  - "[code://packages/computer/test/computer-options.test.ts](../../packages/computer/test/computer-options.test.ts) - \"takes a profile's gitGuard by its values\", whose hook timed out after 10 s"
  - problems/two-attachment-cases-time-out-on-windows.md - the same kind of failure in other cases
  - problems/a-cofold-titling-case-times-out-on-windows.md - the same kind of failure in other cases
---

## Symptom

On 2026-11-04, three cases failed in the Windows job `windows (1/3)`, each once, and passed on a rerun of the same commit:

| Case | Run | What it said |
| --- | --- | --- |
| cofold tools, "reports an edit before the row that runs it" | main, 685733f0 | `timed out waiting` |
| computer needs, "drops only the unreadable variable" | #228, 41859251099 | `expected [] to deeply equal [ 'OTHER_KEY', 'A' ]` |
| computer disposable, "fetches what a machine committed" | #230, 41869756715 | `Test timed out in 20000ms` |
| computer options, "takes a profile's gitGuard by its values" | #237, 41936208437 | `Hook timed out in 10000ms` |

#228 and #237 do not touch `packages/computer`, and #230 changes two docs pages only. Each case passes on Linux.

On Linux, the `processes` job of #233 failed once, in run 41901468359. The case is "runs its own script under sh, and reads what this host has" in `computer-servercheck.test.ts`, with `Test timed out in 5000ms`. Its rerun failed the same way, and the case takes 1 s on Softov's machine. The script calls `docker version` and `docker info`, which wait on the runner's Docker daemon. The same run hit the known case of [two-attachment-cases-time-out-on-windows.md](two-attachment-cases-time-out-on-windows.md) on Windows.

The first rerun of #230's `windows (1/3)` failed another way: no case failed, and the unit run hit the `timeout 300` of [`code://.github/workflows/ci.yml`](../../.github/workflows/ci.yml#L104) with exit code 124.

## Cause

Unknown. Each case waits on a process, a file or a timer, and the Windows runner is slower at each.

## Impact

A Windows job fails at random, and a PR waits for a rerun. Windows CI blocks a merge, so each failure costs a rerun of about 15 minutes.

## Workaround

Rerun the failed jobs.

## Fix

- Take the timings of each case on a Windows runner, and find what it waits on.
- Hold each case on the event it waits for, not on a fixed time.

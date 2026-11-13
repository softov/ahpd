---
title: The case of a Claude CLI that is gone waits on fixed times
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/computer/test/computer-spawn.test.ts#L120-L154](../../packages/computer/test/computer-spawn.test.ts#L120-L154) - \"fails a turn on a session whose CLI is gone, instead of thinking for ever\""
  - "[code://packages/computer/test/computer-spawn.test.ts#L121](../../packages/computer/test/computer-spawn.test.ts#L121) - the import of `agent-claude` from source, inside the case"
  - "[code://packages/computer/test/computer-spawn.test.ts#L142-L144](../../packages/computer/test/computer-spawn.test.ts#L142-L144) - the two fixed waits, 600 ms and 100 ms"
  - git://4f307c524 - #314, which held the devtunnel view case on its first read with `vi.waitFor`
---

## Symptom

The case fails in two ways. On CI it passes when the job runs again on the same commit, and on Softov's machine it fails each time.

| Where | Run | What it said |
| --- | --- | --- |
| Linux, `processes (2/2)`, main | 43162247025, 2026-11-12 | `emitted: : expected undefined to be defined`, after 2046 ms |
| Windows, `windows (3/4)`, #317 | 43374043657, 2026-11-13 | `emitted: : expected undefined to be defined`, after 2436 ms |
| Softov's machine, `npx vitest run packages/computer` | 2026-11-13 | `Test timed out in 5000ms`, twice |

On Softov's machine the case passes in 8.7 s with `--testTimeout=60000`. #317 does not touch `packages/computer` or `packages/agent-claude`.

## Cause

The case measures time where it should wait on events.

- It imports `agent-claude/src/claude.js` inside the case, so the cold import counts against the case's limit of 5 s. On Softov's machine the import takes about 8 s.
- It waits 600 ms for the stand-in CLI to exit, then sends the turn. It waits 100 ms more, then reads the `chat/error`. On a slow runner the CLI has not exited, or the error has not come, by then. `emitted:` is empty in both CI failures, so nothing at all came in the 700 ms.

## Impact

A CI job fails at random, on Linux or on Windows, and blocks a merge until it runs again. On Softov's machine the computer suite fails each time.

## Workaround

None. Running the job again is not a fix.

## Fix

- Import `claude.js` at the top of the file, so the import is outside the case's limit.
- Wait until the stand-in CLI has exited before the turn is sent, in place of the 600 ms. The case does not hold the child today, so it needs a way to see the exit.
- Hold the read on the `chat/error` with `vi.waitFor`, as #314 does, in place of the 100 ms.

---
title: A cofold truncation case ends its third turn without completing
status: open
date: 2026-11-13
severity: minor
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-fork.test.ts#L522-L558](../../packages/agent-cofold/test/agent-cofold-fork.test.ts#L522-L558) - \"keeps the chat going when the store cannot truncate the conversation\""
  - "[code://packages/agent-cofold/test/agent-cofold-fork.test.ts#L398-L413](../../packages/agent-cofold/test/agent-cofold-fork.test.ts#L398-L413) - `say`, which waits for a turn's end of any kind"
---

## Symptom

The case fails at line 556 with `expected [] to deeply equal [ 't3' ]`, in 38 to 109 ms. It passes when the job runs again on the same commit.

| Run | Job |
| --- | --- |
| 42747912760 | `linux (2/2)` |
| 42807821787 | `windows (3/4)` |
| 42996575449 | `linux (2/2)`, main |
| 43179734246 | `linux (2/2)`, main |
| 43196712705 | `linux (2/2)`, main |

## Cause

Unknown.
`say` returns when turn `t3` ends with `chat/turnComplete`, `chat/turnCancelled` or `chat/error`. So `t3` ended, but not with `chat/turnComplete`.
Before `t3`, the case waits until no run in the store is `running`. It does not wait for the host to end turn `t2`, which was stopped by the truncation. `t3` can start while the host still holds `t2`.
The first assertion fails before the second one reads `chat/error`, so the log does not say which end `t3` had.

## Impact

A CI job fails at random, mostly on Linux, and blocks a merge until it runs again.

## Workaround

None. Running the job again is not a fix.

## Fix

- Wait for `t2`'s `chat/turnCancelled` or `chat/turnComplete` before `t3` is sent.
- Assert on `t3`'s end action first, so a failure says which end it was.

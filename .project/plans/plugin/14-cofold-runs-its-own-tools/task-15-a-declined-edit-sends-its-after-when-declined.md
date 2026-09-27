---
title: A declined edit sends its after when the person declines, not at the end of the run
status: done
depends: [task-09-the-untested-paths-are-pinned.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L266-L278](../../../../packages/agent-cofold/src/session.ts#L266-L278) - `settleEdit`, which sends a call's `after` once"
  - "[code://packages/agent-cofold/src/session.ts#L1329-L1338](../../../../packages/agent-cofold/src/session.ts#L1329-L1338) - `confirm`, which settles a declined call while its id is still known"
---

## Objective

When a person declines an edit, the file's `after` is sent on the decline, so it does not stay "changing" for the rest of the turn or across a pause; and a test fails when that path is removed.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:1329-1338` - the call is settled on the deny.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:333-361` - the case below.
- `UPDATE: task-09-the-untested-paths-are-pinned.md` - its Resume.

## Steps

1. Settle the edit where the call id is still known: either `confirm` calls `settleEdit(held.callId)` when `approved` is false, or the deny branch reads the call id from something `confirm` does not delete first. Pick the one that keeps a single place settling a denied call, and remove the branch that cannot run.
2. Correct task 09's Resume: the deny branch never ran because `confirm` deleted the entry first, not because of `stopNow`, and name the case this task adds.

## Validation

- `agent-cofold-turn.test.ts`: a `default`-mode turn where the person declines a `write_file` and the run then waits on a second approval: the declined file's `after` is sent before that second request. Today it is sent only by the end-of-run sweep, which a paused run does not reach, so the case fails.
- Removing the settle this task adds makes the case fail.
- `node_modules/.bin/vitest run packages/agent-cofold` green.

## Resume

Seen to fail: the new case, "sends a declined edit its after before the next ask", answered `['before']` for the declined file where it wanted `['before', 'after']`, with the run paused on the second question. Removing the settle this task adds made it fail the same way, and the settle was put back.

Done: `confirm` settles the call when the person declines, where the call id is still known, and the `approval.resolved` deny branch it left unreachable is gone from `apply`. A declined question is untouched.

The case lives in `agent-cofold-tools.test.ts` rather than in the `agent-cofold-turn.test.ts` this task's Files named: `open` there is the helper that records `onFileEdit`, so that is where the `after` can be seen.

Step 2 was half wrong and was written the other way round. `stopNow` really is why the cancel case relies on the sweep, so task 09's Resume keeps that; what it did not say is the other reason the deny branch was dead, which is `confirm` deleting the entry first. Task 09's Resume now says both, and its two stale `session.ts` refs are current.

---
title: A failed cofold turn is resumed - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts) - `failurePart` and `canCut`"
  - "[code://packages/agent-cofold/src/runs.ts](../../../../packages/agent-cofold/src/runs.ts) - `settleTurn`, which keeps the error part on the turn"
  - "[code://packages/agent-cofold/src/turns.ts](../../../../packages/agent-cofold/src/turns.ts) - `valuesFor`, `mappingOn`, `runTurn` and `resumeTurn`"
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts) - the session's `resume`"
  - "[code://docs/sdk/AHP.md#L278](../../../../docs/sdk/AHP.md#L278) - the support row for `chat/turnResume`"
---

A cofold turn that failed on a model call can be resumed. The client sends `chat/turnResume`, and the session reopens the turn with its message and parts. The store is cut through the last message of the turn before, and the prompt runs again under the turn's id. A conversation whose first turn failed has its session deleted, and the run makes it again on the same workspace. The calls the failed turn ran run again, because the cut drops them with the prompt.

## What was built

- [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts) - `failurePart` takes `resumable` and sets it on the part only when it is true. A failed `run.finished` sets it when the code is not `start_failed` and the new `canCut` option answers true. That option answers true when the turn before has a point, or when there is no turn before. `mapTurn` starts a turn's step after the parts the turn already has.
- [`code://packages/agent-cofold/src/runs.ts`](../../../../packages/agent-cofold/src/runs.ts) - `apply` gives the part of a `chat/error` to `settleTurn`. `settleTurn` pushes it onto the turn's `responseParts`, so the part is on the turn as well as on the stream.
- [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts) - `valuesFor` holds the settings and the model reference, and `mappingOn` builds a live mapping with `canCut`. `runTurn` holds the agent build and the launch, and `openTurn` and `resumeTurn` both use it. `resumeTurn` checks the last turn, pops it, cuts the store through its point, emits `chat/turnResume` and runs the prompt again. A broken record or a cut that throws ends the turn with `resume_failed`, and `apply` calls `startNext`, so a queued message goes next.
- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - the session answers `resume(turnId)` with `ctx.resumeTurn`.
- `docs/sdk/AHP.md` says how cofold resumes a turn, and the cofold README has a "A turn that fails" section.

## Verified

- `packages/agent-cofold/test`: 18 files, 260 tests pass, with the new cases in `agent-cofold-turn.test.ts`.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass, with 13 packages declared and none undeclared.
- The whole suite: 491 files, 490 pass and one is skipped. 8064 tests pass and 29 are skipped. The computer-devcontainer and computer-disposable tests did not time out in this run.
- The hand checks of task 02 are not done: a test ahpd, a bad key, and a resume from VS Code.

## Departures from the plan

- `resumable` is a field of the part, beside `kind`, not inside `error` as task 01 step 1 says. The protocol's reducer, pi and Claude read it there.
- Task 01 also changes `turns.ts`. `canCut` is read when the live mapping is made, and that happens in `openTurn`, which task 01 does not name. No other file of task 01 moved.
- `resumeTurn` calls `refreshOptions` before the new mapping, so a key fixed after the failure is used. A record that cannot be read ends the turn with code `resume_failed`, which the plan does not name.
- The first-turn test sends `workingDirectories` to the host's `createSession`, a list, not `workingDirectory`.
- A turn that fails again after a resume can be resumed again, because each failure adds one part and the last one is resumable.

## Left for later

- A resume against a real endpoint is not checked by hand yet.

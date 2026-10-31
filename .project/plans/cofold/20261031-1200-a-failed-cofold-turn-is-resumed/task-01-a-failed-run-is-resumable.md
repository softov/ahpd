---
title: A failed run is resumable
status: implemented
depends: []
layer: agent-cofold
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L159-L163](../../../../packages/agent-cofold/src/mapping.ts#L159-L163) - `failurePart`"
  - "[code://packages/agent-cofold/src/mapping.ts#L738-L746](../../../../packages/agent-cofold/src/mapping.ts#L738-L746) - the `chat/error` of a failed run"
  - "[code://packages/agent-cofold/src/runs.ts#L57-L75](../../../../packages/agent-cofold/src/runs.ts#L57-L75) - `settleTurn`"
---

## Objective

A cofold turn whose run failed has an error part with `resumable: true`, unless the run never started.
The part is on `chat/error` and on the turn in the snapshot.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:159-163` - `failurePart` takes `resumable`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:738-746` - a failed run's part is resumable when its error code is not `start_failed` and the session can cut.
- `UPDATE: packages/agent-cofold/src/runs.ts:57-75` - `settleTurn` takes the error part and pushes it onto the turn's `responseParts`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - add the cases of this task.

## Steps

1. Add a parameter `resumable` to `failurePart`, and set `error.resumable` only when it is true.
2. Add an option `canCut` to the mapping, a function the session gives that answers if the turn has a cut.
3. Make `canCut` answer `true` when the turn before has an entry in `points`, or when there is no turn before.
4. In the `run.finished` case, pass `resumable` when the code is not `start_failed` and `canCut()` answers `true`.
5. In `apply`, pass the part of a `chat/error` to `settleTurn`.
6. In `settleTurn`, push that part onto the turn's `responseParts` before the turn goes into `turns`.
7. Add a test that a failed run sends a resumable part on `chat/error` and holds it on the turn.
8. Add a test that a turn with no model ends with an error part that has no `resumable`.

## Validation

- `pnpm vitest run packages/agent-cofold/test/agent-cofold-turn.test.ts` passes, with the new cases.
- `pnpm typecheck` is clean.

## Resume

Done, all eight steps. `failurePart` takes `resumable`. The failed `run.finished` sets it when the code is not `start_failed` and `canCut()` answers true, and `settleTurn` keeps the part on the turn.
Found: `resumable` is a field of the part, beside `kind`, not inside `error`. The protocol's reducer, pi and Claude read it there, so step 1 is built that way.
Found: `canCut` has to come from where the live mapping is made, which is `openTurn` in `turns.ts`. That file is the fourth this task changes.
Tests: the failed run's part is checked on `chat/error` and on the turn in the snapshot. The no-model case checks that its part carries no `resumable`.

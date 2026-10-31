---
title: The cofold session resumes the turn
status: implemented
depends:
  - task-01-a-failed-run-is-resumable.md
layer: agent-cofold
refs:
  - "[code://packages/agent-cofold/src/turns.ts#L104-L140](../../../../packages/agent-cofold/src/turns.ts#L104-L140) - `openTurn`"
  - "[code://packages/agent-cofold/src/turns.ts#L188-L262](../../../../packages/agent-cofold/src/turns.ts#L188-L262) - `startTurn` and `launch`"
  - "[code://packages/agent-cofold/src/runs.ts#L34-L47](../../../../packages/agent-cofold/src/runs.ts#L34-L47) - `cut`, the store calls to copy"
  - "[code://docs/sdk/AHP.md#L278](../../../../docs/sdk/AHP.md#L278) - the support row for `chat/turnResume`"
---

## Objective

The cofold session gets `resume(turnId)`.
It reopens the failed turn, emits `chat/turnResume`, cuts the store, and runs the turn's input again under the turn's id.

## Files

- `UPDATE: packages/agent-cofold/src/turns.ts:104-262` - split the computing of the run's values and the launch out of `openTurn` and `startTurn`, so a reopened turn can launch.
- `UPDATE: packages/agent-cofold/src/turns.ts` - add `resumeTurn`, and export it on the turns object.
- `UPDATE: packages/agent-cofold/src/session.ts:330-345` - add `resume` to the session object, which calls `resumeTurn`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - add the cases of this task.
- `UPDATE: docs/sdk/AHP.md:278` - say that cofold resumes a failed model call, and how.
- `UPDATE: packages/agent-cofold/README.md` - say that a failed model call can be resumed, and that its tool calls run again.

## Steps

1. Move the values and the model reference that `openTurn` computes into a function both `openTurn` and `resumeTurn` call.
2. Move the agent build and `launch` of `startTurn` into a function `runTurn(turnId, input, values, reference, mapping)`.
3. In `resumeTurn`, answer `false` when a turn runs or the session has closed.
4. Answer `false` when the last turn is not `turnId` in `error`.
5. Answer `false` when the last part of that turn is not an error with `resumable: true`.
6. Take the turn off `turns`, delete its `state` and `duration`, and make it `active`.
7. Open a new mapping with `mapTurn` on the turn's own `responseParts`.
8. Emit `chat/turnResume` with the turn id, set the activity to "Thinking", and call `touch`.
9. Truncate the store through the point of the turn before, or delete the session when there is no turn before.
10. Call `runTurn` with the turn's text, or its parts when it has attachments.
11. When the cut throws, end the turn through `apply` with a `refusal` of code `resume_failed`.
12. Add a test that a resume emits `chat/turnResume` first, and the store holds the prompt once.
13. Add a test that a resume of the first turn deletes the session, and the new run keeps the workspace.
14. Add a test that a resumed run that fails again ends with two error parts, the last one resumable.
15. Add a test that `resume` answers `false` for each case of steps 3 to 5.
16. Update the `chat/turnResume` row in `AHP.md`, and the README.

## Validation

- `pnpm vitest run packages/agent-cofold/test` passes, with the new cases.
- `pnpm typecheck` is clean.
- By hand, use a test ahpd under XDG directories, and make a cofold turn fail on a bad key.
- Fix the key, resume the turn in VS Code, and check that it runs again.

## Resume

Done, steps 1 to 16. `valuesFor` and `mappingOn` are shared by `openTurn` and `resumeTurn`, `runTurn` holds the agent build and the launch, and `session.ts` serves `resume`.
Found: `mapTurn` numbers a turn's parts by its step, so a mapping on a reopened turn starts after the parts the turn kept. `step` now starts at the highest number already on the turn, or a delta would be appended to the failed run's text.
Found: a resume calls `refreshOptions`, so a key fixed after the failure is used. A record that cannot be read ends the turn with `resume_failed`.
Found: the host's `createSession` reads `workingDirectories`, a list. The first-turn test sends that field.
The hand check of `## Validation` waits for Softov: a test ahpd, a bad cofold key, and a resume from VS Code.
Tests: 260 in the suite, 18 files. The new cases cover the `chat/turnResume` before the run and the prompt held once. They cover a first turn on a file store, a second failure, and each refusal.
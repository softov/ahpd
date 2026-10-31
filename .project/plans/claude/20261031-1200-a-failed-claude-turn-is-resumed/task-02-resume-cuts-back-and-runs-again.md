---
title: Resume cuts back and runs again
status: implemented
depends:
  - task-01-a-failed-model-call-is-resumable.md
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/turns.ts#L752-L780](../../../../packages/agent-claude/src/session/turns.ts#L752-L780) - `resume` today"
  - "[code://packages/agent-claude/src/session/turns.ts#L135-L146](../../../../packages/agent-claude/src/session/turns.ts#L135-L146) - `again`"
  - "[code://packages/agent-claude/src/session/logins.ts#L256-L316](../../../../packages/agent-claude/src/session/logins.ts#L256-L316) - `moveOn`, the close, cut and start to copy"
  - "[code://docs/sdk/AHP.md#L278](../../../../docs/sdk/AHP.md#L278) - the support row for `chat/turnResume`"
---

## Objective

`resume(turnId)` reopens the failed turn and emits `chat/turnResume`.
It puts a new CLI on the conversation cut at the end of the turn before, and sends the turn's prompt to it.
A conversation's first turn starts over under its id.

## Files

- `UPDATE: packages/agent-claude/src/session/logins.ts:256-316` - move the close, cut and start of `moveOn` into a function that `moveOn` and `resume` both call.
- `UPDATE: packages/agent-claude/src/session/turns.ts:752-780` - `resume` checks the last part, emits `chat/turnResume`, and calls the shared function.
- `UPDATE: packages/agent-claude/test/agent-claude-failed-turn.test.ts` - add the cases of this task.
- `UPDATE: docs/sdk/AHP.md:278` - say that Claude resumes a failed model call, and how.
- `UPDATE: packages/agent-claude/README.md` - say that a failed model call can be resumed, and that its tool calls run again.

## Steps

1. Move the body of `moveOn` from the close of the CLI to `void ctx.consume()` into a function `restartAt(cut, login)`.
2. Call `restartAt` from `moveOn`, with the same behaviour as today.
3. In `resume`, answer `false` when a turn runs, or the last turn is not `turnId` in `error`.
4. Answer `false` when the last part of that turn is not an error with `resumable: true`.
5. Answer `false` when `ctx.cutOf()` answers `undefined`.
6. Take the turn off `turns`, delete its `state` and `duration`, and make it `active`.
7. Clear `failed`, set the activity to "Thinking", and emit `chat/turnResume` with the turn id.
8. Call `restartAt` with the cut and the current login, then `ctx.again([])`.
9. When the restart fails, end the turn with `failTurn` and the reason, with no `resumable`.
10. Remove the code that pushes the prompt onto `ctx.waiting` for the old CLI.
11. Add a test that a resume emits `chat/turnResume` first and starts the CLI at the cut.
12. Add a test that a resume of a conversation's first turn starts over.
13. Add a test that a resumed turn that fails again ends with two error parts, the last one resumable.
14. Add a test that `resume` answers `false` for each case of steps 3 to 5.
15. Update the `chat/turnResume` row in `AHP.md`, and the README.

## Validation

- `pnpm vitest run packages/agent-claude/test` passes, with the new cases and the login move cases as they are.
- `pnpm typecheck` is clean.
- By hand, use a test ahpd under XDG directories, and make a Claude turn fail on a bad key.
- Fix the key, and resume the turn in VS Code.
- Check that the turn runs again with no second copy of the prompt.

## Resume

Done, all fifteen steps. `resume` reopens the turn, cuts the conversation at the end of the turn before, and sends the prompt to the new CLI.
Found: the cut is read after the failed turn leaves `turns`, not before. `cutOf` walks the history back, and a turn in flight writes its own chain entry. Read first, `cutOf` answers with the failed prompt's entry, which is the cut the plan forbids. The plan's steps 5 and 6 are in the other order for that reason.
The hand checks of *Validation* still wait: a test ahpd, a bad key, and a resume from VS Code.

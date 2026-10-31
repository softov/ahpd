---
title: A failed model call is resumable
status: implemented
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/parts.ts#L314-L339](../../../../packages/agent-claude/src/session/parts.ts#L314-L339) - `failurePart` and `addFailure`"
  - "[code://packages/agent-claude/src/session/query.ts#L994-L998](../../../../packages/agent-claude/src/session/query.ts#L994-L998) - `wrong`, the failure of a `result`"
  - "[code://packages/agent-claude/src/session/query.ts#L1087](../../../../packages/agent-claude/src/session/query.ts#L1087) - where the error part is added"
  - "[code://packages/agent-claude/src/session/logins.ts#L167-L176](../../../../packages/agent-claude/src/session/logins.ts#L167-L176) - `cutOf`"
---

## Objective

A Claude turn that a `result` ends as failed has an error part with `resumable: true` when `cutOf` finds a cut.
The part is on `chat/error` and on the turn in the snapshot.
A turn refused before the CLI, a CLI that is gone and a refused login end with no `resumable`.

## Files

- `UPDATE: packages/agent-claude/src/session/parts.ts:314-339` - `failurePart` and `addFailure` take `resumable`; replace the comment that says this host cannot resume.
- `UPDATE: packages/agent-claude/src/session/logins.ts` - export `cutOf` on `Logins`, so `query.ts` and `turns.ts` can ask it.
- `UPDATE: packages/agent-claude/src/session/query.ts:1070-1090` - set the turn to `error` when the result failed, and pass `resumable` when the failure is a `result` and `cutOf` answers a cut.
- `UPDATE: packages/agent-claude/test/agent-claude-failed-turn.test.ts` - add the cases of this task.

## Steps

1. Add a parameter `resumable` to `failurePart`, and set `error.resumable` only when it is true.
2. Add the same parameter to `addFailure`, and pass it on.
3. Rewrite the comment on `failurePart` to say when the part is resumable.
4. Add `cutOf` to the `Logins` interface and to the object `createLogins` answers.
5. At `query.ts:1087`, pass `resumable` when `wrong` is not a refused login and `ctx.cutOf()` is not `undefined`.
6. Keep `failTurn` and `refuseTurn` on `addFailure` with no `resumable`.
7. Add a test that a failed `result` sends a resumable part on `chat/error` and holds it on the turn.
8. Add a test that a turn refused before the CLI ends with no `resumable`.
9. Add a test that a refused login ends with no `resumable`.

## Validation

- `pnpm vitest run packages/agent-claude/test/agent-claude-failed-turn.test.ts` passes, with the new cases.
- `pnpm typecheck` is clean.

## Resume

Done, all nine steps. The part is resumable on `chat/error` and on the turn, and the three tests pass.
The CLI reports an API failure as `subtype: success` with `is_error: true`.
The turn now ends in `error` for that result too, as the plan's *Answers* says, so a real API failure resumes.

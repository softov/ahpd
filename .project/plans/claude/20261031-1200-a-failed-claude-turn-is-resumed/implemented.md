---
title: A failed Claude turn is resumed - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-claude/src/session/parts.ts](../../../../packages/agent-claude/src/session/parts.ts) - `failurePart` and `addFailure`, which take `resumable`"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts) - where a failed `result` is marked resumable"
  - "[code://packages/agent-claude/src/session/logins.ts](../../../../packages/agent-claude/src/session/logins.ts) - `cutOf` and `restartAt`"
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts) - `resume`, which reopens the turn"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the host's check of the latest turn"
---

A Claude turn that failed on a model call can be resumed. The client sends `chat/turnResume`, and the turn reopens with its message and parts. A new CLI runs the prompt on the conversation cut at the end of the turn before. The calls the failed turn ran run again, because the cut drops them with the prompt. A conversation whose first turn failed is deleted and started over under its id. The host refuses a resume of any other turn, before it asks the backend.

## What was built

- [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts) - `failurePart` and `addFailure` take `resumable`, and set it only when it is true. A turn refused before the CLI, a CLI that is gone and a refused login carry none.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - a failure a `result` reports is resumable when it is not its login's and `cutOf` finds a cut.
- [`code://packages/agent-claude/src/session/logins.ts`](../../../../packages/agent-claude/src/session/logins.ts) - `cutOf` is on the `Logins` area, and `restartAt` holds the close, cut and start that `moveOn` and `resume` both use.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - `resume` checks the last part and the cut, reopens the turn, emits `chat/turnResume` and calls `restartAt` with `ctx.again([])`.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the host reads `session.chatState()` and refuses a turn that is not the latest, or whose last part is not a resumable error. It checks before it calls `session.resume`.
- `docs/sdk/AHP.md` and the Claude README say how Claude resumes a turn, and that its tool calls run again.

## Verified

- `packages/agent-claude/test`: 56 files, 519 tests pass. Four new cases are in `agent-claude-failed-turn.test.ts`.
- `packages/sdk/test/host-turn.test.ts`: 30 tests pass, with the new case that a turn whose last part is not resumable is refused, and starts no CLI. `packages/sdk/test/echo-origin.test.ts`: 6 tests pass.
- `packages/agent-pi/test`: 17 files, 229 tests pass, so a pi resume still passes the host's check.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- The whole suite: 485 files and 7998 tests pass, and 29 are skipped.
- The hand checks of task 02 are not done: a test ahpd, a bad key, and a resume from VS Code.

## Departures from the plan

- Steps 5 and 6 of task 02 are in the other order. `resume` reads the cut after the failed turn leaves `turns`, because `cutOf` walks the history back. Read first, `cutOf` answers with the failed turn's own last chain entry, which is the cut the plan forbids.
- The resume case in `host-turn.test.ts` still drives the Claude backend. It needed no change to the result frames, because the first turn's `error_during_execution` result is resumable once task 01 marks it.
- The test that refuses a turn that is not latest now expects the host's new words, "is not the latest turn".
- `query.ts` ends a turn in `error` when its result has `is_error: true`, also under `subtype: success`, which is how the CLI reports an API failure. Before, that turn ended `complete` and `resume` refused it.

## Left for later

- A resume against a real model is not checked by hand yet.

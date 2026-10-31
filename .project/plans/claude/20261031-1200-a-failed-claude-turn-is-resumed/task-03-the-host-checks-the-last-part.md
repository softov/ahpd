---
title: The host checks the last part
status: implemented
depends:
  - task-01-a-failed-model-call-is-resumable.md
layer: sdk
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1081-L1090](../../../../packages/sdk/src/host/chatactions.ts#L1081-L1090) - the host's `chat/turnResume`"
  - "[code://packages/sdk/test/host-turn.test.ts#L830-L875](../../../../packages/sdk/test/host-turn.test.ts#L830-L875) - the host's resume cases"
  - "[code://packages/sdk/test/echo-origin.test.ts#L172-L195](../../../../packages/sdk/test/echo-origin.test.ts#L172-L195) - the echo of a resume a backend accepts"
---

## Objective

The host refuses `chat/turnResume` when the latest turn of the chat is not the one named, or its last part is not a resumable error.
It checks before it calls `session.resume`, with the protocol's words in the refusal.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1081-1090` - read `session.chatState()`, and check the latest turn and its last part.
- `UPDATE: packages/sdk/test/host-turn.test.ts:830-875` - the resume case sends a failure that is resumable, and a new case is refused.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - the fake backend's failed turn ends with a resumable error part.

## Steps

1. In the `chat/turnResume` case, read `turns` from `session.chatState()`.
2. Refuse when the last turn's id is not `action.turnId`, with "is not the latest turn".
3. Refuse a turn with no `resumable: true` on its last part: "did not end with an error that can be resumed".
4. Keep the refusal for a backend with no `resume`, and the one for `resume` answering `false`.
5. In `host-turn.test.ts`, make the failed `result` one that task 01 marks resumable.
6. Add a case where the host refuses a turn whose error part is not resumable.
7. Check that the host does not call `session.resume` in that case.
8. Make the fake turn in `echo-origin.test.ts` end with a resumable error part.

## Validation

- `pnpm vitest run packages/sdk/test/host-turn.test.ts packages/sdk/test/echo-origin.test.ts` passes.
- `pnpm vitest run packages/agent-pi/test` passes, so the pi resume still gets through the check.
- `pnpm typecheck` is clean.

## Resume

Done, all eight steps. The host checks the latest turn and its last part before it calls `session.resume`, and refuses a turn that fails either.
Found: the case that is refused drives the Claude backend, so it also checks that no new CLI starts. The name of the test that refuses a turn that is not latest changed to the host's new words.

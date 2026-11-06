---
title: The pi session resumes the turn
status: done
depends:
  - task-01-a-failed-model-call-is-resumable.md
  - task-02-pi-continues-from-the-failed-call.md
layer: agent-pi
refs:
  - "[code://packages/agent-claude/src/session/turns.ts#L744-L780](../../../../packages/agent-claude/src/session/turns.ts#L744-L780) - the Claude backend's `resume`, the sibling to copy"
  - "[code://packages/agent-pi/src/session.ts#L979-L1104](../../../../packages/agent-pi/src/session.ts#L979-L1104) - `begin`, which opens the mapping and the watched record"
  - "[code://packages/agent-pi/src/session.ts#L786-L805](../../../../packages/agent-pi/src/session.ts#L786-L805) - `agent_settled`, whose checks a resumed run ends with"
  - "[code://packages/sdk/src/host.ts#L759-L780](../../../../packages/sdk/src/host.ts#L759-L780) - `originOf`, which makes the emitted action the client's echo"
  - "[code://docs/sdk/AHP.md#L278](../../../../docs/sdk/AHP.md#L278) - the support row for `chat/turnResume`"
---

## Objective

The pi session gets `resume(turnId)`.
It reopens the failed turn, sends `chat/turnResume`, and asks the backend to continue.
The turn then ends as a live turn ends.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:786-805` - move the checks of `agent_settled` into `settle`, which a resumed run calls too.
- `UPDATE: packages/agent-pi/src/session.ts:1284-1400` - add `resume` to the session object.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - add the cases of this task.
- `UPDATE: packages/sdk/test/host-turn.test.ts` - add a case where a resume that a backend accepts is echoed to its sender.
- `UPDATE: docs/sdk/AHP.md:278` - say which backends resume a turn.
- `UPDATE: packages/agent-pi/README.md` - say that a failed model call can be resumed, and how pi continues.

## Steps

1. Move the body of `case 'agent_settled'` into a function `settle`, and call it there.
2. Add `resume(turnId)` to the session object.
3. Answer `false` when a turn runs or the session has closed.
4. Answer `false` when the last turn in `turns` is not `turnId` or is not `error`.
5. Answer `false` when the last part of that turn is not a resumable error.
6. Take the turn off `turns`, and delete its `state` and `duration`.
7. Make it `active`, and reset `failed`, `cancelled`, `answered` and `spent`.
8. Open a new mapping on the turn's own `responseParts`, as `begin` does.
9. Find the watched record with the same turn id, set it to the same parts, and make it `watched`.
10. Emit `chat/turnResume` with the turn id, set the activity to "Thinking", and call `touch`.
11. Open the backend with `opened()`, then call `backend.resume()`.
12. When `resume()` answers `true`, call `settle` if the turn is still active.
13. When `resume()` answers `false`, end the turn with `finish('error', ...)`, with no `resumable`.
14. When `resume()` throws, end the turn with `finish('error', reason(error), true)`.
15. Add a test that a resume reopens the turn, keeps its parts, and sends `chat/turnResume` first.
16. Add a test that a resumed run that completes ends with `chat/turnComplete` and one turn in `turns`.
17. Add a test that a resumed run that fails again ends with two error parts, the last one resumable.
18. Add a test that `resume` answers `false` for each case of steps 3 to 5.
19. Add a test that `cancel` during a resumed run ends the turn as cancelled.
20. Add the host test: a backend whose `resume` emits `chat/turnResume` answers the client with its `clientSeq`.
21. Update the `chat/turnResume` row in `AHP.md`, and the pi README.

## Validation

- `pnpm vitest run packages/agent-pi/test` passes, with the new cases.
- `pnpm vitest run packages/sdk/test/host-turn.test.ts` passes.
- `pnpm typecheck` is clean, and the whole suite passes before the push.
- By hand, use a test ahpd under XDG directories, and make a pi turn fail on a bad key.
- Fix the key, resume the turn in VS Code, and check that it continues.

---
title: A failed model call is resumable
status: done
depends: []
layer: agent-pi
refs:
  - "[code://packages/agent-pi/src/session.ts#L657-L701](../../../../packages/agent-pi/src/session.ts#L657-L701) - `finish`"
  - "[code://packages/agent-pi/src/session.ts#L786-L805](../../../../packages/agent-pi/src/session.ts#L786-L805) - `agent_settled`, the end of a failed model call"
  - "[code://packages/agent-pi/src/replay.ts#L99-L124](../../../../packages/agent-pi/src/replay.ts#L99-L124) - `seal` in `replayEntries`"
---

## Objective

A pi turn that ends on a failed model call has an error part with `resumable: true`.
The part is on the `chat/error` action and on the turn that the snapshot holds.
A failure before the prompt has an error part with no `resumable`.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:657-701` - `finish` takes whether the failure is resumable, and puts the error part on the turn.
- `UPDATE: packages/agent-pi/src/session.ts:786-805` - `agent_settled` asks for a resumable error.
- `UPDATE: packages/agent-pi/src/replay.ts:89-221` - the last turn read back from the file gets a resumable error part when it failed.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - add the cases of this task.
- `UPDATE: packages/agent-pi/test/agent-pi-disk.test.ts` - add the case of a failed last turn read back.

## Steps

1. Add a third parameter `resumable` to `finish`, used only when the ending is `error`.
2. In `finish`, build the error part once, with `resumable: true` when `resumable` is true.
3. In `finish`, push the error part onto the turn's `responseParts` before the turn goes into `turns`.
4. In `finish`, send the same part on `chat/error`.
5. In `agent_settled`, call `finish('error', answered.errorMessage, true)` for a failed model call.
6. Keep the `begin` catch on `finish('error', reason(error))`, with no `resumable`.
7. In `replayEntries`, set `resumable: true` on the error part of the last turn only, after the loop seals it.
8. Add a test that a failed model call sends a resumable part on `chat/error`.
9. In the same test, check that `chatState()` holds the same part on the turn.
10. Add a test that a turn on an unknown model ends with an error part that has no `resumable`.
11. Add a test that only the last failed turn read back from a file has a resumable part.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts` and `agent-pi-disk.test.ts` pass, with the new cases.
- `pnpm typecheck` is clean.

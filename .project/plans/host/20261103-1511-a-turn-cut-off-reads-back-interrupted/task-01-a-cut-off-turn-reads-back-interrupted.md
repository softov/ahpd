---
title: A cut-off turn reads back interrupted
status: todo
depends: []
layer: agent-pi, agent-acp
refs:
  - "[code://packages/agent-pi/src/replay.ts](../../../../packages/agent-pi/src/replay.ts) - `replayEntries`"
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - `resume`"
  - "[code://packages/agent-acp/src/transcript.ts](../../../../packages/agent-acp/src/transcript.ts) - `replayedTurns` and `turnsOf`"
---

## Objective

The last turn of a pi file or an ACP replay that ends while the turn's request still runs reads back in error.
Its last part is VS Code's `executionInterrupted` error, resumable for pi and not for ACP.
A pi resume of it asks the model again from where the file ends.

## Files

- `UPDATE: packages/agent-pi/src/replay.ts` - the last turn read back interrupted, with the error part.
- `UPDATE: packages/agent-pi/src/backend.ts` - `resumePoint`, and `resume` from an interrupted request as well as a failed reply.
- `UPDATE: packages/agent-pi/src/session.ts` - the words of a resume with nothing to continue from.
- `UPDATE: packages/agent-acp/src/transcript.ts` - the last replayed turn marked interrupted, and its error part in `turnsOf`.
- `UPDATE: packages/agent-acp/src/types.ts` - `WatchedTurn.interrupted`.
- `UPDATE: packages/agent-pi/test/agent-pi-disk.test.ts` - the cases of a cut-off turn and of `resumePoint`.
- `UPDATE: packages/agent-acp/test/agent-acp-catalog.test.ts` - the cases of a cut-off replay.
- `UPDATE: docs/sdk/AHP.md` - the `chat/turnResume` row.

## Steps

1. Read pi's last turn interrupted when its last answer asked for tools, or it has no answer.
2. Add the `executionInterrupted` part after the turn's parts, and end the turn in error.
3. Add `resumePoint`, which says what a resume drops from the model's context and whether it continues at all.
4. Continue in `resume` from a prompt or a tool's result, and from a cut-off answer after its drop.
5. Mark ACP's last replayed turn interrupted when a call is open, or no message follows its last call.
6. Add the part in `turnsOf` for an interrupted turn, with no `resumable`.
7. Add the cases, and change the pi case that read a call with no result as stopped.

## Validation

- The new and changed cases fail on `296c9b01`'s sources and pass after.
- `agent-pi-disk.test.ts` and `agent-acp-catalog.test.ts` pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.

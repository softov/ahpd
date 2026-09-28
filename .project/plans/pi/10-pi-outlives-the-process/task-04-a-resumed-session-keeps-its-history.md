---
title: A resumed pi session keeps its history, and a stopped turn from disk reads cancelled
status: done
depends: [task-03-a-session-from-disk-is-replayed.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L142](../../../../packages/agent-pi/src/session.ts#L142) - `watchedTurns`, the record a resumed session starts"
  - "[code://packages/agent-pi/src/session.ts#L157-L163](../../../../packages/agent-pi/src/session.ts#L157-L163) - the replay a resumed session reads, which seeds `ends`"
  - "[code://packages/agent-pi/src/replay.ts#L98](../../../../packages/agent-pi/src/replay.ts#L98) - the state a replayed turn ends in"
---

## Objective

A pi session resumed from its file and run again answers `transcript` with the turns from the file followed by the new ones, and a replayed turn whose last answer was aborted reads `cancelled`, as a stopped live turn does.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - the replay that seeds `ends` also puts the replayed turns at the head of the watched record.
- `UPDATE: packages/agent-pi/src/replay.ts` - a turn whose last assistant message has `stopReason: 'aborted'` is `cancelled`.
- `UPDATE: packages/agent-pi/README.md` - the catalogue paragraph says a running session answers after the turns it resumed from the file.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. When a session resumes, put the replayed turns ahead of any turn it has already run in `watchedTurns`, from the same replay that seeds `ends`.
2. In `replayEntries`, seal a turn whose last assistant message was aborted as `cancelled`.
3. Keep the error part on a replayed failed turn.

## Validation

- A case: a file with two turns, resumed through `create`, one turn run, and `transcript(id)` answers all three in order.
- A case: a turn whose last answer has `stopReason: 'aborted'` replays as `cancelled`.
- Both fail first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-28.
The resumed session's replay in `session.ts` now also puts the replayed turns at the head of `watchedTurns`, ahead of any turn the session ran before the replay answered, so the record `watch` registers holds the file's turns and then the new ones.
`replayEntries` seals a turn as `error` when its last assistant message failed, `cancelled` when it was aborted, and `complete` otherwise; the error part on a failed turn stays.
The README's catalogue paragraph says a running session answers after the turns it resumed from the file.
The resume case in `test/agent-pi.test.ts` writes a two-turn file with pi's `SessionManager`, resumes it through an agent's `create` over the fake backend given the file's id, runs one turn and reads the transcript.
It failed first with `AssertionError: expected [ 't3' ] to deeply equal [ 'cf3bd504', 'f8c581b6', 't3' ]`.
The aborted case replays a user message and an aborted answer and failed first with `AssertionError: expected [ 'complete' ] to deeply equal [ 'cancelled' ]`.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 106 files, 1460 tests passed.

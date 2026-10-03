---
title: ACP tool calls carry their start and end while the daemon runs
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/types.ts#L314-L336](../../../../packages/agent-acp/src/types.ts#L314-L336) - `WatchedTurn.updates`, raw `SessionUpdate[]` with no receive time"
  - "[code://packages/agent-acp/src/session.ts#L669-L678](../../../../packages/agent-acp/src/session.ts#L669-L678) - where a live update is stored, then mapped"
  - "[code://packages/agent-acp/src/mapping.ts#L334](../../../../packages/agent-acp/src/mapping.ts#L334) - `mapUpdate(turn, update)`; `tool_call` at 363 and `tool_call_update` at 379"
  - "[code://packages/agent-acp/src/transcript.ts#L50](../../../../packages/agent-acp/src/transcript.ts#L50) - the transcript re-runs `mapUpdate` over the stored updates"
  - "[code://packages/agent-acp/src/transcript.ts#L98-L120](../../../../packages/agent-acp/src/transcript.ts#L98-L120) - `replayedTurns`, the `session/load` replay, whose updates have no time of their own"
  - "[code://packages/agent-acp/src/agent.ts#L96-L104](../../../../packages/agent-acp/src/agent.ts#L96-L104) - the transcript is in memory and lost on restart"
---

## Objective

The plugin stamps a call's start and end with the times it received them, the start at the update the plan's open question settles and the end at the update that ends the call, and keeps them with the stored updates so the in-memory transcript has them. ACP has no time of its own; a call replayed by `session/load` after a restart carries no times, since its receive time is the replay's.

## Files

- `UPDATE: packages/agent-acp/src/types.ts:335` - `WatchedTurn.updates` becomes `{ update: SessionUpdate; at?: number }[]`.
- `UPDATE: packages/agent-acp/src/session.ts:669` - stores `{ update, at: Date.now() }` and passes `at` to `mapUpdate`.
- `UPDATE: packages/agent-acp/src/mapping.ts:334` - `mapUpdate(turn, update, at?)`, stamping the start and the end in the `tool_call` (363) and `tool_call_update` (379) cases only when `at` is given.
- `UPDATE: packages/agent-acp/src/transcript.ts:50` and `:98-120` - the transcript passes each stored `at`; `replayedTurns` stores updates with no `at`.
- `UPDATE: packages/agent-acp/test/agent-acp.test.ts` - the cases below.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1.
3. The moment a call's start is stamped waits on the plan's open question; the end is the receive time of the update that completes or fails it.
4. Every `_meta` sent after the start carries the times and `toolKind` again.

## Validation

- A call carries the three keys live and in a re-subscribe before a restart.
- A call opened by `tool_call_update` with no `tool_call` before it is stamped too.
- A call replayed by `session/load` carries none.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

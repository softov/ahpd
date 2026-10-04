---
title: ACP tool calls carry their start and end while the daemon runs
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/types.ts#L314-L336](../../../../packages/agent-acp/src/types.ts#L314-L336) - `WatchedTurn.updates`, raw `SessionUpdate[]` with no receive time"
  - "[code://packages/agent-acp/src/types.ts#L222-L249](../../../../packages/agent-acp/src/types.ts#L222-L249) - `AcpCall`, what the mapping keeps of a call between updates"
  - "[code://packages/agent-acp/src/session.ts#L669-L678](../../../../packages/agent-acp/src/session.ts#L669-L678) - where a live update is stored, then mapped"
  - "[code://packages/agent-acp/src/mapping.ts#L334](../../../../packages/agent-acp/src/mapping.ts#L334) - `mapUpdate(turn, update)`; `tool_call` at 363 and `tool_call_update` at 379"
  - "[code://packages/agent-acp/src/mapping.ts#L173-L179](../../../../packages/agent-acp/src/mapping.ts#L173-L179) - `opened`, the `chat/toolCallStart` for the first update about a call"
  - "[code://packages/agent-acp/src/mapping.ts#L188-L209](../../../../packages/agent-acp/src/mapping.ts#L188-L209) - `closed`, the `chat/toolCallComplete` for the update that ends it"
  - "[code://packages/agent-acp/src/session.ts#L846-L894](../../../../packages/agent-acp/src/session.ts#L846-L894) - a permission request, which can open a call's row before any update about it"
  - "[code://packages/agent-acp/src/session.ts#L1563-L1640](../../../../packages/agent-acp/src/session.ts#L1563-L1640) - the terminal call a person's own command runs"
  - "[code://packages/agent-acp/src/transcript.ts#L50](../../../../packages/agent-acp/src/transcript.ts#L50) - the transcript re-runs `mapUpdate` over the stored updates"
  - "[code://packages/agent-acp/src/transcript.ts#L98-L122](../../../../packages/agent-acp/src/transcript.ts#L98-L122) - `replayedTurns`, the `session/load` replay, whose updates have no time of their own"
  - "[code://packages/agent-acp/src/agent.ts#L104-L107](../../../../packages/agent-acp/src/agent.ts#L104-L107) - the transcript is this process's record, in memory and lost on restart"
---

## Objective

The plugin stamps a call's start with the time it received the first update about the call and its end with the time it received the update that ends it, and keeps those times with the stored updates so the in-memory transcript has them.
ACP has no time of its own; a call replayed by `session/load` after a restart carries no times, since its receive time is the replay's.

## Files

- `UPDATE: packages/agent-acp/src/types.ts:335` - `WatchedTurn.updates` becomes `{ update: SessionUpdate; at?: number }[]`.
- `UPDATE: packages/agent-acp/src/types.ts:222-249` - `AcpCall` gains `startedAt?: number`, the start's epoch milliseconds, so the end can be timed.
- `UPDATE: packages/agent-acp/src/session.ts:669-678` - takes `at = Date.now()` once, stores `{ update, at }` and passes `at` to `mapUpdate`.
- `UPDATE: packages/agent-acp/src/mapping.ts:334` - `mapUpdate(turn, update, at?)`, passing `at` to the two tool cases.
- `UPDATE: packages/agent-acp/src/mapping.ts:363-388` - in `tool_call` and `tool_call_update`, the update that opens the call (`opened`, at 173-179) stamps the start: `AcpCall.startedAt`, the held part's `toolCall._meta`, and `_meta` on the `chat/toolCallStart`; the update that closes it (`closed`, at 188-209) stamps the end on the held part and sends the whole `_meta` on the `chat/toolCallComplete`. Both only when `at` is given.
- `UPDATE: packages/agent-acp/src/session.ts:1563-1640` - the terminal call is stamped at its ready (`began`) and at its complete, on the held part and on both actions.
- `UPDATE: packages/agent-acp/src/transcript.ts:50` and `:98-122` - the transcript passes each stored `at`; `replayedTurns` stores updates with no `at`.
- `UPDATE: packages/agent-acp/test/agent-acp.test.ts` - the cases below.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1 (`callTimes`, `withCallTimes` from `@ahpd/sdk`); the keys are `ahpd.startedAt`, `ahpd.endedAt` and `ahpd.durationMs`.
3. The start is the receive time of the first `session/update` about the call, `tool_call` or `tool_call_update`, whichever comes first; a later update does not move it.
4. A call whose row a permission request opened (`session.ts:846-894`) has no start until its first update arrives, and that update stamps it; the permission request itself stamps nothing. The start then rides on the held part and on the first action the mapping sends for the call that takes `_meta` (`chat/toolCallReady`, `chat/toolCallContentChanged` or `chat/toolCallComplete`), since that update may open no row of its own.
5. The end is the receive time of the update that completes or fails it; a call that arrives finished in one update gets that one time as start and end, and `ahpd.durationMs` 0.
6. Every `_meta` sent after the start carries the times again; the plugin sends no `toolKind` for ACP today, so the times are the whole bag unless another key is added.

## Validation

- A call carries the three `ahpd.` keys live and in a re-subscribe before a restart, with the same values both ways.
- A call opened by `tool_call_update` with no `tool_call` before it is stamped too, at that update's time.
- A call whose `tool_call` says `pending` and a later update says `in_progress` starts at the `tool_call`'s time, not the later one.
- A call that arrives already `completed` has equal start and end and `ahpd.durationMs` 0.
- A call a permission request opened starts at its first update's time.
- The terminal call has all three.
- A call replayed by `session/load` carries none.
- No action or snapshot carries a bare `startedAt`, `endedAt` or `durationMs` in a tool call's `_meta`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

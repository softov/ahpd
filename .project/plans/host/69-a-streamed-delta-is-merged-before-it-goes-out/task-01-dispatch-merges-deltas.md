---
title: dispatch merges deltas within the window
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L555-L577](../../../../packages/sdk/src/host.ts#L555-L577) - `dispatch`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L112](../../../../packages/sdk/src/host/sessionmethods.ts#L112) - `subscribe`"
  - "[code://packages/sdk/src/host/handshake.ts#L187](../../../../packages/sdk/src/host/handshake.ts#L187) - `initialize`"
  - "[code://packages/sdk/src/host/handshake.ts#L361](../../../../packages/sdk/src/host/handshake.ts#L361) - `reconnect`"
---

## Objective

`chat/delta`, `chat/reasoning` and `chat/toolCallDelta` are merged per channel, kind, turn and part (or tool call) for `deltaWindowMs`. They go out before anything else is dispatched, before any snapshot, at the 16 KiB cap, and on dispose.

## Files

- `CREATE: packages/sdk/src/host/deltas.ts` - the merger: the window, the three kinds it gathers, the cap.
- `CREATE: packages/sdk/test/host-deltas.test.ts` - the host cases for the window, and the merger's own rules.
- `UPDATE: packages/sdk/src/types/host.ts:366` - `deltaWindowMs?: number`, with its default and 0.
- `UPDATE: packages/sdk/src/host.ts:595` - `dispatch` goes through the merger; `emit` is what it hands a flushed action to.
- `UPDATE: packages/sdk/src/host/context.ts:210` - `flushDeltas`, for everything that reads state before it answers.
- `UPDATE: packages/sdk/src/host/snapshots.ts:63` - `value` flushes the window and numbers the snapshot after it.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:124` - `subscribe` flushes before its snapshot.
- `UPDATE: packages/sdk/src/host/handshake.ts:183` - `initialize` flushes before its snapshots.
- `UPDATE: packages/sdk/src/host/handshake.ts:366` - `reconnect` flushes before the replay.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:433` - `removeSession` flushes before the session is torn down.
- `UPDATE: packages/sdk/test/host-turn.test.ts:41` - the two cases that read a delta off the wire wait for the window.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts:276` - one part's chunks are read as the text they add up to.

## Steps

1. Append `content` when a delta's key, `origin` and `_meta` match the pending entry; otherwise send the pending entry first.
2. Start one timer for the first delta of a key. When it fires, send every pending entry in the order it was first held.
3. Send every pending entry before an action that is not a mergeable delta.
4. `deltaWindowMs: 0` bypasses the merger.

## Validation

- The plan's checklist, and an `origin` change mid-stream keeping two envelopes.

## Resume

Implemented 2026-10-07.

- `packages/sdk/src/host/deltas.ts` holds the window. `merger({ windowMs, capBytes, send })` gathers the three kinds, merges an entry until the cap, and sends in first-held order.
- `dispatch` in `packages/sdk/src/host.ts` hands every action to it, and `emit` is the one place a sequence number moves. `flushDeltas` is on `HostContext`.
- `subscribe`, `initialize`, `reconnect`, `removeSession` and `close` flush before they read state.
- `packages/sdk/test/host-deltas.test.ts` holds the plan's four cases and the merger's own rules, the `origin` and `_meta` changes included.

A review of the built task found two defects, both fixed.

- A snapshot could carry held text and then be handed the delta that wrote it. `subscribe`, `initialize` and `reconnect` flush, but the state a snapshot holds is read after an `await`. That await is inside `snapshotOf`: a backend's worker list, a transcript. A delta arriving in it is held. The state was built from the parts it is already in. Its number was above `fromSeq`, so it was replayed on top of the words it wrote. `value` in `packages/sdk/src/host/snapshots.ts` now flushes and reads `ctx.serverSeq` after the flush, so a delta flushed there sits at or below `fromSeq`. The three earlier calls stay: they still send what is held before a read that may take a while.
- A delta pushed after `close` began was held and sent by a timer after the host was closed. The merger has `stop()`, which flushes and holds nothing after, and `close` calls it in place of `flush()`. A delta a session emits as it goes is now sent on the tick it is dispatched.
- Both have a case that fails without the fix: a chat snapshot read across an await, and a host closed around a delta.

Found while building: three cases in other files expect a delta on the wire the instant a frame is read. Each compared one chunk with one action. Two are in `packages/sdk/test/host-turn.test.ts` and one in `packages/agent-acp/test/agent-acp-turn.test.ts`. All three now wait for the window, or compare the text their chunks add up to. The plan's own risk note covers this: a client that counts envelopes sees fewer, and the protocol promises no count.

Departures from the plan:

- `packages/sdk/src/host/context.ts`, `packages/sdk/src/host/lifecycle.ts` and `packages/sdk/src/host/snapshots.ts` are additions to the Files list. A disposal flush needs `flushDeltas` on the context. A session is disposed in `removeSession`, and a snapshot's number is decided in `value`.
- The plan names two test files; three were touched, for the reason above.

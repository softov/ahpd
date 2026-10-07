---
title: dispatch merges deltas within the window
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L555-L577](../../../../packages/sdk/src/host.ts#L555-L577) - `dispatch`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L112](../../../../packages/sdk/src/host/sessionmethods.ts#L112) - `subscribe`"
  - "[code://packages/sdk/src/host/handshake.ts#L187](../../../../packages/sdk/src/host/handshake.ts#L187) - `initialize`"
  - "[code://packages/sdk/src/host/handshake.ts#L361](../../../../packages/sdk/src/host/handshake.ts#L361) - `reconnect`"
---

## Objective

`chat/delta`, `chat/reasoning` and `chat/toolCallDelta` are merged per channel, kind, turn and part (or tool call) for `deltaWindowMs`, and flushed before anything else is dispatched, before any snapshot, at the 16 KiB cap, and on dispose.

## Files

- `CREATE: packages/sdk/src/host/deltas.ts` - the merger.
- `UPDATE: packages/sdk/src/types/host.ts:68` - `deltaWindowMs?: number`, documented with its default and 0.
- `UPDATE: packages/sdk/src/host.ts:555` - `dispatch` goes through the merger.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts`, `packages/sdk/src/host/handshake.ts` - flush before a snapshot.
- `CREATE: packages/sdk/test/host-deltas.test.ts`.

## Steps

1. A delta with a key already pending, the same `origin` and the same `_meta`, appends its `content` (and replaces `invocationMessage`); otherwise the pending one is flushed first.
2. The first delta for a key starts one timer for the merger; when it fires, everything pending is flushed in the order it was first held.
3. A non-delta action flushes everything, then is dispatched.
4. `deltaWindowMs: 0` bypasses the merger.

## Validation

- The plan's checklist, and an `origin` change mid-stream keeping two envelopes.

## Resume

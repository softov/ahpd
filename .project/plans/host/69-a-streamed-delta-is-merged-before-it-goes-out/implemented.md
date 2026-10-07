---
title: Streamed deltas are merged for a short window in the host's dispatch, for every backend - implemented
date: 2026-10-07
refs:
  - git://45a17d3 - the commit this work sits on; none of it is committed yet, on `build/agents/908948c2`
  - "[code://packages/sdk/src/host/deltas.ts](../../../../packages/sdk/src/host/deltas.ts) - the window, the three kinds it gathers, the cap, `stop`"
  - "[code://packages/sdk/src/host/snapshots.ts#L63](../../../../packages/sdk/src/host/snapshots.ts#L63) - `value` flushes, then numbers the snapshot after the flush"
  - "[code://packages/sdk/src/host.ts#L556-L599](../../../../packages/sdk/src/host.ts#L556-L599) - `emit` is the one sequence number, `dispatch` sends through the merger"
  - "[code://packages/sdk/src/types/host.ts#L366](../../../../packages/sdk/src/types/host.ts#L366) - `deltaWindowMs`"
  - "[code://packages/server/src/commands/options.ts#L417](../../../../packages/server/src/commands/options.ts#L417) - the flag, the file's schema and the range check"
  - "[code://docs/DAEMON.md#L525](../../../../docs/DAEMON.md#L525) - the key, its default and its range"
---

A streaming turn now sends one merged action per part per window instead of one per token.
It does so for acp, claude, pi, cofold and subagent chats alike.
The window lives in the host's dispatch, so no backend carries code of its own for it.
What a client draws is the text it would have drawn anyway.
`deltaWindowMs` is 75 by default, and 0 sends every delta as it arrives.

## What was built

- [`code://packages/sdk/src/host/deltas.ts`](../../../../packages/sdk/src/host/deltas.ts) - `merger({ windowMs, capBytes, send })` gathers `chat/delta`, `chat/reasoning` and `chat/toolCallDelta` by channel, kind, turn and part (or tool call). `push` answers whether it held the action, merging `content` until the 16 KiB cap, and `flush` sends everything held, oldest first. `stop` sends what is held and holds nothing after. A different `origin` or `_meta` flushes first, and a tool call's `invocationMessage` is the last one sent. `DELTA_WINDOW_MS` is 75 and `DELTA_CAP_BYTES` is 16 KiB.
- [`code://packages/sdk/src/host.ts#L556-L599`](../../../../packages/sdk/src/host.ts#L556-L599) - `emit` is the one place `serverSeq` moves, the telemetry, the replay slot and the broadcast. `dispatch` hands every action to the merger first and sends itself whatever is not held. The merger is built from `options.deltaWindowMs`, and `close` stops the window before it tears anything down.
- [`code://packages/sdk/src/host/context.ts#L210`](../../../../packages/sdk/src/host/context.ts#L210) - `flushDeltas` on `HostContext`, for everything that reads state before it answers.
- [`code://packages/sdk/src/host/sessionmethods.ts#L124`](../../../../packages/sdk/src/host/sessionmethods.ts#L124), [`code://packages/sdk/src/host/handshake.ts#L183`](../../../../packages/sdk/src/host/handshake.ts#L183), [`code://packages/sdk/src/host/handshake.ts#L366`](../../../../packages/sdk/src/host/handshake.ts#L366), [`code://packages/sdk/src/host/lifecycle.ts#L433`](../../../../packages/sdk/src/host/lifecycle.ts#L433) - `subscribe`, `initialize`, `reconnect` and `removeSession` flush before they read state or dispose of a session.
- [`code://packages/sdk/src/host/snapshots.ts#L63`](../../../../packages/sdk/src/host/snapshots.ts#L63) - `value` flushes and then reads `ctx.serverSeq`, so every snapshot that carries `fromSeq` is numbered after the flush. A snapshot is built from the parts a backend is still writing into, so it already holds the held text. A delta flushed here sits at or below the number, and is not replayed on top of it.
- [`code://packages/sdk/src/types/host.ts#L366`](../../../../packages/sdk/src/types/host.ts#L366) - `deltaWindowMs?: number` on `HostOptions`.
- [`code://packages/server/src/config.ts#L183`](../../../../packages/server/src/config.ts#L183), [`code://packages/server/src/commands/options.ts#L67`](../../../../packages/server/src/commands/options.ts#L67), [`code://packages/server/src/commands/options.ts#L417`](../../../../packages/server/src/commands/options.ts#L417), [`code://packages/server/src/commands/options.ts#L879`](../../../../packages/server/src/commands/options.ts#L879) - the daemon's key. It is a field in `serverFields`, so it is the flag `--delta-window-ms`, the key `config.json` may hold and a range check of 0 to 1000. `optionsFrom` leaves an absent value absent, so the host's own 75 is the one place the default is held.
- [`code://packages/server/src/commands/run.ts#L593`](../../../../packages/server/src/commands/run.ts#L593) - the option reaches `createHost` when it is set.
- [`code://docs/DAEMON.md#L525`](../../../../docs/DAEMON.md#L525) - what the key does, its default and its range.

## Verified

- `pnpm build` clean; `pnpm typecheck` clean; `pnpm boundary` - 25 declared across the eight packages, none undeclared.
- `npx vitest run` from the root - **237 files, 3510 tests, all passing**, none skipped.
- `packages/sdk/test/host-deltas.test.ts` (13 cases) - 500 one-character deltas arrive as the same text in fewer than fifty envelopes. A `chat/turnComplete` emitted while text is held reaches the client after that text. A client that subscribes mid-stream ends with the text once rather than twice, and `deltaWindowMs: 0` sends three deltas as three actions. The window's own rules are checked against a collecting `send`. One part merges and another stays alone, an action it cannot merge flushes first, and an `origin` or `_meta` change stays its own action. The cap lets an entry go, and a tool call keeps the last `invocationMessage` it was given. A chat snapshot read across an `await`, with a delta emitted in between, holds the text once and is replayed nothing. A host closed around a delta sends it on that tick, and nothing follows.
- `packages/server/test/config-check.test.ts` (49 cases) - 1001 and 7.5 refused as `deltaWindowMs must be an integer between 0 and 1000`, and an absent value, 0 and 75 read onto the options.
- Four touched suites together - **119 cases**, all passing.

## Departures from the plan

- Task 01's *Files* list did not name `packages/sdk/src/host/context.ts`, `packages/sdk/src/host/lifecycle.ts` and `packages/sdk/src/host/snapshots.ts`. A disposal flush needs `flushDeltas` on the context. A session is disposed in `removeSession`. A snapshot's number is decided in `value`. All three are additions rather than choices.
- Task 02's *Files* list named `packages/server/src/config.ts` alone. The key also needs a field in `packages/server/src/commands/options.ts`. That field is what the flag, the file's schema and the range check are built from. One line in `packages/server/src/commands/run.ts` hands it over. Both follow `clientToolTimeoutMs`.
- The plan names two test files; four were touched. Three cases elsewhere read a delta off the wire the instant a frame was read, and compared one chunk with one action. Two are in `packages/sdk/test/host-turn.test.ts`; one is in `packages/agent-acp/test/agent-acp-turn.test.ts`. Each now waits for the window, or compares the text its chunks add up to. The plan's own risk note covers this: a client that counts envelopes sees fewer, and the protocol promises no count.
- `packages/sdk/test/fixtures/wire.jsonl` is regenerated by `packages/sdk/test/wire.test.ts`, which treats it as an output and never an input. Merged deltas mean fewer envelopes and different sequence numbers, so the fixture moves with the change.

## What a review found

Two defects were found in the built plan, both fixed, both tasks staying `implemented`.

- A snapshot could carry a delta's text and then be handed the delta that wrote it. `subscribe`, `initialize` and `reconnect` flush before they ask for a snapshot, but the chat branches build their state after an `await` - `restoredSubagents`, `past`, `readFacts`. A delta a backend pushes during that await is held, and the state already holds its text. Its number then lands above the snapshot's `fromSeq`, so the subscriber draws the words twice. [`code://packages/sdk/src/host/snapshots.ts#L63`](../../../../packages/sdk/src/host/snapshots.ts#L63) - `value` now flushes and reads `ctx.serverSeq` after the flush, so a delta flushed there sits at or below the number stamped on the snapshot. The three earlier calls stay: they still send what is held before a read that may take a while.
- A delta pushed after `close` began was still held, and a timer sent it after the host was closed. [`code://packages/sdk/src/host.ts#L556-L599`](../../../../packages/sdk/src/host.ts#L556-L599) - `close` calls `deltas.stop()` where it called `flush()`. `stop` sends what is held and holds nothing after. A delta a session emits as it goes is sent on the tick it is dispatched.
- Each has a case that fails without its fix, in [`code://packages/sdk/test/host-deltas.test.ts`](../../../../packages/sdk/test/host-deltas.test.ts). One reads a chat snapshot across a worker list that resolves on a later tick, with a delta emitted in between. Another closes a host around a delta. The merger's own `stop` has a unit case beside them.

## Left for later

- Text arrives up to 75 ms later than it did. A client that draws a typing effect gets a coarser one.


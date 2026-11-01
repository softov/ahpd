---
title: A client is owed the state it lost
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/handshake.ts](../../../../packages/sdk/src/host/handshake.ts) - `reconnect`, which chooses a replay or snapshots"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `statesUnwatched`, which lets a session's states go"
  - "[code://packages/sdk/src/host/routing.ts](../../../../packages/sdk/src/host/routing.ts) - `answeredAs`, which every snapshot a client is sent passes through"
---

## Objective

A client served a state the host has let go of since is answered with snapshots when it reconnects.
Its state came from an opening the host no longer holds, so the actions since cannot be replayed onto it.

## Files

- `UPDATE: packages/sdk/src/host/state.ts:67-70` - `HeldState.baselines`, the clients the state was served to.
- `UPDATE: packages/sdk/src/host/context.ts:394` - `lapsed`, the channels each client was served a state of that has gone since.
- `UPDATE: packages/sdk/src/host.ts:1157-1172` - a state let go marks each client it was served to.
- `UPDATE: packages/sdk/src/host/routing.ts:352-354` - a snapshot sent records its client, and clears what it was owed for the channel.
- `UPDATE: packages/sdk/src/host/handshake.ts:596-603` - a reconnect owed a channel's state is answered with snapshots.
- `UPDATE: packages/sdk/test/session-sleep.test.ts` - a client back from a drop, after its session slept, is sent the state read again.

## Steps

1. Give `HeldState` the ids of the clients that hold it, and add each one in `answeredAs`.
2. When the host lets a state go, add its channel to the lapsed set of each of those clients.
3. Answer with snapshots when a client resumes a channel in its lapsed set.
4. Take a channel out of a client's lapsed set as its snapshot goes.

## Validation

- Before the change, the host answers a client back from a drop with a replay, after its session slept.
- After it, the answer is snapshots, carrying the turns the record holds.
- The handshake, sleep and reconnect suites pass.

## Resume

<Empty until started.>

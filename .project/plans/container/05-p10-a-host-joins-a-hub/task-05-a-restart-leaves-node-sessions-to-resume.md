---
title: A restart of the hub or the node leaves its sessions to resume
status: done
depends: [task-04-the-hub-lists-a-node.md]
layer: "sdk | server"
refs:
  - "[code://.project/plans/daemon/13-ahpd-restart/plan.md](../../daemon/13-ahpd-restart/plan.md) - `ahpd restart`: quiesce, end agents, resume sessions from the store"
  - "[code://packages/sdk/src/sessions/nested.ts#L404](../../../../packages/sdk/src/sessions/nested.ts#L404) - `innerSession`, which container/04 task 11 names by the outer id"
---

## Objective

After `ahpd restart` on the hub, a session on a node resumes once the node reconnects.
When the node's `ahpd join` restarts, the hub option `nodeRestart` picks what the session does: `end`, the default, or `reconnect`.

## Files

- `UPDATE: packages/sdk/src/nodes.ts` - `connect` for a node that is reconnecting waits a bounded time for it.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - a resumed session reopens through `start` with `resume`, by container/04 task 11.
- `UPDATE: packages/server/src/commands/options.ts` - `nodeRestart: 'end' | 'reconnect'` in `serverFields`, default `end`.
- `UPDATE: packages/server/src/config.ts` - `nodeRestart` in `Config`, taken from `serverFields`.
- `UPDATE: packages/server/src/commands/run.ts` - `nodeRestart` in the base `HostOptions`.
- `UPDATE: packages/sdk/src/types/host.ts` - `HostOptions.nodeRestart`, the choice a proxy carries.
- `UPDATE: packages/sdk/src/host/spawn.ts` - `nodeRestart` passed to `nestedAgent`.
- `UPDATE: packages/sdk/test/nodes.test.ts` - the hub restart and both `nodeRestart` values.
- `UPDATE: packages/server/test/join.test.ts` - the node restart through `ahpd join`.

## Steps

1. Close the hub's data sockets with p9 task 05's `stopping`, so that the close disposes no inner session.
2. Keep no session state on the node: resume from the inner host's store under the node's config directory.
3. End a session with a sentence that names the node when the node does not come back within the bound.
4. Add `nodeRestart` to `serverFields`, with the values `end` and `reconnect` and the default `end`.
5. With `end`, end the session with a sentence when its node's data socket closes.
6. With `end`, resume the session by id on its next turn.
7. With `reconnect`, keep the session and reopen it through the node's new data socket when the node joins again.

## Validation

- `nodes.test.ts`: a session answers a turn, then the hub closes. A second hub resumes it against the same fake node store, with the earlier turn in the snapshot.
- A node that reconnects after its control socket dropped is in the list again under the same id.
- `nodes.test.ts`: with `nodeRestart: 'end'`, a node restart ends the session with a sentence.
- `nodes.test.ts`: with `nodeRestart: 'end'`, the next turn resumes the session with the earlier turn in the snapshot.
- `nodes.test.ts`: with `nodeRestart: 'reconnect'`, a node restart keeps the session, and its next turn answers through the new data socket.

## Resume

The choice reaches the proxy: `nodeRestart` is declared in `serverFields` and carried in `Config`.
`run.ts` puts it on the base `HostOptions`, `spawn.ts` passes it to `nestedAgent`, and the proxy reads it as `NestedOptions.restart`.
It defaults to `end` at every step, so a hub that says nothing about it behaves as the earlier one did.

`connect` waits `RECONNECT_WAIT_MS` for a node it knows and cannot reach.
The wait is ten seconds, and a test lowers it with `liveNodes({ reconnectMs })`.
A node that does not arrive in that time is refused with `node <id> is not connected`.

`end` halts the session rather than ending it.
The session is shown as failed with `computer://<id> ended: <why>`, and the next turn opens it again at its own id against the node's store.
`ended` is left alone: a session whose `ended()` answers refuses every later action, that turn included.
`reconnect` keeps the session and reopens it through the node's next data socket.
`resuming` is set, so the inner session is subscribed to rather than made a second time.
A reopened proxy re-arms its `gone` and `exited` flags, and clears `halted` once the host is up.

Verified with `pnpm exec tsc -p tsconfig.json --noEmit` (clean) and `pnpm exec vitest run packages/sdk/test/nodes.test.ts packages/server/test/join.test.ts --maxWorkers=2 --testTimeout=20000` (16 passed).
`nodes.test.ts` covers all five Validation bullets.
It resumes a session from a second hub on the same folder, takes both `end` cases and the `reconnect` case, and waits out the bound.
`join.test.ts` covers the node restart through the real `ahpd join`.
The control socket drops, the node dials again, and the session's data socket and its host pid both survive it.

Departed from *Steps* 5 and 6 as written: `end` does not set `ended`.
The host refuses every action on a session whose `ended()` answers, and the next turn is one of them.
A separate `halted` state carries the sentence and the resumption, and `ended` keeps its meaning of a session gone for good.

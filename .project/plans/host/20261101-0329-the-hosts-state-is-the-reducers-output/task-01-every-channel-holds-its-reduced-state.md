---
title: Every channel holds its reduced state
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host.ts#L825-L863](../../../../packages/sdk/src/host.ts#L825-L863) - `emit`, where the reducer runs"
  - "[code://packages/sdk/src/host/snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts) - the assemblies that become seeds"
  - "[code://packages/sdk/src/host/spawn.ts#L212-L218](../../../../packages/sdk/src/host/spawn.ts#L212-L218) - the worker chat's own reduction, which goes"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1834-L1836](../../../../packages/sdk/src/host/lifecycle.ts#L1834-L1836) - a created session's title and bits, written after its backend started"
---

## Objective

The host holds the state of every root, session and chat channel it serves, and each action it sends reduces into that state first.
Each channel opens once from its seed, and a subscribe is answered with the held state.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the held states, the reduction in `emit`, a session opened at its first action, and its state let go when nobody watches it.
- `UPDATE: packages/sdk/src/host/state.ts` - `HeldState`; a worker's row data keeps no state of its own.
- `UPDATE: packages/sdk/src/host/context.ts` - `stateOf`, `openState`, `closeState`, `statesUnwatched`, `asleep`, `laidCustomizations`.
- `UPDATE: packages/sdk/src/host/snapshots.ts` - `sessionSeed`, `chatSeed` and the record's seed; a subscribe serves the held state.
- `UPDATE: packages/sdk/src/host/spawn.ts` - a chat opens at the end of `spawn`; a worker chat opens when it is spawned.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - a created session's title and bits come before its backend starts; a disposal lets its states go.
- `UPDATE: packages/sdk/src/host/sleep.ts` - a session put to sleep is counted and keeps its state while watched.

## Steps

1. Hold a `HeldState` per channel in `host.ts`, and reduce each action through `rootReducer`, `sessionReducer` or `chatReducer`.
2. Reduce from the frozen copy the replay buffer keeps, before the observers read the action.
3. Build `sessionSeed` and `chatSeed` from the live assemblies, with turns left whole for the window.
4. Open a running chat at the end of `spawn`, after the delta window empties.
5. Open a worker chat in `openSubagent`, and drop `absorb` and its stamp on `modifiedAt`.
6. Open a running session at its first session action or subscribe, and a session not running at its first subscribe.
7. Serve each subscribe from the held state, cut to the subscribe's window of turns.
8. Write a created session's title, bits and origin before `spawn`, so its chat opens with them.
9. Let a disposed session's states go, and a sleeping session's once no connection watches them.

## Validation

- `pnpm exec vitest run packages/sdk/test/ahp-test-cases.test.ts` passes once task 05 removes the entries.
- `pnpm run typecheck` exits 0.

## Resume

Not started.

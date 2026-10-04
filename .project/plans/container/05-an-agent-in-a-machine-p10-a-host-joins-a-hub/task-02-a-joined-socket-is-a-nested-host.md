---
title: A joined socket is a nested host the proxy talks to
status: todo
depends: [task-01-ahpd-join-dials-the-hub.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L47](../../../../packages/sdk/src/nested.ts#L47) - `NestedHost`"
  - "[code://packages/sdk/src/nested.ts#L78](../../../../packages/sdk/src/nested.ts#L78) - `NestedOptions.start`"
  - "[code://packages/sdk/src/host/spawn.ts#L332-L334](../../../../packages/sdk/src/host/spawn.ts#L332-L334) - `nestedAgent(agent)`, built with no options today"
  - "[code://packages/sdk/src/listen.ts#L84-L127](../../../../packages/sdk/src/listen.ts#L84-L127) - the door"
---

## Objective

The hub's listener takes a node's control and data sockets at a join path, the node registry answers `connect(node, asked)` with the data socket wrapped as a `NestedHost`, and the host hands that to `nestedAgent` as `start`.

## Files

- `CREATE: packages/sdk/src/nodes.ts` - the registry: who is connected, `open`, the `NestedHost` wrapper (a line out is one socket message, a message in is a line, `kill` closes, a close is `exit`).
- `UPDATE: packages/sdk/src/listen.ts:84-127` - a join path whose token is checked against nodes, not people; it does not ask for the deployment token, since a node's own token is that door's credential and opens nothing else (task 03).
- `UPDATE: packages/sdk/src/types/computers.ts` - `ComputerPort.connect?`.
- `UPDATE: packages/sdk/src/host/spawn.ts:332-334` - `nestedAgent(agent, { start })` when the port has `connect`.
- `CREATE: packages/sdk/test/nodes.test.ts`.

## Steps

1. The `NestedHost` type moves to `types/computers.ts` so the port can name it; `nested.ts` re-exports it.
2. `connect` answers `undefined` for an id that is not a node, and the host falls back to `startInside`.
3. A node that is not connected throws "node <name> is not connected", which the proxy reports as the session's failure.

## Validation

- `nodes.test.ts`: a fake node over an in-memory socket serves a scripted inner host; a nested session through `connect` answers a turn.
- A join with a node token and no deployment token is admitted at the join path; the deployment token alone is refused there.

## Resume

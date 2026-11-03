---
title: The host owns the queue and the steering hand-off
status: todo
depends: [task-04-the-session-contract-follows-iagent.md]
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1449-L1545](../../../../packages/sdk/src/host/chatactions.ts#L1449-L1545) - a pending message today, handed to the backend's queue"
  - "[code://packages/sdk/src/host.ts#L1126-L1140](../../../../packages/sdk/src/host.ts#L1126-L1140) - the cancelled-end hook"
---

## Objective

The chat's pending messages are the host's.
It drains them after a successful turn or a local command, steering first, with a start of its own.
It hands every pending steering message to the backend while a turn is active, and takes them all out at a cancelled end.

## Files

- `CREATE: packages/sdk/src/host/queuedrain.ts` - the queue drain: the pending messages, the steering hand-off, the hand-back and the cancelled end (row 33).
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a pending message, its removal and a reorder are said and then drained or handed.
- `UPDATE: packages/sdk/src/host.ts` - the cancelled-end hook becomes the drain's.

## Steps

1. Drain after a success or a local command, never after a cancel (row 15).
2. Skip the drain while the latest turn is a resumable failure (row 15).
3. Admit the head with a server start and `queuedMessageId`, then send it (row 16).
4. Hand pending steering at a turn's start and on each later action of it (row 17).
5. Steer the active turn with steering handed back, or run it next (row 18).
6. Take every pending steering message out at a cancelled end (row 19).
7. Call `withdrawSteeringMessage` for a client's removal of submitted steering (row 20).
8. Apply a removal of a message the chat no longer holds as the client sent it (rows 4, 14, H1-0044).

## Validation

- Add to `packages/sdk/test/host-steering.test.ts`: steering sent while a turn prepares reaches that turn.
- Add to it: idle steering reaches the next turn that starts.
- Add to it: handed-back steering steers the active turn.
- Add a case for a stop: the host removes every steering message and starts nothing.
- Add a case for a queued message after a resumable failure: the host leaves it waiting.

## Resume


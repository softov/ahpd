---
title: The nested proxy is a relay
status: todo
depends: [task-01-the-host-says-the-clients-action.md, task-02-the-queue-waits-for-prerequisites.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/sessions/nested.ts#L540-L570](../../../../packages/sdk/src/sessions/nested.ts#L540-L570) - `carry`, which holds the connection for the inner answer"
  - "[code://packages/sdk/src/sessions/nested.ts#L1550-L1645](../../../../packages/sdk/src/sessions/nested.ts#L1550-L1645) - the actions rebuilt from a Session's arguments"
---

## Objective

A client's action on a session in a machine is carried whole to the host inside, whose echo answers the client under the client's origin.
The connection's later actions go on without waiting for that answer.

## Files

- `UPDATE: packages/sdk/src/sessions/nested.ts` - each client action carried as sent, with its message whole; the hold goes.
- `UPDATE: packages/sdk/src/host.ts` - the one road where a client's echo comes from the host inside.

## Steps

1. Carry each client action to the host inside as the client sent it (row 27, D-0065 to D-0086).
2. Answer the client with the inner host's echo, under the client's origin (row 27).
3. Sequence the carried actions per client id, as a relay does (row 7).
4. Remove the hold on the connection's later actions (H1-0014, H2-0011).

## Validation

- Add to `packages/sdk/test/nested-proxy.test.ts`: the proxy carries a message's attachments and agent inside.
- Add to it: the host applies a stop sent right after a start at once.
- Run `packages/sdk/test/nested-process.test.ts`: a turn in a real nested host runs to its end.

## Resume


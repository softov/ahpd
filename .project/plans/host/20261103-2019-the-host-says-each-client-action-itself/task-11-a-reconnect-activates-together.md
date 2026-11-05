---
title: A reconnect activates its channels together
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/handshake.ts#L597-L670](../../../../packages/sdk/src/host/handshake.ts#L597-L670) - each resumed channel joins `watching` as its snapshot resolves"
---

## Objective

A reconnecting client's channels are held until every one of them is read, then join in one step with their replay or their snapshots.
An action reaches the client live or in the replay, never both.

## Files

- `UPDATE: packages/sdk/src/host/handshake.ts` - the resumed channels join `watching` together, after every read.

## Steps

1. Read every resumed channel before any joins `watching` (row 31, H2-0006).
2. Join them in one synchronous step with the replay or the snapshots (row 31).

## Validation

- Add to `packages/sdk/test/host-handshake.test.ts`: the client gets an action once when the host says it during a later read.

## Resume

- **Done:** steps 1 and 2, at the commit that closes this task, with the case above.
- **The snapshot answer:** taken after the channels join, as VS Code refreshes each one once the batch is active.
- **Found on the way:** every backend said a client's draft again after the host had; fixups of 07 and 08 hold it silently.


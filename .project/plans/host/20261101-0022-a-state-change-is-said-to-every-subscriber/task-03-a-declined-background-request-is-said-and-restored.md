---
title: A declined background request is said and restored
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `session/mcpServerBackgroundRequested`"
  - "[code://packages/sdk/test/host-harness.test.ts](../../../../packages/sdk/test/host-harness.test.ts) - the background request's cases"
---

## Objective

A `session/mcpServerBackgroundRequested` no backend takes, naming a server that is starting with `blocking: true`, is said to every subscriber of the session with its sender's origin, then `session/mcpServerStateChanged` restores the server's state with `blocking: true` for every subscriber. On any other server the request reduces to nothing and is answered to its sender alone.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - the background request's branch, where no backend takes it.
- `UPDATE: packages/sdk/test/host-harness.test.ts` - a session listing a blocking starting server, a backend without the call and one that declines it: both clients hear the request and the restored state, and both hold `blocking: true`.
- `UPDATE: docs/sdk/AHP.md` - the `session/mcpServerBackgroundRequested` row.

## Steps

1. Write the cases and see them fail on `5da31824`: the second client hears nothing, and the sender's state holds `blocking` false.
2. Say the request and restore the state.

## Validation

- The cases fail on `5da31824` and pass after.
- The case on a server that is not blocking still answers its sender alone.

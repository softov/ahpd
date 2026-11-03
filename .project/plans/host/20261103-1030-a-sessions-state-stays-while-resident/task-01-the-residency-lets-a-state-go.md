---
title: The residency lets a session's state go
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/sleep.ts](../../../../packages/sdk/src/host/sleep.ts) - the recency, `touch`, `reconcile` and `release`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `letStateGo`, and the reconcile at an unsubscribe and a closed connection"
---

## Objective

The host keeps one recency of resident sessions, touched as VS Code's residency touches it.
A reconcile lets each archived resident go, then the oldest residents while the count is over the limit.
A release sleeps a running session and lets its state go with it.
A release never takes a session a client watches, one with a turn running, or one a waker holds.

## Files

- `UPDATE: packages/sdk/src/host/sleep.ts` - the recency, `residents`, `touch`, `release` and `reconcile`; the sweep's timeout only; a sleep keeps the state.
- `UPDATE: packages/sdk/src/host.ts` - `letStateGo`, and a reconcile at an unsubscribe and a closed connection.
- `UPDATE: packages/sdk/src/host/context.ts`, `packages/sdk/src/host/state.ts` - `letStateGo`; `turnedAt` goes.
- `UPDATE: packages/sdk/src/host/spawn.ts`, `sessionmethods.ts`, `handshake.ts`, `chatactions.ts` - a touch at a start and a subscribe, a reconcile at an archive.
- `UPDATE: packages/sdk/src/host/common.ts` - `ENDINGS`, read by the spawn and the sleep areas.
- `UPDATE:` the `sessionResidencyLimit` docs in the sdk, the server and `docs`.
- `UPDATE: packages/sdk/test/session-sleep.test.ts` - the cases below.

## Steps

1. Keep the recency of resident sessions, a draft left out.
2. Touch it at a start, a subscribe and a turn's start.
3. Reconcile at a subscribe, an unsubscribe, a closed connection, an archive, a start and a turn's start or end.
4. Let each archived resident go, then the oldest while the count is over the limit.
5. Sleep a running session to let it go, and let its state go with it.
6. Keep the state at a sleep for quiet.
7. Add a case for each.

## Validation

- The new cases fail on `feb72387`'s sources and pass after.
- The touched files' test files pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.

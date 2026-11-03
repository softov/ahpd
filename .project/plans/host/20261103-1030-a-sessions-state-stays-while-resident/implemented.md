---
title: A session's state stays while it is resident - implemented
date: 2026-11-03
refs:
  - git://f68c7851 - the change
  - "[code://packages/sdk/src/host/sleep.ts](../../../../packages/sdk/src/host/sleep.ts)"
---

The host keeps one recency of resident sessions: those it runs, and those whose state it holds.
A session is touched at a start or a wake, at a subscribe, and at a turn's start; a draft is neither counted nor touched.
A reconcile lets each archived resident go, then the oldest while more are resident than `sessionResidencyLimit`.
It runs at each touch, at an unsubscribe, at a closed connection, at an archive, at a turn's end and each minute.
A release sleeps a running session and lets its state go with it.
It never takes a session a client watches, one with a turn running, or one a waker holds.
A sleep for quiet keeps the state, so a client that comes back is replayed what it missed.

## What was built

- [`code://packages/sdk/src/host/sleep.ts`](../../../../packages/sdk/src/host/sleep.ts) - the recency, `residents`, `touch`, `release` and `reconcile`; the sweep sleeps for quiet and then reconciles.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `letStateGo`, and a reconcile at an unsubscribe and a closed connection.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts), [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts), [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - a touch at a start and at each subscribe.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a reconcile at an archive.
- The `sessionResidencyLimit` docs in the sdk, the server, [`code://docs/sdk/SESSIONS.md`](../../../../docs/sdk/SESSIONS.md), [`code://docs/sdk/HOST.md`](../../../../docs/sdk/HOST.md) and [`code://docs/server/CONFIGURE.md`](../../../../docs/server/CONFIGURE.md).

## Verified

- On `feb72387`'s sources the four new cases in the sleep test file fail, and they pass with the change.
- Seventy-two test files that drive a sleep, a wake, a reconnect, an archive, an unsubscribe or a held state pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

- A handshake touches each channel it subscribes, and reconciles once all of them are watched.
  So none of them is let go between two of its subscribes.

---
title: The host's state is the reducers' output - implemented
date: 2026-11-01
refs:
  - git://79b276a8
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/host/snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts)"
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
---

The root, each session and each chat now hold the state the protocol's reducers make of every action the host sends.
Each channel's state opens once from a seed, and only actions move it after.
A client that subscribes is served that state, so it holds what a client that watched every action holds.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the held states, `reduced` in `emit`, `openState`, and `statesUnwatched` for a session not running.
- [`code://packages/sdk/src/host/state.ts`](../../../../packages/sdk/src/host/state.ts) - `HeldState`; a worker chat's own reduction left for the held one.
- [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts) - the seeds of a running session and chat, the record seed, and the subscribe served from the held state.
- The same file - a held chat that opened empty takes its record's turns by `chat/turnsLoaded`, and a held session takes workers read late by `session/chatAdded`.
- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - rows and summaries read off the held state, partial changes, `chatMoved`, `answerMirrored`, `factsMoved`, `activeCount`.
- The same file - `sessionComing`, so a session's row moves on the wire only once `root/sessionAdded` has said it.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - a chat opens at its backend's start, a worker at its spawn, and a backend's `session/activityChanged` gives way to the host's.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `daemonValues`, `rootSeed`, `rootFor` and `keptOnReplace`.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) and [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the restart mark on the handshake and on a root subscribe.
- [`code://packages/sdk/src/host/canvases.ts`](../../../../packages/sdk/src/host/canvases.ts) and [`code://packages/sdk/src/host/changesets.ts`](../../../../packages/sdk/src/host/changesets.ts) - a cleared canvas `url`, and `error` for a failed changeset read.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) and [`code://packages/sdk/src/host/sleep.ts`](../../../../packages/sdk/src/host/sleep.ts) - what a chat starts with is kept before it opens; a sleeping session lets its state go.
- [`code://docs/sdk/HOST.md`](../../../../docs/sdk/HOST.md), [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) and [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the held state, the restart mark, the active count and a chat's row.

## Verified

- Before the change, the oracle's 22 R1 cases failed on the later subscriber's state, on the keys their entries named.
- After it, `ahp-test-cases.test.ts` passes 647 of 647 with no R1 entry.
- A case that holds a session's first root notice to be `root/sessionAdded` fails without `sessionComing` and passes with it.
- `changes-refresh.test.ts` holds a failed read to `error` with its cause, and a read that answers nothing to the status put back.
- The full unit run at two workers passes 7351 of 7352 with the backends' plan in; the one failure is described in *Left for later*.
- The process run passes 695 of 695; `pnpm run typecheck` and `pnpm run boundary` exit 0.

## Departures from the plan

- A session's activity bits move by its reducer alone, so a drained question leaves `InProgress` on the session channel until its state opens again.
- The reference host writes its aggregate into the session's state outside its reducer; the plan's *Risks and tradeoffs* name it.
- The root's `_meta` and the per-connection config keys stay a per-connection reading until correction 8.
- Nothing writes the held state down; a restart reads each backend's record, as the reference does with its own database.
- `sessionComing` was not in the plan: the end of a session's start said its row before `root/sessionAdded`.

## Left for later

- The backend sites the audit names are the backends' plan's, in its [deferred.md](../20261101-1357-backends-say-their-state-by-actions/deferred.md).
- The usage pools case fails on this branch alone: it reads the current month over October records, and `usage/20261101-0158-the-usage-pools-case-holds-its-clock` fixes it.

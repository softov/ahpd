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

## After Softov's review of 2026-11-01

This answers the review's blockers 1 and 2. The restart mark had left the root's state for the handshake's `_meta`, and the root read the daemon's values once.

- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `ahpd.restartNeeded` is a `readOnly` property of the host's own schema. The root's values carry it once the host sets it with its own `root/configChanged`.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a client's push that names the mark moves nothing. Its echo carries the host's value, as a daemon key's echo carries the port's answer.
- VS Code's settings editor writes every root property back on a save, the mark among them. A save with the mark unchanged and one with it changed both leave the host's value.
- `workspaceTrust`, the read-only property the review names, is taken from a client and kept on the connection that pushed it. `PER_CONNECTION` in `gate.ts` and the `mine` filter in `actions.ts` decide that, and the write path never reads `readOnly`. The mark is one fact for every connection, so it takes the daemon keys' handling.
- The handshake's `_meta` and the notification on subscribe and on resume are gone. `x-ahpd/restartNeeded` still goes to every connection watching the root as the mark is set.
- `daemonValuesMoved` says each daemon value a write moved, and `null` for a key the file no longer holds, as the host's own `root/configChanged`.
- The daemon calls it after a plugin command applies, over the plugins channel or at the terminal, and after a served `paths` write. A client's own push is said by its echo.
- `daemonHeld` keeps a daemon key from a connection without `config:read`. A daemon key is one the port declares now, or one it declared or answered since the root opened. So a plugin removed while the daemon runs is still the daemon's.
- `packages/server/test/plugins-channel.test.ts`: a plugin switched through the channel moves its value in the root, and a switch that needs a restart moves the mark with it.
- A plugin removed is said as `null` to a reader of the daemon's settings and to nobody else. With the read filters on the port's live schema, the case fails on the key shown to a reader without `config:read`.
- `packages/sdk/test/root-config.test.ts`: every reader of the root reads the mark in its config, and a replace that carries it, unchanged or changed, leaves the host's value.
- `packages/server/test/server-paths.test.ts`: the root is told after each served add and remove, with the file already written, and not for an add that wrote nothing.
- The root's schema is the one the root opened with, since `root/configChanged` carries values only. A plugin installed while the daemon runs has its value in the root at once and its property in the schema from the next start.
- The review's note on a failed `createSession`: [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) lets go of the origin, the read marks and the title it wrote before the backend started.
- `packages/sdk/test/catalogue-restarting.test.ts` holds the store empty after a backend refuses the session. Without the change the store keeps the session's read marks.
- The review's note on `rootFor`'s order: a connection's own values hold `PER_CONNECTION` keys alone. The held values it is laid over hold none of them, so no key is in both and the order decides nothing.

## Left for later

- The review's note on the cost per action waits on a measurement. `chatMoved`, `summaryMoved` and `factsMoved` run after every chat action that is not a delta, and which action moves which projection is a choice.
- The review's note that a held state seeded from the record may survive a wake waits on the test it names. No change here makes that test.

- The backend sites the audit names are the backends' plan's, in its [deferred.md](../20261101-1357-backends-say-their-state-by-actions/deferred.md).
- The usage pools case fails on this branch alone: it reads the current month over October records, and `usage/20261101-0158-the-usage-pools-case-holds-its-clock` fixes it.

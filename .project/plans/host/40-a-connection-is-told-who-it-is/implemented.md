---
title: A connection is told who it is - implemented
---

## What exists

- `packages/sdk/src/host.ts`: `initialize` answers `_meta['ahpd.principal']` beside `ahpd.resourceProviders`, and `rootState` puts the same key in the `_meta` of that connection's root snapshot, built fresh per connection, never in shared state. `user:<id>` for a person, `root:<host>` for the deployment token; absent with no users directory and for a connection that has not signed in.
- `authenticate` still answers `{}`; a client takes the root snapshot again after it signs in, out, or expires - decision [a-connection-is-told-who-it-is-on-initialize-and-in-root-state](../../../decisions/a-connection-is-told-who-it-is-on-initialize-and-in-root-state.md), superseding the authenticate-result one.
- `docs/USERS.md` says how a client learns it.

## Verified

- Probes (by a reviewer, deleted after): two people on one host never see each other's principal across initialize, snapshots, `root/*` actions, sign-in, sign-out, a `reconnect` replay from seq 0, and expiry; an anonymous connection and a host with no users directory get no key.
- The wire fixture carries `ahpd.principal` on the initialize and subscribe snapshots and passes the schema check.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (171 files, 2576 tests).

## Departures

- Built by another session, carried onto this worktree after host/42; the fixture regeneration also carries host/42's `ahpd.owner`.
- `tools/wire.mjs` checks snapshots and actions, not the `InitializeResult` object itself; harmless, since it declares `_meta` (host/43 p1 makes the checker cover results).

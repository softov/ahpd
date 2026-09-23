---
title: A person signs in to the host, and a role decides what they may do - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/users.ts
  - code://packages/sdk/src/users.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/host.ts
  - code://packages/sdk/src/listen.ts
  - code://packages/server/src/config.ts
  - code://packages/server/src/main.ts
  - code://test/users.test.ts
  - code://test/users-host.test.ts
  - code://test/users-gate.test.ts
  - code://docs/USERS.md
---

A person signs in to a running `ahpd` through the protocol's own `authenticate`, against a resource the host advertises for itself, and the roles on their record decide what they may do.
A daemon with no `users` configured advertises nothing new, refuses nothing, and is exactly the daemon that existed before this.

## What was built

- `code://packages/sdk/src/types/users.ts` - `Capability`, `Grant`, `Principal`, `UserRecord`, `UserFile` and `Users`, with the login record on the port.
- `code://packages/sdk/src/users.ts` - `fileUsers`: one JSON file, SHA-256 hashes compared with the socket's own constant-time `same`, secrets minted once, and a malformed file that fails closed and refuses to be overwritten.
- `code://packages/sdk/src/types/host.ts` - `HostOptions.users`, and `Connection.principal`/`principalUntil` beside `tokens`.
- `code://packages/sdk/src/host.ts` - `resourcesOf` appends the login record, `lent` skips it, `authenticate` verifies it, `expire` detaches it, and the one gate at the dispatch boundary with `NEEDS`, `UNGATED` and `capabilityFor`.
- `code://packages/server/src/config.ts`, `code://packages/server/src/main.ts` - the `users` config key, the `--users` flag, the `user` verb with `add`, `rm`, `list` and `token`, and the port wired into the host literal.
- `code://docs/USERS.md` - the two secrets, the three shapes, the roles and what a client is told; `docs/AHP.md`, `docs/LIBRARY.md` and `README.md` moved with it.

## Verified

- `test/users.test.ts` - 7 cases: verification, the built-in roles, a file role overriding one, minting twice, removal, listing without hashes, and a file that is absent, empty or malformed.
- `test/users-host.test.ts` - 6 cases: the advertised resource with and without a directory, a good token, a bad one, a sign-out, a backend's token passing through unverified, and an expiry.
- `test/users-gate.test.ts` - 7 cases: the handler classification (read out of the source), an unconfigured host refusing nothing, `-32007` before signing in, `-32009` with no `request` after, a read-only role, the scheme-scoped `computer:` case, and a credential given back taking the capability with it.
- `pnpm test` green: 70 files, 892 tests, with `test/host.test.ts`, `test/writes.test.ts` and `test/operations.test.ts` unmodified.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- By hand: `user add`, `user token`, `user list`, `user rm` and a bogus sub-verb against a real file, with the hash and only the hash on disk.

## Departures from the plan

- `Capability` gained a scoped sibling, `Grant`, because task 03 asks the gate for `write:computer`; a plain capability never confers a scheme.
- **`dispatchAction` is not gated, and this is a hole.** It is a notification, and the notification path in `handle` returns before the gate is reached, so a connection that never signed in can still start a turn. Refusing an action needs the check inside `applyDispatch`, which is a change this plan did not make. It is classified in `UNGATED` for the staleness test with the reason written beside it.
- `expire` gained a branch for the login resource, which keeps no token in `connection.tokens`: `principalUntil` is what its clock reads.
- The by-hand daemon-with-a-directory case and the no-dist rehearsal were not run here; CI runs the latter.

## Left for later

- The notification half: `dispatchAction` and any future action that arrives as a notification.
- `HANDOFF.md`'s pending step 9 tool half, unchanged.
- `ahpc` and `ahpapp` sign-in, which is cross-repo and the reason a directory is usable only from a client that learned the flow.
- An identity provider behind the same `Users` port, which is what an `ahp-server` master wants.

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
- `code://packages/sdk/src/host.ts` - `resourcesOf` appends the login record, `lent` skips it, `authenticate` verifies it, `expire` detaches it, the gate at the dispatch boundary with `NEEDS`, `UNGATED` and `capabilityFor`, and the second gate at the top of `applyDispatch` with `dispatchNeeds` for the half that arrives as a notification.
- `code://packages/server/src/config.ts`, `code://packages/server/src/main.ts` - the `users` config key, the `--users` flag, the `user` verb with `add`, `rm`, `list` and `token`, and the port wired into the host literal.
- `code://docs/USERS.md` - the two secrets, the three shapes, the roles and what a client is told; `docs/AHP.md`, `docs/LIBRARY.md` and `README.md` moved with it.

## Verified

- `test/users.test.ts` - 7 cases: verification, the built-in roles, a file role overriding one, minting twice, removal, listing without hashes, and a file that is absent, empty or malformed.
- `test/users-host.test.ts` - 6 cases: the advertised resource with and without a directory, a good token, a bad one, a sign-out, a backend's token passing through unverified, and an expiry. The advertised record declares `required: true`, the format's own default: with a directory configured the host does refuse every command until somebody signs in, and `false` would tell a client it may defer the prompt.
- `test/users-gate.test.ts` - 11 cases: the handler classification (read out of the source), an unconfigured host refusing nothing, `-32007` before signing in, `-32009` with no `request` after, a read-only role, the scheme-scoped `computer:` case, and a credential given back taking the capability with it; plus four for the notification half: a stranger refused the terminal they were handed the URI for (asserted against the owner's own command as the clock, so the negative is not a sleep), a signed-in role refused a channel it does not cover, `dispatchNeeds` over every channel kind, and an unconfigured host dispatching freely.
- `pnpm test` green: 70 files, 896 tests, with `test/host.test.ts`, `test/writes.test.ts` and `test/operations.test.ts` unmodified.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- By hand: `user add`, `user token`, `user list`, `user rm` and a bogus sub-verb against a real file, with the hash and only the hash on disk.

## Departures from the plan

- `Capability` gained a scoped sibling, `Grant`, because task 03 asks the gate for `write:computer`; a plain capability never confers a scheme.
- **`dispatchAction` is gated inside `applyDispatch`, not at the boundary.** A notification carries no id, so the notification path returns before the boundary and there is nowhere to put a `-32007`; the check sits at the top of `applyDispatch` instead, keyed by the channel (`dispatchNeeds`), and refuses with the `rejectionReason` every other refused action gets. It stays in `UNGATED` for the staleness test, which is about the boundary, with the reason beside it.
  This was shipped open and fixed on review the same day. Left open it was not the small gap first recorded: root state hands every open terminal's URI to any connection that completes a handshake, and `terminal/input` writes to a shell, so an unauthenticated connection had arbitrary command execution as the daemon's user. A terminal a session opened also carries that session's and chat's URIs in its claim, so the same path reached somebody else's session. `test/users-gate.test.ts` now proves it: with the gate reverted, the stranger's `echo` appears in the terminal's output.
- `expire` gained a branch for the login resource, which keeps no token in `connection.tokens`: `principalUntil` is what its clock reads.
- The by-hand daemon-with-a-directory case and the no-dist rehearsal were not run here; CI runs the latter.

## Left for later

- A capability for host configuration of its own. `root/configChanged` is the only root action a client may dispatch and it is gated as `write`, which is tighter than what it had and still not what it is.
- `HANDOFF.md`'s pending step 9 tool half, unchanged.
- `ahpc` and `ahpapp` sign-in, which is cross-repo and the reason a directory is usable only from a client that learned the flow.
- An identity provider behind the same `Users` port, which is what an `ahp-server` master wants.

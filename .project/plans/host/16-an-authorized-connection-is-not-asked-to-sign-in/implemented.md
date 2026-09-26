---
title: A connection that is already authorized is not asked to sign in - implemented
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `agentsFor`, `rootState`, `snapshotOf` and the `root/agentsChanged` branch of `seenBy`"
  - "[code://test/users-host.test.ts](../../../../test/users-host.test.ts) - the six cases"
---

A client on the deployment's token, or signed in, reads the host's sign-in resource as `required: false`, so VS Code creates a session without asking it to sign in.
A personal-token connection that has not signed in still reads `true`.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `agentsFor(connection, agents)`, applied in the root snapshot and in `seenBy` for `root/agentsChanged`, so the live broadcast and both replays carry it.
- [`code://docs/USERS.md`](../../../../docs/USERS.md) - the paragraph on what each connection is told.

## Verified

- `test/users-host.test.ts`: six cases, for the root snapshot, a personal connection before and after `authenticate`, a live dispatch to both, a reconnect replay, the backend and GitHub resources left alone, and a host with no directory.
- A wire probe against a daemon from the checkout with `users` and an issuer that was not running: the root connection read `["ahpd users", false]`, the personal one `true`.
- Softov in VS Code on 2026-09-26, with the deployment token: the session was created and answered a turn, with no sign-in prompt.
- `pnpm test` 85 files / 1125 tests, `pnpm typecheck`, `pnpm boundary` green on 2026-09-26; `test/conformance.test.ts` unchanged.

## Departures from the plan

- None.

## Left for later

- A principal removed from the directory while still signed in keeps reading `false` until its next command is refused. The plan's risk for a sign-out covers the same case.
- What the VS Code check found next, a computer picked in New that is not the one the session runs on, is `host/18`.

---
title: ahpd.grants lists every subject a role can name, the schemes included - implemented
date: 2026-10-04
refs:
  - git://3025b42
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts)"
---

A client reads one key, `_meta['ahpd.grants']`, for every subject a role can name: the host's own eight and every resource scheme this host serves, each with its title, description, operations and read and write groups.

## What was built

- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `schemeGrants`, one entry per registered scheme the table does not hold, and `schemeOperations`, the one lookup `ahpd.resourceProviders` and `ahpd.grants` both read; descriptions pass through as written.
- `docs/USERS.md`, `docs/PLUGINS.md` and `docs/COMPUTER.md` send a client to each scheme's own entry.

## Verified

- `users-host.test.ts` asserts `user`, `team`, `project`, `role` and `policy` beside the eight; `plugin-host.test.ts` asserts a plugin scheme, a provider with no `describe()`, and a provider registered as `file`, which the built-in wins.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (180 files, 2800 tests) pass on `main` at `3025b42`.

## Departures from the plan

- `docs/COMPUTER.md` carried the same sentence about the `file` entry's groups and was corrected too.
- `membership` is a field of a person's record, not a scheme, so it is not listed; `usage` is, because the daemon serves it.

## Left for later

- The tasks stay `implemented` until Softov reviews them.

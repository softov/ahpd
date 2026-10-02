---
title: A client reads what a pool spent, and the records behind it, through a usage scheme - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/server/src/commands/usage.ts](../../../../packages/server/src/commands/usage.ts)"
---

A client lists the usage pools it may see and reads each one's day, week and month totals and its newest records through `usage://`, and `ahpd usage` prints the same at the terminal.
A person reads their own pool and their teams' and projects' pools without `usage:read`; with it, they read every pool.

## What was built

- [`code://packages/sdk/src/usage.ts`](../../../../packages/sdk/src/usage.ts) - `pools` and `records` on the file store, and `usageProvider`, the `usage:` scheme with `authorize`, the reader-filtered root listing and the period totals in the configured zone.
- [`code://packages/sdk/src/types/resources.ts`](../../../../packages/sdk/src/types/resources.ts) - `ResourceProvider.authorize`, and the reader passed to `read` and `list`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the gate asks the scheme's `authorize` before requiring `<scheme>:read`, for reads and listings only.
- [`code://packages/sdk/src/scopes.ts`](../../../../packages/sdk/src/scopes.ts) - `poolsFor`, the pools one person may see.
- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - `usage` as a grant subject.
- [`code://packages/server/src/commands/usage.ts`](../../../../packages/server/src/commands/usage.ts) - `ahpd usage`, and `usage.timezone` in the daemon configuration.
- `docs/USERS.md`, `docs/DAEMON.md`, `docs/PLUGINS.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 150 files and 2186 tests after the rebase onto host/38, `pnpm boundary` clean.
- `packages/sdk/test/usage-scheme.test.ts` (10 cases) and `packages/server/test/usage-command.test.ts` (8 cases): own pools without the grant, another's refused, every pool with `usage:read`, totals equal to the sum of the records, the week in `Asia/Tokyo`.

## Departures from the plan

- The build agent was restarted part way, after its model settings were corrected; it resumed from its own diff.

## Left for later

- See [deferred.md](deferred.md).

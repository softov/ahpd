---
title: A tunnel port with another protocol is replaced - implemented
date: 2026-11-11
refs:
  - git://4a0eb9705 - the commit this work was built on
  - "[code://packages/tunnel-devtunnel/src/service.ts](../../../../packages/tunnel-devtunnel/src/service.ts) - the port write and its recovery"
  - "[code://packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts](../../../../packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts) - the cases and the stand-in Host"
---

A tunnel kept from a run that wrote its ports as `http` starts after an upgrade.
Its port is removed and written again when the service refuses the protocol change.

## What was built

- [`code://packages/tunnel-devtunnel/src/service.ts`](../../../../packages/tunnel-devtunnel/src/service.ts) - `refusesProtocol` matches the refusal by its text, `writePort` removes the port and writes it again, and `sdkService.add` and `sdkService.access` go through it.
- [`code://packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts`](../../../../packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts) - a `refuse` text on the fake `Host`, and three service cases for the add refusal, the access refusal and another error.

## Verified

- `pnpm exec tsc -p tsconfig.json --noEmit` passes at the repository root, and it covers the package's source and its tests.
- `pnpm exec tsc -p tsconfig.json --noEmit` passes in `packages/tunnel-devtunnel`, after `pnpm exec tsc -p packages/sdk` built the SDK's types. The package tsconfig has no `paths` for `@ahpd/sdk`, so a fresh worktree needs that build first. The build's `dist` is ignored.
- In review, `pnpm typecheck` passes, and `npx vitest run packages/tunnel-devtunnel` passes 61 tests in 5 files.

## Departures from the plan

- The recovery sits in `sdkService`, one layer above the task's `service.ts:409-418`. The tests stand in a `Host`, so a recovery inside `sdkCloud` would not be reached by them.
- The retry writes through `Host.add` on both paths. `updateTunnelPort` sends `If-Match: *`, so the port cannot be updated after a delete; `Host.add` is a create-or-update and makes the port again.
- `sdkService.access` refreshes the relay after a recovery, as an add does, so the host is told about the port again.
- `sdkService.replace` writes its new port through `writePort` too, added in review. A fourth case covers it.

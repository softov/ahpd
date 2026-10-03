---
title: An automation's owner rides in _meta - implemented
---

## What exists

- `AutomationEntry` and `AutomationRunState` (`packages/sdk/src/types/automations.ts`) are the shapes a client receives: the stored `Automation` and `AutomationRun` less `owner`, with `_meta`. The store's `list`, `get`, `create` and `update` answer `AutomationEntry`, so the compiler refuses `owner` on what is sent.
- `entry()` (`packages/sdk/src/automations.ts`) and `runState()` (`packages/sdk/src/host.ts`) put the owner in `_meta['ahpd.owner']`.
- The host's gates read the owner from `StartSession.owner`, off the stored record, unchanged.
- `scheduled.ts` persists the owner read back from the entry's `_meta`.
- `docs/AHP.md` says a client reads `_meta['ahpd.owner']`.

## Verified

- `wire.test.ts` records traffic from a host with a principal and an owned automation and its run; putting `owner` back on the entry fails it with `AutomationSetAction /automation undeclared key 'owner'` (checked by hand).
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (171 files, 2571 tests) pass.

## Departures

- The wire test's connection is a principal from `accept`, not an `authenticate` exchange; the stub directory answers no `verify`. host/40 brings its own sign-in traffic.

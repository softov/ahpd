---
title: A plugin that fails to start says so - implemented
date: 2026-11-11
refs:
  - git://9443da00a
  - "[code://packages/server/src/applyplugins.ts](../../../../packages/server/src/applyplugins.ts) - `eventFailed`"
---

A plugin whose `listening` handler throws gets the alert "This plugin failed to start, and the ahpd log has the details."
The words hold whether the plugin started with ahpd or was enabled later.

## What was built

- [`code://packages/server/src/applyplugins.ts`](../../../../packages/server/src/applyplugins.ts) - the `listening` text in `eventFailed`. The `stopping` text is unchanged.
- [`code://packages/server/test/plugin-live.test.ts`](../../../../packages/server/test/plugin-live.test.ts) - the expected text.

## Verified

- `pnpm typecheck` is clean.
- `npx vitest run packages/server` under the shared lock: 94 files, 1874 passed, 3 skipped.

## Departures from the plan

- None.

## Left for later

- Whether a `stopping` alert stays on a plugin that is then unloaded, as [deferred.md](deferred.md) says.

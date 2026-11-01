---
title: A plugin that fails says so - implemented
date: 2026-11-01
refs:
  - git://plugin/20261101-1803-a-plugin-that-fails-says-so
  - "[code://packages/server/src/applyplugins.ts](../../../../packages/server/src/applyplugins.ts)"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts](../../../../packages/tunnel-devtunnel/src/plugin.ts)"
---

A plugin that the daemon enables while it runs now hears `listening`, and one it disables hears `stopping` before its closers. A handler that throws at either event puts an `error` alert on its plugin's row. The Dev Tunnel plugin opens an anonymous tunnel with the flag the CLI knows. It says on its row when it cannot make, keep or read its tunnel.

## What was built

- [`code://packages/tunnel-devtunnel/src/devtunnel.ts`](../../../../packages/tunnel-devtunnel/src/devtunnel.ts) - `access create` gets `-p`, and `host` takes an `onExit` callback.
- [`code://packages/tunnel-devtunnel/src/plugin.ts`](../../../../packages/tunnel-devtunnel/src/plugin.ts) - the `tunnel` error alert and the `read` warning, each cleared when the tunnel works again.
- [`code://packages/server/src/applyplugins.ts`](../../../../packages/server/src/applyplugins.ts) - the `beforeUnload` and `afterLoad` hooks, and `eventFailed`, which logs a handler's throw and alerts its row.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - keeps the `listening` event and the live handlers, and raises both events through the hooks.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - the set's `alert`, for an alert that comes from outside the plugin.
- [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts) - `raise` passes the plugin's id to `onProblem`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - a late load hears `listening`, and an unload hears `stopping`.

## Verified

- `pnpm typecheck`, `pnpm boundary` and `pnpm i18n` pass.
- `tunnel-devtunnel`: 42 tests pass.
- `server`: 1729 tests pass, with `plugin-live.test.ts` at 18.
- `sdk`: 3900 tests pass. One fails, `users-gate-commands.test.ts` on usage pools, and it fails the same way on a tree without this change.
- The by-hand checks wait on Softov in [`plugin-fails-says-so-checks.md`](../../../pending/plugin-fails-says-so-checks.md).

## Departures from the plan

- `eventFailed` is in `applyplugins.ts`, not inline in `run.ts`, so the test uses the daemon's own function.
- The daemon's alert does not carry the error message. It says when the plugin failed and points to the ahpd log, as the *Answers* row says.
- The way down raises `stopping` to the live handlers, as the *Answers* row says.

## Left for later

- ahpw's plugin page badge and State fact still read only `state`, as *Risks and tradeoffs* says.

---
title: Plugin warnings go to the daemon's log - implemented
date: 2026-11-13
refs:
  - "[code://packages/server/test/no-console.test.ts](../../../../packages/server/test/no-console.test.ts) - the check"
  - "[code://packages/activepieces/src/wire.ts](../../../../packages/activepieces/src/wire.ts) - the engine's `log` message"
---

The fourteen `console` lines in package code now reach the daemon's log with a time and a level.
A test fails on a new one.

## What was built

- agent-claude passes `log` to each session. The six session lines write through it.
- agent-pi's `toPiTool` takes `log`, and its two session lines use the `log` the session already had.
- The sdk's `gitWorktrees` takes `log`, which the daemon gives, and the two retool lines use `ctx.log`.
- The activepieces engine sends a line as a `log` message, and the plugin writes it with `host.log`. A file the engine cannot read names the URL's origin alone.
- [`code://packages/server/test/no-console.test.ts`](../../../../packages/server/test/no-console.test.ts) - fails on a `console` call in any package's `src`.
- The problem file is deleted.

## Verified

- `pnpm typecheck` is clean.
- Suites: agent-claude 665, agent-pi 277, activepieces 176, sdk 4791 and server 1880, all passed.
- The new test failed on a `console.warn` planted in `packages/sdk/src/i18n.ts`, and passed once it was taken out.

## Departures from the plan

- The problem file said a piece got `null` with no reason for a file it could not fetch. The engine test shows the validator refuses it and names the host, so nothing changed there.

## Left for later

- No test drives a `log` message from a real engine through `host.log`. The engine test reads the message, and the plugin's handler is one branch.

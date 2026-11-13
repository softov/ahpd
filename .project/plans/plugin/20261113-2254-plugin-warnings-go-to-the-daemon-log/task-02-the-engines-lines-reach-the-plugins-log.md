---
title: The engine's lines reach the plugin's log
status: implemented
depends: []
layer: "activepieces"
refs:
  - "[code://packages/activepieces/src/wire.ts](../../../../packages/activepieces/src/wire.ts) - `LogMessage`, `isLog` and `engineLog`"
  - "[code://packages/activepieces/src/plugin.ts](../../../../packages/activepieces/src/plugin.ts) - the message handler"
---

## Objective

The engine sends its two lines to the plugin as `log` messages, and the plugin writes them with `host.log`.

## Files

- `UPDATE: packages/activepieces/src/wire.ts` - `LogMessage`, `isLog` and `engineLog`.
- `UPDATE: packages/activepieces/src/files.ts` - a file that cannot be read is an `error` line that names the URL's origin.
- `UPDATE: packages/activepieces/src/engine.ts` - a store that cannot be read is an `error` line.
- `UPDATE: packages/activepieces/src/plugin.ts` - a `log` message goes to `host.log`.
- `UPDATE: packages/activepieces/test/engine.test.ts` - `ask` keeps the log lines aside, and the FILE URL case reads its line.

## Steps

1. Add the `log` message to the wire, with its guard and a sender.
2. Send the two engine lines with it. A file URL's line names its origin, not its path or query.
3. In the plugin, write a `log` message with `host.log` at its level.
4. Make the test's `ask` skip a `log` message and keep it.
5. Assert the FILE URL case's line, and that it holds no part of the query.

## Validation

- The activepieces suite passes, and prints no `fetch failed` stack.

## Resume

Implemented 2026-11-13. The engine runs its source with the types stripped, so it imports `./wire.ts`. See [implemented.md](implemented.md).

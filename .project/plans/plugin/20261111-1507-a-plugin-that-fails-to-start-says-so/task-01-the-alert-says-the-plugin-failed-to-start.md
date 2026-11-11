---
title: The alert says the plugin failed to start
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/applyplugins.ts#L108-L112](../../../../packages/server/src/applyplugins.ts#L108-L112) - the text"
---

## Objective

The `listening` alert says the plugin failed to start, with no time.

## Files

- `UPDATE: packages/server/src/applyplugins.ts:108-112` - the text of a `listening` throw.
- `UPDATE: packages/server/test/plugin-live.test.ts:630-640` - the expected text.

## Steps

1. Change the `listening` text in `eventFailed` to "This plugin failed to start, and the ahpd log has the details."
2. Keep the `stopping` text.
3. Change the expected text in `plugin-live.test.ts`.

## Validation

- `plugin-live.test.ts`: the case reads the new text.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/server` passes.

## Resume


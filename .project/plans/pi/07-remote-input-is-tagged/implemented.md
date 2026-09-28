---
title: Input from a client is tagged as not the terminal's - implemented
date: 2026-09-28
refs:
  - git://e1c5e73
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - `INPUT_SOURCE` and the two calls that pass it"
---

Every message the pi backend hands pi from a client carries `source: 'rpc'`, so a pi extension can tell it from input typed at pi's own terminal.

## What was built

- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - one named constant, `INPUT_SOURCE = 'rpc'`, passed by `session.prompt(text, { source })` and `session.steer(text, undefined, { source })`.

## Verified

- `pnpm typecheck` green with no cast; the `PiBackend` seam carries no prompt options, so the fake cannot see the value and the checker covers the wrap.
- `pnpm test` 102 files, 1380 tests, and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- none.

## Left for later

- The by-hand check with a pi extension logging `event.source` on `input` was left to Softov.
- `ran` (the `!command`) does not go through pi and is not tagged.

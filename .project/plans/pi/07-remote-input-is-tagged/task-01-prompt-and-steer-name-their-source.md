---
title: prompt and steer name their source
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L120-L121](../../../../packages/agent-pi/src/backend.ts#L120-L121) - the two calls"
---

## Objective

Every message this backend hands pi carries `source: 'rpc'`.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:120-121` - `session.prompt(text, { source })` and `session.steer(text, undefined, { source })`.
- `UPDATE: test/agent-pi.test.ts` - only if the fake records options; the wrap itself is exercised by typecheck.

## Steps

1. Put the value in one named constant in `backend.ts`, commented with what pi does with it.
2. Pass it in both calls.

## Validation

- `pnpm typecheck` green, with no cast.
- By hand, once: a pi extension logging `event.source` on `input` sees the value for a message sent from a client.

## Resume

Built.
`backend.ts` has one named constant, `INPUT_SOURCE = 'rpc'`, commented with what pi does with it, and `session.prompt(text, { source })` and `session.steer(text, undefined, { source })` both pass it.
The `PiBackend` seam carries no prompt options, so the fake cannot see the value and the wrap is exercised by the checker.

- `pnpm typecheck` green with no cast; `pnpm boundary` and `pnpm test` green, 102 files, 1380 tests.
- By hand, for Softov: a pi extension logging `event.source` on `input` sees the value for a message sent from a client.

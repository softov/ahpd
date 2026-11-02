---
title: A command's turn is kept as its clients hold it
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - where a command's turn is kept once it has ended"
  - "[code://packages/sdk/src/host/localturns.ts](../../../../packages/sdk/src/host/localturns.ts) - `keepLocalTurn`"
---

## Objective

A `!` command's turn is kept for its chat as the chat's held state has it, which is the turn its clients reduced.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:1467-1473` - the turn kept comes from the chat's held state.
- `UPDATE: packages/sdk/test/host-local-turns.test.ts` - the test backend says its command's call by actions, and a case keeps a turn its record says otherwise.
- `UPDATE: docs/sdk/TERMINALS.md` - a command's turn is kept as the chat's state holds it.

## Steps

1. Hand `keepLocalTurn` the turns of the chat's held state.
2. Have the test backend say its command's call by actions, as a backend's `!` command does.
3. Keep a kept turn's terminal content, which this host rebuilds after a restart.

## Validation

- Before the change, the host keeps a command's turn as its backend recorded it, `error`.
- Its clients hold the same turn `complete`.
- After it, the kept turn equals the turn the chat's state holds.
- `host-local-turns.test.ts` passes.

## Resume

Done. Before the change the kept turn read `error`; after it, it equals the turn the chat holds.
`host-local-turns.test.ts` passes, its command's terminal opening after a restart.

---
title: A cut pi refuses is logged
status: todo
depends: []
layer: agent-pi
refs:
  - "[code://packages/agent-pi/src/session.ts#L956-L966](../../../../packages/agent-pi/src/session.ts#L956-L966) - a refused rewind throws from the open"
  - "[code://packages/agent-pi/test/agent-pi-truncate.test.ts#L130-L157](../../../../packages/agent-pi/test/agent-pi-truncate.test.ts#L130-L157) - the case that holds the failed turn"
---

## Objective

A cut pi refuses is written to the log, and the turn runs on pi's current leaf.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:956-966` - a refused rewind is logged.
- `UPDATE: packages/agent-pi/test/agent-pi-truncate.test.ts:130-157` - the turn after a refused cut runs.

## Steps

1. Log a rewind pi refuses, and go on with the open.
2. Change the refused cut's case to expect the turn to end without an error.

## Validation

- `packages/agent-pi/test/agent-pi-truncate.test.ts`: the changed case fails on `89ebe4d5` and passes after.
- The agent-pi test files pass.
- `pnpm run typecheck` is clean.

## Resume

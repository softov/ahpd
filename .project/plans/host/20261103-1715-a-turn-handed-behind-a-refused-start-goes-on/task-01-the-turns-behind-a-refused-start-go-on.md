---
title: The turns behind a refused start go on
status: done
depends: []
layer: host
refs:
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts) - `beginTurn`, `sayHanded`, `startNext` and `refuseTurn`"
---

## Objective

A refused start lets the turns handed behind it go on, and leaves the queue waiting.
A turn handed while the turn ahead began is said once that turn is over.
A replaced refused turn stays out of the history and off the chat's failure.

## Files

- `UPDATE: packages/agent-claude/src/session/turns.ts` - one refusal for the three, `sayHanded`'s hold, `startNext`, `refuseTurn`.
- `UPDATE: packages/agent-claude/test/agent-claude-failed-turn.test.ts` - a model the fake CLI refuses, and two cases.

## Steps

1. Fold the three refusals into one that starts the next handed turn when one waits.
2. Hold a handed turn in `sayHanded` only while the turn ahead still begins.
3. Say any handed turn not yet said at the top of `startNext`.
4. Keep a replaced refused turn out of the history and off the chat's failure.
5. Add a case for a refused handed turn.
6. Add a case for a refused turn with a turn handed during its switch.

## Validation

- The new cases fail on `3945964a`'s sources and pass after.
- `agent-claude-failed-turn.test.ts` passes.
- `pnpm run typecheck` and `pnpm run boundary` are clean.

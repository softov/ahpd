---
title: A refused rewind fails that turn and not the session
status: implemented
depends: [task-01-a-turn-names-where-it-ended.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L560-L590](../../../../packages/agent-pi/src/session.ts#L560-L590) - `build` and `opened`: the throw leaves `opening` rejected"
---

## Objective

When pi refuses the rewind, the first turn fails with the sentence, and the next turn opens pi again.

## Files

- `UPDATE: packages/agent-pi/src/session.ts`
- `UPDATE: packages/agent-pi/test/agent-pi-truncate.test.ts` - the case below.

## Steps

1. On a refused rewind, close the backend and clear `opening` and `live` before failing the turn.
2. The next turn opens pi again with `rewindAt` still set, so the truncation the client asked for is tried again rather than dropped.

## Validation

- A fake that refuses the rewind once: the first turn fails with the sentence and the second opens pi again; today the second fails with the same sentence.
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`session.ts`'s `opened` clears `opening` and `live` and closes the backend it built when that first open fails, so a refused rewind fails its turn instead of poisoning every turn after it.
The next turn opens pi again with `rewindAt` still set, so the truncation the client asked for is tried again rather than dropped.

- Failed first: the case found one open and one rewind where two of each were expected.
- `node_modules/.bin/vitest run packages/agent-pi` green, 87 tests; `pnpm typecheck` green.

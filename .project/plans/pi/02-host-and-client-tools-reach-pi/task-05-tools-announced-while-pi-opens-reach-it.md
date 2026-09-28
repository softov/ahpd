---
title: Tools announced while pi opens reach it, a running turn keeps the tools it started with, and a tool hears pi's abort
status: done
depends: [task-03-the-tools-change-with-the-clients.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L981-L990](../../../../packages/agent-pi/src/session.ts#L981-L990) - `setTools`, which marks the backend stale only once `live` is set"
  - "[code://packages/agent-pi/src/session.ts#L520-L541](../../../../packages/agent-pi/src/session.ts#L520-L541) - `build`, which copies `offering` before `open` resolves"
  - "[code://packages/agent-pi/src/session.ts#L200-L204](../../../../packages/agent-pi/src/session.ts#L200-L204) - `clientOf`, which reads the current list"
  - "[code://packages/agent-pi/src/tools.ts#L56-L71](../../../../packages/agent-pi/src/tools.ts#L56-L71) - `execute`, which ignores `signal`"
---

## Objective

A `setTools` at any moment reaches pi before the next turn; a running turn judges its calls against the tools it was built with; a tool's `execute` ends when pi aborts it.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - the stale rule, and the list a turn judges with.
- `UPDATE: packages/agent-pi/src/tools.ts:56-71` - the signal.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. Keep a count of changes or the list `build` used, and mark stale whenever the list differs from what the live or opening backend was built with.
2. The owner and effects lookups for a running turn read the list that backend was built with.
3. A host tool's `execute` rejects when `signal` aborts; a client call is released as it is on cancel.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts`: `setTools` while the first open is pending reaches pi on the next turn; today it never does.
- A `setTools` mid-turn does not change the contributor of a call in that turn.
- A host tool whose `run` never resolves ends when the turn is cancelled.
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`session.ts` keeps `built`, the tool list the live or opening backend was handed, set in `build` before `open` resolves.
`clientOf` and `effectsOf` read `built`, so a `setTools` made while a turn runs does not change that turn's owner or effects.
`setTools` marks the backend stale whenever one is open or opening, so a change made while the first open is still pending is rebuilt before the next turn instead of being lost.
`tools.ts`'s `execute` races a host tool's `run` against pi's abort signal and rejects with `The turn was stopped`, and a client call is still released by `cancel` as task 06 does.

- Failed first: the pending-open case found no `late` tool in any open, the running-turn cases lost the client contributor and asked to run instead of asking, and the abort case stayed running.
- `node_modules/.bin/vitest run packages/agent-pi` green, 84 tests; `pnpm typecheck` green.

---
title: Reading and reopening a run is one file
status: implemented
depends: [task-02-the-turn-agent-is-one-file.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L206-L231](../../../../packages/agent-cofold/src/session.ts#L206-L231) - `cut`, a fork or a rewind made before the first turn"
  - "[code://packages/agent-cofold/src/session.ts#L478-L653](../../../../packages/agent-cofold/src/session.ts#L478-L653) - `doing`, `status`, `settleTurn`, `rememberPoints`, `apply`, `read`"
  - "[code://packages/agent-cofold/src/session.ts#L990-L1076](../../../../packages/agent-cofold/src/session.ts#L990-L1076) - `reopen`, the run a restart left paused"
  - "[code://packages/agent-cofold/src/session.ts#L1078-L1097](../../../../packages/agent-cofold/src/session.ts#L1078-L1097) - the opening block that calls `cut` and `reopen` and stays"
---

## Objective

`packages/agent-cofold/src/runs.ts` reads a run to its end through the mapping, settles the turn it ends, and cuts and reopens a resumed, forked or rewound conversation, unchanged.

## Files

- `CREATE: packages/agent-cofold/src/runs.ts` - `bag`, `str`, and `createRuns(ctx)` holding `cut`, `doing`, `status`, `settleTurn`, `rememberPoints`, `apply`, `read`, `reopen`, returning `Runs` (`cut`, `doing`, `status`, `apply`, `read`, `reopen`). Estimated 320 lines.
- `UPDATE: packages/agent-cofold/src/context.ts` - `SessionContext` extends `Runs`.
- `UPDATE: packages/agent-cofold/src/session.ts` - those removed; `Object.assign(ctx, createRuns(ctx))`; the opening block calls `ctx.cut` and `ctx.reopen`, and the returned object's `status` and `sessionState`/`chatState` read `ctx.status`.

## Steps

1. Move each function with its comment, unchanged but for indentation and the `ctx.` prefix.
2. Calls into areas still in `session.ts` or another file (`settleEdit`, `owePause`, `payPause`, `startNext`, `agentOf`, `touch`) are `ctx.<name>`; `AGENT_ID` is imported from `turnagent.ts`, and nothing under `src/` other than `index.ts` and `agent.ts` imports `session.js`.
3. The opening block stays in `session.ts` after every `Object.assign`, in today's order.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-cofold` passes, all 13 files. `agent-cofold-fork.test.ts`, `agent-cofold-store.test.ts` and `agent-cofold-turn.test.ts` cover the cut, the reopen and the read.
- The pure-move check in [plan.md](plan.md#the-pure-move-check) shows nothing removed and not put back, and the `>` side holds only wiring.
- `wc -l` of `session.ts` and `runs.ts` recorded.

## Resume

Implemented, with one departure the plan's tables do not decide.

`runs.ts` holds `bag`, `str`, and `createRuns(ctx)` with `cut`, `doing`, `status`, `settleTurn`, `rememberPoints`, `apply`, `read` and `reopen`, returning `Runs` (`cut`, `doing`, `status`, `apply`, `read`, `reopen`). `settleTurn` and `rememberPoints` are locals of the factory. `AGENT_ID` is imported from `turnagent.ts`; `context.ts` has `SessionContext extends TurnAgent, Runs`; the opening block stays in `session.ts` after every `Object.assign` and calls `ctx.cut` and `ctx.reopen`.

**Departure.** `apply` calls `owePause`, `payPause` and `startNext`, which are `Pauses` offers in task 04 and a `Turns` offer in task 05, so at the end of this task they are not yet on `SessionContext` and `ctx.owePause()` does not compile - yet this task's own validation requires `pnpm exec tsc --noEmit` to pass. Three shapes were possible: put the three on the context early, pass them as a second factory argument, or leave the tree red until task 05. The first was taken: `SessionContext` gains `owePause`, `payPause` and `startNext` as plain function fields, `session.ts` puts them on with one `Object.assign(ctx, { owePause, payPause, startNext })` after `startNext` is declared, and tasks 04 and 05 lift them out of the closure exactly as this plan describes. It keeps every task green and every area reaching its neighbours as `ctx.<name>`, which is the architecture *Proposed architecture* locks in. **This was a fork the plan does not decide and it should be confirmed against the plan before the branch lands**; the ask could not be put to the reviewer from the build, so it is recorded here instead. To undo it, the alternative is `createRuns(ctx, { owePause, payPause, startNext })` and dropping the three fields in task 04 and 05.

Gates, all green: `pnpm exec tsc --noEmit`, `pnpm boundary` (5 declared, none undeclared), `pnpm exec vitest run packages/agent-cofold` - 14 files, 166 tests, including `agent-cofold-fork.test.ts`, `agent-cofold-store.test.ts` and `agent-cofold-turn.test.ts`.

Pure-move check (scratch script, see task 01): 684 removed, 845 added. The `<` side holds the fifteen `let`s and the five `ctx.`-forced spellings from task 01, the nine import lines that changed across tasks 01 to 03, `const AGENT_ID = 'cofold';` (now `export const`), and `status,` in the returned object (now `status: ctx.status,`). Nothing was dropped.

`wc -l`: `session.ts` 990, `context.ts` 101, `turnagent.ts` 284, `runs.ts` 318.

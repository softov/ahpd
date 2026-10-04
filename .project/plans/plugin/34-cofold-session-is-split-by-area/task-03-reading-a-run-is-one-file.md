---
title: Reading and reopening a run is one file
status: todo
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

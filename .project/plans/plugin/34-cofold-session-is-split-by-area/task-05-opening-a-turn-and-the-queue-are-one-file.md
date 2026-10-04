---
title: Opening a turn and the queue are one file
status: todo
depends: [task-04-a-paused-runs-answers-are-one-file.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L765-L988](../../../../packages/agent-cofold/src/session.ts#L765-L988) - `openTurn`, `startTurn`, `refusal`, `failTurn`, `beginTurn`, `startNext`"
  - "[code://packages/agent-cofold/src/session.ts#L1099-L1196](../../../../packages/agent-cofold/src/session.ts#L1099-L1196) - `runCommand`, a shell command as a turn"
  - "[code://packages/agent-cofold/src/session.ts#L1277-L1377](../../../../packages/agent-cofold/src/session.ts#L1277-L1377) - `ran`, then `cancel` and `steer`, which stay, then `queue`, `unqueue`, `reorder`"
---

## Objective

`packages/agent-cofold/src/turns.ts` opens, starts, fails and queues a turn and runs a typed shell command as one, and returns `ran`, `queue`, `unqueue` and `reorder`, unchanged; after it `session.ts` holds only what composes the areas.

## Files

- `CREATE: packages/agent-cofold/src/turns.ts` - `bag`, `str`; `createTurns(ctx)` holding `openTurn`, `startTurn`, `refusal`, `failTurn`, `beginTurn`, `startNext`, `runCommand`, returning `Turns` (`beginTurn`, `startNext`) with `methods`, `ran`, `queue`, `unqueue` and `reorder` as `Pick<Session, 'ran' | 'queue' | 'unqueue' | 'reorder'>`. Estimated 425 lines.
- `UPDATE: packages/agent-cofold/src/context.ts` - `SessionContext` extends `Turns`.
- `UPDATE: packages/agent-cofold/src/session.ts` - those removed; `const { methods: queueMethods, ...turnOffers } = createTurns(ctx)` and `Object.assign(ctx, turnOffers)`; `...queueMethods` spread where `ran` sits; `begin` calls `ctx.beginTurn`. About 345 lines remain.

## Steps

1. Move each function and method with its comment, unchanged but for indentation and the `ctx.` prefix; `cancel` and `steer`, which sit between `ran` and `queue`, stay in `session.ts`.
2. `startTurn` calls `agentOf`, `apply` and `read`, `startNext` and `runCommand` call `doing` and `touch`, each as `ctx.<name>`; the functions of this file call one another bare.
3. `AGENT_ID` (read by `refusal`) is imported from `turnagent.ts`; `toolCallPart`, `toolReadyAction`, `toolStartAction`, `mapTurn`, `modelReferenceOf` and cofold's `run` move their imports here.
4. The local `start` in `beginTurn` and the parameter `run` of `runCommand` keep their names.
5. Check that `session.ts` holds only the list in *Proposed architecture* of [plan.md](plan.md).

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-cofold` passes, all 13 files. `agent-cofold.test.ts`, `agent-cofold-turn.test.ts`, `agent-cofold-tools.test.ts` and `agent-cofold-models.test.ts` cover a turn, a queued turn, a failed start and a shell command.
- The pure-move check in [plan.md](plan.md#the-pure-move-check) shows nothing removed and not put back, and the `>` side holds only wiring.
- `wc -l packages/agent-cofold/src/*.ts` recorded: no file over 700 lines.

## Resume

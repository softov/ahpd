---
title: Opening a turn and the queue are one file
status: implemented
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

Implemented.

`turns.ts` holds `bag`, `str`, and `createTurns(ctx)` with `openTurn`, `startTurn`, `refusal`, `failTurn`, `beginTurn`, `startNext` and `runCommand`, returning `Turns` (`beginTurn`, `startNext`) with `methods`, `ran`, `queue`, `unqueue` and `reorder` as `Pick<Session, 'ran' | 'queue' | 'unqueue' | 'reorder'>`. `AGENT_ID` comes from `turnagent.ts`; `toolCallPart`, `toolReadyAction`, `toolStartAction`, `mapTurn`, `modelReferenceOf` and cofold's `run` moved their imports here. `SessionContext extends TurnAgent, Runs, Pauses, Turns`, and the interim `startNext` field task 03 needed is gone - task 05 supplies it from `Turns`. `session.ts` builds the area with `const { methods: queueMethods, ...turnOffers } = createTurns(ctx)` then `Object.assign(ctx, turnOffers)`, spreading `...queueMethods` where `ran` sat, and `begin` calls `ctx.beginTurn`. The functions of this file call one another bare; only the offers from another area - `agentOf`, `apply`, `read`, `doing` and `touch` - are read as `ctx.<name>`.

The four methods were object-literal arrows typed by the `Session` return type, so each kept its parameter types as `Session['ran']` and the rest rather than by spelling them out. `cancel` and `steer` stayed in `session.ts` where they sit today, between the spread and `setDraft`.

`session.ts` now holds only the list in *Proposed architecture*: the header comment, the imports, `sessionIdOf`, the four constants and the six shared maps and lists with their comments, `draft`, `touch`, the `ctx` literal and the four factory calls, the opening block, and the returned `Session` with `uri`, `chatUri` and the methods no area owns.

Gates, all green: `pnpm exec tsc --noEmit`, `pnpm boundary` (5 declared, none undeclared), `pnpm exec vitest run packages/agent-cofold` - 14 files, 166 tests - and the whole `pnpm test` at the end of the plan, 207 files and 2867 tests.

Pure-move check (scratch script, see task 01) over the whole plan's diff: 1224 removed, 1459 added. The 31 lines on the `<` side are the fifteen `let`s task 01 turned into fields; the four method signatures, now `Session['ran']` and the rest; `const AGENT_ID = 'cofold';`, now exported; the six original import lines that the split redrew; and the five lines the `ctx.` prefix forced into another spelling (`...(activity !== undefined ? { activity } : {}),`, `chats: [{ resource: start.chatUri, title }],`, `start.emit('session', { type: 'session/titleChanged', title });`, `status,` and `title,`). Nothing was dropped.

`wc -l packages/agent-cofold/src/*.ts`: `session.ts` 370, `turns.ts` 418, `agent.ts` 703, `mapping.ts` 652, `transcript.ts` 362, `tools.ts` 327, `runs.ts` 318, `turnagent.ts` 284, `pauses.ts` 259, `capabilities.ts` 172, `config.ts` 129, `plugin.ts` 103, `context.ts` 97, `index.ts` 37. `session.ts` is under 400 and every file this plan made is under 700; `agent.ts` at 703 is pre-existing, is not a file this plan names, and is left alone. `index.ts` is unchanged.

---
title: A paused run's answers and stops are one file
status: done
depends: [task-03-reading-a-run-is-one-file.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L96-L129](../../../../packages/agent-cofold/src/session.ts#L96-L129) - `DECLINED`, `answersOf`"
  - "[code://packages/agent-cofold/src/session.ts#L306-L318](../../../../packages/agent-cofold/src/session.ts#L306-L318) - `owePause`, `payPause`"
  - "[code://packages/agent-cofold/src/session.ts#L655-L763](../../../../packages/agent-cofold/src/session.ts#L655-L763) - `rejoin`, `route`, `stopNow`, `stop`"
  - "[code://packages/agent-cofold/src/session.ts#L1386-L1458](../../../../packages/agent-cofold/src/session.ts#L1386-L1458) - `confirm`, `answer`"
---

## Objective

`packages/agent-cofold/src/pauses.ts` holds the pause a run owes, the answer that rejoins a paused run and the stop that ends one, and returns `confirm` and `answer`, unchanged.

## Files

- `CREATE: packages/agent-cofold/src/pauses.ts` - `DECLINED`, `answersOf`, `bag`, `str`; `createPauses(ctx)` holding `owePause`, `payPause`, `rejoin`, `route`, `stopNow`, `stop`, returning `Pauses` (`owePause`, `payPause`, `stop`) with `methods`, `confirm` and `answer` as `Pick<Session, 'confirm' | 'answer'>`. Estimated 265 lines.
- `UPDATE: packages/agent-cofold/src/context.ts` - `SessionContext` extends `Pauses`.
- `UPDATE: packages/agent-cofold/src/session.ts` - those removed; `const { methods: answerMethods, ...pauses } = createPauses(ctx)` and `Object.assign(ctx, pauses)`; `...answerMethods` spread where `confirm` sits; `cancel` and `close` call `ctx.stop`.

## Steps

1. Move each declaration with its comment, unchanged but for indentation and the `ctx.` prefix; the doc comment at 712-720 that sits above `stopNow`'s own line moves with it in the same order.
2. `rejoin` calls `read` and `stop` calls `releaseCalls` and `confirm` calls `settleEdit`, each as `ctx.<name>`; `route` and `stopNow` call themselves bare.
3. The local `waiting` in `rejoin`, `route` and `stop` and the local `resolve` in `owePause` keep their names.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-cofold` passes, all 13 files. `agent-cofold-approval.test.ts`, `agent-cofold-tools.test.ts` and `agent-cofold-store.test.ts` cover approvals, questions, a stop while paused and an answer while a resume is opening.
- The pure-move check in [plan.md](plan.md#the-pure-move-check) shows nothing removed and not put back, and the `>` side holds only wiring.
- `wc -l` of `session.ts` and `pauses.ts` recorded.

## Resume

Implemented.

`pauses.ts` holds `bag`, `DECLINED`, `answersOf`, and `createPauses(ctx)` with `owePause`, `payPause`, `rejoin`, `route`, `stopNow` and `stop`, returning `Pauses` (`owePause`, `payPause`, `stop`) with `methods`, `confirm` and `answer` as `Pick<Session, 'confirm' | 'answer'>`. `SessionContext extends TurnAgent, Runs, Pauses`; `session.ts` builds the area with `const { methods: answerMethods, ...pauses } = createPauses(ctx)` then `Object.assign(ctx, pauses)`, spreading `...answerMethods` where `confirm` sat. `cancel` and `close` call `ctx.stop`. `owePause` and `payPause` are no longer locals of the closure - they come from the factory - so the `Object.assign(ctx, { startNext })` task 03 needed is down to `startNext` alone and disappears in task 05. The doc comment above `stopNow` and its own line moved together in the order they sit in today, and the locals `waiting` in `rejoin`, `route` and `stop` and `resolve` in `owePause` kept their names.

One thing the file list gets wrong: it names `str` among this file's copies, but nothing that moved here reads it - `confirm` and `answer` use `bag` and nothing else - so `pauses.ts` holds `bag` only. The decision table's rule is "a file that reads `bag` or `str` keeps its own copy", and this one reads no `str`. Adding a dead one-liner to a task that promises a pure move seemed the worse error; say the word and it goes in.

Gates, all green: `pnpm exec tsc --noEmit`, `pnpm boundary` (5 declared, none undeclared), `pnpm exec vitest run packages/agent-cofold` - 14 files, 166 tests, including `agent-cofold-approval.test.ts`, `agent-cofold-tools.test.ts` and `agent-cofold-store.test.ts`.

Pure-move check (scratch script, see task 01): 883 removed, 1082 added. The `<` side is unchanged from task 03 - the fifteen `let`s, the five `ctx.`-forced spellings, the nine import lines, `const AGENT_ID = 'cofold';` and `status,`. Nothing new was dropped.

`wc -l`: `session.ts` 763, `context.ts` 98, `turnagent.ts` 284, `runs.ts` 318, `pauses.ts` 259.

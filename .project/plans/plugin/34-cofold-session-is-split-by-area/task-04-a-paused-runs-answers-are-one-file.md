---
title: A paused run's answers and stops are one file
status: todo
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

---
title: A prompted turn is one file
status: todo
depends: [task-04-opening.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L71-L88](../../../../packages/agent-acp/src/session.ts#L71-L88) - `NOT_AN_ANSWER`, read only by `stopReasonFor`"
  - "[code://packages/agent-acp/src/session.ts#L101-L114](../../../../packages/agent-acp/src/session.ts#L101-L114) - `inline` and `referencing`, read only by `blocksFor`"
  - "[code://packages/agent-acp/src/session.ts#L1154-L1271](../../../../packages/agent-acp/src/session.ts#L1154-L1271) - `openTurn`, `finish`, `stopReasonFor`"
  - "[code://packages/agent-acp/src/session.ts#L1313-L1539](../../../../packages/agent-acp/src/session.ts#L1313-L1539) - `saidUsage`, `attachmentUri`, `named`, `contentOf`, `blocksFor`, `run`"
---

## Objective

`session/turn.ts` exports `Turn` and `createTurn(ctx)`, which hold one prompted turn from its opening to its ending, its prompt blocks and its usage, unchanged.

## Files

- `CREATE: packages/agent-acp/src/session/turn.ts` - `NOT_AN_ANSWER`, `inline`, `referencing`, `openTurn`, `finish`, `stopReasonFor`, `saidUsage`, `attachmentUri`, `named`, `contentOf`, `blocksFor`, `run` (about 405 lines).
- `UPDATE: packages/agent-acp/src/session.ts:71-88,101-114,1154-1271,1313-1539` - those removed; `Object.assign(ctx, createTurn(ctx))`; `begin` calls `ctx.openTurn` and `ctx.run`, and `close` calls `ctx.finish`.
- `UPDATE: packages/agent-acp/src/session/context.ts` - `SessionContext` extends `Turn`, and declares `startNext` until task 06 moves it.

## Steps

1. Move each declaration with its comment, unchanged but for indentation and the `ctx.` prefix; `NOT_AN_ANSWER`, `inline` and `referencing` stay module-level in the new file, and `closePlan` and the ACP content types go with their users.
2. `run` calls `ctx.open`, `ctx.chooseModel` and `ctx.signInFailure`; its local `signIn` keeps its name.
3. `finish` calls `ctx.startNext`, which is still in `session.ts`: assign it onto `ctx` there and declare it on `SessionContext`.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-acp` passes; `agent-acp-turn.test.ts`, `agent-acp-blocks.test.ts` and `agent-acp-usage.test.ts` cover turns, prompt blocks and usage.
- The pure-move check in [plan.md](plan.md) prints only imports, exports and wiring.
- `wc -l packages/agent-acp/src/session.ts` recorded.

## Resume


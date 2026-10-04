---
title: The agent a turn runs on is one file
status: implemented
depends: [task-01-the-session-state-is-one-context.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L37-L91](../../../../packages/agent-cofold/src/session.ts#L37-L91) - `insideDirectory`, `EDITS`, `editPathOf`, `modeOf`, `AGENT_ID`, `DEFAULT_INSTRUCTIONS`"
  - "[code://packages/agent-cofold/src/session.ts#L142-L157](../../../../packages/agent-cofold/src/session.ts#L142-L157) - `WaitingCall`"
  - "[code://packages/agent-cofold/src/session.ts#L261-L279](../../../../packages/agent-cofold/src/session.ts#L261-L279) - `announceEdit`, `settleEdit`"
  - "[code://packages/agent-cofold/src/session.ts#L371-L476](../../../../packages/agent-cofold/src/session.ts#L371-L476) - `waiting`, `releaseCalls`, `relay`, `instructionsOf`, `agentOf`; `touch` at 406 is not this file's"
  - "[code://packages/agent-cofold/src/session.ts#L1475-L1528](../../../../packages/agent-cofold/src/session.ts#L1475-L1528) - `toolCallOwner`, `completeToolCall`, `clientGone`"
  - "[code://packages/agent-cofold/src/transcript.ts#L43-L44](../../../../packages/agent-cofold/src/transcript.ts#L43-L44) - the `str` copy this file keeps"
---

## Objective

`packages/agent-cofold/src/turnagent.ts` builds the cofold agent a turn runs on, with its prompt, its policy, its edit hooks and the client-run tools it is handed, and returns the three client-tool methods, unchanged.

## Files

- `CREATE: packages/agent-cofold/src/turnagent.ts` - `insideDirectory`, `EDITS`, `editPathOf`, `modeOf`, `AGENT_ID` (exported, for `runs.ts` and `turns.ts`), `DEFAULT_INSTRUCTIONS`, `str`, `WaitingCall`; `createTurnAgent(ctx)` holding `waiting`, `releaseCalls`, `relay`, `announceEdit`, `settleEdit`, `instructionsOf`, `agentOf`, and returning `TurnAgent` (`agentOf`, `settleEdit`, `releaseCalls`) with `methods`, `toolCallOwner`, `completeToolCall` and `clientGone` as `Pick<Session, 'toolCallOwner' | 'completeToolCall' | 'clientGone'>`. Estimated 275 lines.
- `UPDATE: packages/agent-cofold/src/context.ts` - `SessionContext` extends `TurnAgent`.
- `UPDATE: packages/agent-cofold/src/session.ts` - those removed; `const { methods: toolMethods, ...turnAgent } = createTurnAgent(ctx)` and `Object.assign(ctx, turnAgent)` after the literal; `...toolMethods` spread where `toolCallOwner` sits; every call of `agentOf`, `settleEdit` and `releaseCalls` left in the file becomes `ctx.<name>`.

## Steps

1. Move each declaration with its comment, unchanged but for indentation and the `ctx.` prefix on a field.
2. `waiting` is read by nothing outside this file, so it moves into `createTurnAgent` as a local with its comment (371-380), and the three methods close over it there.
3. Drop the imports `session.ts` no longer uses (`resolve`, `createAgent`, `policyOf`, `resolveWithin`, `DEFAULT_TOOLS`, `capabilitiesOf`, `defaultStoreRoot`, `modelOf`, `cofoldTools`, `ClientToolRelay`, `Tool`, `PermissionMode`).

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/agent-cofold` passes, all 13 files.
- The pure-move check in [plan.md](plan.md#the-pure-move-check) shows nothing removed and not put back, and the `>` side holds only wiring.
- `wc -l` of `session.ts` and `turnagent.ts` recorded.

## Resume

Implemented.

`turnagent.ts` holds the six module-level helpers, its own `str`, `WaitingCall`, and `createTurnAgent(ctx)`, which returns `agentOf`, `settleEdit` and `releaseCalls` beside `methods` (the three client-tool methods typed `Pick<Session, 'toolCallOwner' | 'completeToolCall' | 'clientGone'>`). `waiting`, `relay`, `announceEdit` and `instructionsOf` are locals of the factory. `SessionContext extends TurnAgent`, and `session.ts` builds the area with `const { methods: toolMethods, ...turnAgent } = createTurnAgent(ctx)` then `Object.assign(ctx, turnAgent)`, spreading `...toolMethods` where `toolCallOwner` sat.

`AGENT_ID` is exported for tasks 03 and 05. `Bag` is not copied into `turnagent.ts` - nothing that moved here reads it - and `session.ts` keeps its own `bag` and `str`. The imports `resolve`, `createAgent`, `policyOf`, `resolveWithin`, `DEFAULT_TOOLS`, `capabilitiesOf`, `PERMISSION_MODES`, `defaultStoreRoot`, `modelOf`, `cofoldTools` and the types `CofoldAgent`, `PermissionMode`, `Tool`, `ClientToolRelay` moved; `RunHandle` and `Store` stayed.

The return type is spelled `TurnAgent & { methods: Pick<Session, ...> }` on the factory rather than a second exported interface, so `SessionContext extends TurnAgent` does not carry a `methods` field the context never has.

Gates, all green: `pnpm exec tsc --noEmit`, `pnpm boundary` (5 declared, none undeclared), `pnpm exec vitest run packages/agent-cofold` - 14 files, 166 tests.

Pure-move check (scratch script, see task 01): 418 removed, 531 added. The `<` side holds the fifteen `let`s and the five `ctx.`-forced spellings from task 01, plus the seven import lines that changed and `const AGENT_ID = 'cofold';`, which is now `export const AGENT_ID = 'cofold';` in `turnagent.ts`. Nothing was dropped.

`wc -l`: `session.ts` 1277, `context.ts` 94, `turnagent.ts` 284.

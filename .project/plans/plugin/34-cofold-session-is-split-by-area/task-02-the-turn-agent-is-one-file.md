---
title: The agent a turn runs on is one file
status: todo
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

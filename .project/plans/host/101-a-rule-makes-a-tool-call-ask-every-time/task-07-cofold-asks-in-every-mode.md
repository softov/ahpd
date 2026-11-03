---
title: cofold asks for a matched tool in every mode
status: todo
depends: [task-05-cofold-asks-for-a-matched-tool.md]
layer: agent-cofold
refs:
  - "[code://packages/agent-cofold/src/turnagent.ts#L382-L387](../../../../packages/agent-cofold/src/turnagent.ts#L382-L387) - `beforeTool` answers `allow` for every call"
  - "[code://packages/agent-cofold/src/turnagent.ts#L101-L107](../../../../packages/agent-cofold/src/turnagent.ts#L101-L107) - `modeOf`, which defaults to `auto`"
  - "[code://packages/agent-cofold/src/tools.ts#L26-L33](../../../../packages/agent-cofold/src/tools.ts#L26-L33) - `ruleName`, the name the rule knows a call by"
  - "[code://packages/agent-cofold/src/pauses.ts#L161-L165](../../../../packages/agent-cofold/src/pauses.ts#L161-L165) - `autoApprove` asks the rule with the raw name"
  - npm://@cofold/agents@0.4.0 - `dist/run/tools.js`: a hook's `approval` asks, and a remembered approval at `approvals/<session>/<tool>` answers it
---

## Objective

A tool the rule names asks in every cofold mode, and `dontAsk` refuses it.
A session-wide approval cofold remembered before the rule was set does not answer the question.

## Files

- `UPDATE: packages/agent-cofold/src/turnagent.ts:382-387` - answer `approval` or `deny` for a matched call.
- `UPDATE: packages/agent-cofold/src/pauses.ts:161-165` - ask the rule with `ruleName`.
- `UPDATE: packages/agent-cofold/test` - a matched call in each mode, and a remembered approval.

## Steps

1. In `beforeTool`, find the call's rule name with `ruleName`.
2. For a matched call in `dontAsk`, return `{ decision: 'deny' }` with a reason.
3. For a matched call, delete the kv entry `approvals/<session>/<tool>` if it exists.
4. Return `{ decision: 'approval' }` for a matched call in every other mode.
5. Keep the edit announcement for every call, as now.
6. In `autoApprove`, ask the rule with `ruleName(ctx.offered, name)`.
7. Add a test for a matched call in `auto`, `acceptEdits`, `bypassPermissions` and `dontAsk`.
8. Add a test for a matched call after an `allow-session` answer for the same tool.

## Validation

- `packages/agent-cofold/test`: a matched call asks in `auto`, `acceptEdits` and `bypassPermissions`.
- `packages/agent-cofold/test`: the host refuses a matched call in `dontAsk`.
- `packages/agent-cofold/test`: a remembered approval does not skip the question.
- `packages/agent-cofold/test`: an unmatched call runs as before.
- Run `pnpm --filter @ahpd/agent-cofold test` alone. Expect a pass.

## Resume


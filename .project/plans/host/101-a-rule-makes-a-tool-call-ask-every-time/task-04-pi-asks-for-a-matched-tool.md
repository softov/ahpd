---
title: pi asks for a matched tool
status: done
depends: [task-01-the-rule-is-read-in-the-approval-check.md]
layer: agent-pi
refs:
  - "[code://packages/agent-pi/src/session.ts#L396-L449](../../../../packages/agent-pi/src/session.ts#L396-L449) - `decide`"
  - "[code://packages/agent-pi/src/session.ts#L456](../../../../packages/agent-pi/src/session.ts#L456) - `askBefore`"
---

## Objective

pi's `decide` returns an ask for a matched tool before it reads the permission mode.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:396-449` - check the rule first in `decide`.
- `UPDATE: packages/agent-pi/test` - a matched tool in each mode.

## Steps

1. Call the session's check at the top of `decide`.
2. Return an ask with no "always" option for a matched tool, in every mode.
3. Write the tests.
4. Set this task and the plan row to `implemented`.

## Validation

- The agent-pi tests pass.
- `pnpm -s build` and `pnpm -s typecheck` pass.

## Resume

- **Done so far:** 2026-10-19. `decide` reads the rule at the top with `('tool', toolName)`. A matched call returns `'ask'` before the mode is read, so default, plan and `bypassPermissions` all put the question. The question carries no option list, so there is nothing on the card to keep; pi's confirmation never offered one. In `dontAsk` it returns the mode's refusal with the same reason text. Otherwise the modes and the terminal check are unchanged. Tests: `packages/agent-pi/test/agent-pi-autoapproval.test.ts` (12), with four new ones: default, `bypassPermissions`, plan, and `dontAsk`'s refusal. The existing cases now expect the rule check ahead of the terminal check. The whole agent-pi suite passes (15 files, 209 tests).
- **Next action:** build [task-05-cofold-asks-for-a-matched-tool.md](task-05-cofold-asks-for-a-matched-tool.md).
- **Open questions:** none.
- **Watch out for:** plan mode now asks for a matched write that the mode would have refused. That follows "the rule wins over every mode", and no task says otherwise.

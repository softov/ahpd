---
title: No agent says waiting on you
status: implemented
depends: []
layer: "agent-claude, agent-pi, agent-acp, agent-cofold, examples"
refs:
  - "[code://packages/agent-claude/src/session/asking.ts#L439](../../../../packages/agent-claude/src/session/asking.ts#L439) - the Claude line to remove"
  - "[code://packages/agent-pi/src/session.ts#L663](../../../../packages/agent-pi/src/session.ts#L663) - the pi line to remove"
  - "[code://packages/agent-acp/src/session/handlers.ts#L637](../../../../packages/agent-acp/src/session/handlers.ts#L637) - the ACP line to remove on a confirmation"
  - "[code://packages/agent-acp/src/session/handlers.ts#L777](../../../../packages/agent-acp/src/session/handlers.ts#L777) - the ACP line to remove on a question"
  - "[code://packages/agent-cofold/src/runs.ts#L291](../../../../packages/agent-cofold/src/runs.ts#L291) - the cofold line to remove in `reopen`"
  - "[code://examples/notes/agent.ts#L276](../../../../examples/notes/agent.ts#L276) - the example line to remove on a question"
  - "[code://examples/notes/agent.ts#L356](../../../../examples/notes/agent.ts#L356) - the example line to remove on a confirmation"
---

## Objective

No agent changes its activity when a confirmation or a question waits on the person.
The activity keeps the value it had before the wait, and the `InputNeeded` status says the session waits.

## Files

- `UPDATE: packages/agent-claude/src/session/asking.ts:439` - remove `ctx.doing(\`Waiting on you: ${displayName}\`)`.
- `UPDATE: packages/agent-pi/src/session.ts:663` - remove `activity.say(\`Waiting on you: ${displayName}\`)`.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:637` - remove `doing('Waiting on you')` on a confirmation.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:777` - remove `doing('Waiting on you')` on a question.
- `UPDATE: packages/agent-cofold/src/runs.ts:291` - remove `ctx.activity.say('Waiting on you')` in `reopen`.
- `UPDATE: examples/notes/agent.ts:276` - remove `doing('Waiting on you')` on a question.
- `UPDATE: examples/notes/agent.ts:356` - remove `doing(\`Waiting on you: ${tool.displayName}\`)` on a confirmation.
- `UPDATE: packages/agent-claude/test/agent-claude-autoapproval.test.ts` - add a case: the activity while a confirmation waits.
- `UPDATE: packages/agent-pi/test/agent-pi-asking.test.ts` - add a case: the activity while a confirmation waits.
- `UPDATE: packages/agent-acp/test/agent-acp-ports.test.ts` - add two cases: the activity while a confirmation waits, and while a question waits.
- `UPDATE: packages/agent-cofold/test/agent-cofold-plugin.test.ts` - add a case: no `Waiting on you` after `reopen` of a paused run.

## Steps

1. Remove the seven lines that *Files* names, and any comment that only explains them.
2. Keep `Waiting on <owner>: <tool>` in `clienttools.ts` and in pi's `session.ts`, because it is a wait on a client.
3. Keep Claude's answer path at `asking.ts:693` and ACP's abort handler that says `Thinking`.
4. In each agent, add a test that raises a confirmation and reads the activity it had before.
5. In ACP, add the same test for a question.
6. In cofold, add a test that reopens a paused run and reads no `Waiting on you`.
7. Run `rg -n "Waiting on you" packages examples`, and expect no match.

## Validation

- The new cases pass in agent-claude, agent-pi, agent-acp and agent-cofold.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- `pnpm --filter @ahpd/agent-claude test`, `pnpm --filter @ahpd/agent-pi test`, `pnpm --filter @ahpd/agent-acp test` and `pnpm --filter @ahpd/agent-cofold test` pass, one at a time, from the repository root.

## Resume

- **Done so far:** every step. The ACP confirmation case is in `agent-acp-ports.test.ts`, because `agent-acp.test.ts` has no harness that raises a confirmation.
- **Watch out for:** pi says `Running bash` when a call starts, before it asks, so that is the activity that stays.

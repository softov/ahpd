---
title: The live turn is a notice
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/parts.ts#L227-L249](../../../../packages/agent-claude/src/session/parts.ts#L227-L249) - `openTurn`"
  - "[code://packages/agent-claude/src/session/query.ts#L935-L947](../../../../packages/agent-claude/src/session/query.ts#L935-L947) - the `task_notification` frame"
---

## Objective

A turn that the CLI starts after a background task ends opens with a notice message.
The message is `{ text: summary, origin: { kind: 'systemNotification' } }`.

## Files

- `UPDATE: packages/agent-claude/src/session/query.ts:935-947` - keep the summary of a notification that arrives while the main scope has no open turn.
- `UPDATE: packages/agent-claude/src/session/parts.ts:227-249` - a turn opened without an opening takes the pending summary as a notice message, and clears it.
- `UPDATE: packages/agent-claude/src/session/workers.ts:73` - the session context holds the pending summary, beside `background`.
- `UPDATE: packages/agent-claude/test/agent-claude-background-work.test.ts` - a case for the notice turn, and one for a notification inside an open turn.

## Steps

1. Add one optional pending summary to the session context, with a one-line comment.
2. In the `task_notification` branch, set it from `summary` when the main scope has no open turn.
3. In `openTurn`, give a main-scope turn without an opening the pending summary as a `systemNotification` message.
4. Clear the pending summary when any main-scope turn opens.
5. Keep the empty `agent` message for a turn without an opening and without a pending summary.
6. Add a case: a turn ends, a `task_notification` arrives, and the CLI streams a new turn.
7. Assert that the new turn's message is the summary with origin `systemNotification`.
8. Add a case: a `task_notification` inside an open turn leaves the next turn's message as before.

## Validation

- `packages/agent-claude/test/agent-claude-background-work.test.ts` holds both cases, and every case passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the agent-claude tests pass.

## Resume

- **Done so far:** the session context holds one `pendingSummary` beside `background`.
A terminal `task_notification` that arrives while no main-scope turn is open sets it from `summary`; one that arrives inside a turn sets nothing.
`openTurn` gives a main-scope turn without an opening that summary as a `systemNotification` message, and clears it for every main-scope turn that opens.
- **Next action:** [task-02-the-restored-turn-is-a-notice.md](task-02-the-restored-turn-is-a-notice.md).
- **Open questions:** none.
- **Watch out for:** `claude-folded-steer.jsonl` carries a `task_notification` inside the running turn, and `claude-subagent-background.jsonl` carries one after the lead turn's result; only the second leaves a pending summary.
The agent-claude suite passes with both.

Files changed by this task: `packages/agent-claude/src/session/workers.ts`, `packages/agent-claude/src/session/parts.ts`, `packages/agent-claude/src/session/query.ts`, `packages/agent-claude/test/agent-claude-background-work.test.ts`.


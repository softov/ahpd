---
title: A live answered question carries its answers
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L3744-L3787](../../../../packages/agent-claude/src/session.ts#L3744-L3787) - the settle"
---

## Objective

When a question is answered and allowed, the completed call carries `{ ...input, answers }`; a denied or cancelled one carries no answers.
Where on the complete action it travels waits on the plan's open question: `ChatToolCallCompleteAction` has only `result` and `requiresResultConfirmation` (protocol 0.9.0 `channels-chat/actions.ts:336-342`), so it is either `result.structuredContent` or the action's `_meta`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:3744-3787` - keep `{ ...input, answers }` where the answers are settled, and put it on the complete action in the place the open question settles.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the cases below.

## Steps

1. Waits on the plan's open question. Then tests first with the faked SDK: a two-question call, one multi-select, answered: the completed call carries the questions plus `answers` keyed by question text, the multi-select an array; a cancelled one carries no answers and its `toolInput` is the input as sent.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

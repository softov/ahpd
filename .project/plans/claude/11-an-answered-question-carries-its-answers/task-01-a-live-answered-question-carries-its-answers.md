---
title: A live answered question carries its answers
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L3560-L3588](../../../../packages/agent-claude/src/session.ts#L3560-L3588) - the settle"
---

## Objective

When a question is answered and allowed, the call's `toolInput` becomes the JSON of `{ ...input, answers }` and the completed call carries it; a denied or cancelled one keeps its input.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - set the call's `toolInput` where the answers are settled, and send it on the complete action.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the cases below.

## Steps

1. Tests first with the faked SDK: a two-question call, one multi-select, answered: the completed call's `toolInput` parses to the questions plus `answers` keyed by question text, the multi-select an array; a cancelled one keeps the input as sent.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

---
title: A replayed answered question carries its answers
status: todo
depends: [task-01-a-live-answered-question-carries-its-answers.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L230-L350](../../../../packages/agent-claude/src/transcript.ts#L230-L350) - the replayed call and its result"
---

## Objective

A restored AskUserQuestion call whose transcript entry has `toolUseResult.answers` has `toolInput` equal to what the live call ended with.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts` - read `toolUseResult` on the result entry.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the case below, with a transcript line shaped like a real one.

## Steps

1. Test first: a transcript with an AskUserQuestion `tool_use` and its `tool_result` entry carrying `toolUseResult: { questions, answers }` restores a call whose `toolInput` parses to the questions plus those answers; one without `toolUseResult` keeps the input.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

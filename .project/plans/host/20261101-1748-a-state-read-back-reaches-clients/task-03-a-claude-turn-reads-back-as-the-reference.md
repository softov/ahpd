---
title: A Claude turn reads back as the reference reads it
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts) - `buildTurns`, which reads a transcript back as turns"
---

## Objective

A Claude call the transcript holds no result for reads back cancelled as skipped.
The turn holding one reads back cancelled.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:286-575` - the calls a result was written for, and each other call cancelled with its turn.
- `UPDATE: packages/agent-claude/test/agent-claude-transcript.test.ts` - a call with no result, and the turn that held it.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the restored calls a case reads past tenses from have their results.

## Steps

1. Note each call a `tool_result` names.
2. After the last frame, rewrite each other call as cancelled and skipped, with the fields the reducer keeps.
3. Read a turn holding such a call back cancelled.

## Validation

- Before the change, a call with no result reads back `completed` with `success: true`, in a `complete` turn.
- The Claude suites pass.

## Resume

<Empty until started.>

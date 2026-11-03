---
title: A Claude turn reads back as the reference reads it
status: done
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
- `UPDATE: docs/sdk/AGENT.md` - a backend's `transcript` answers a call with no result cancelled as skipped, and its turn cancelled.
- `UPDATE: packages/sdk/src/host/history.ts` - a worker read back is linked from its call's content only where the call finished.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - a worker's call that never finished reads back cancelled with no content.

## Steps

1. Note each call a `tool_result` names.
2. After the last frame, rewrite each other call as cancelled and skipped, with the fields the reducer keeps.
3. Read a turn holding such a call back cancelled.

## Validation

- Before the change, a call with no result reads back `completed` with `success: true`, in a `complete` turn.
- The Claude suites pass.

## Resume

Done. Before the change the call read back `completed` with `success: true`, in a `complete` turn.
The Claude suites pass.

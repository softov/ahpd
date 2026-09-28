---
title: A call pi failed before its hook still closes in a client
status: done
depends: [task-04-the-ask-reuses-the-row-pi-opened.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L167-L213](../../../../packages/agent-pi/src/mapping.ts#L167-L213) - `tool_execution_end`, which readies a call still `streaming` before completing it"
  - "[code://packages/agent-pi/test/agent-pi.test.ts#L502](../../../../packages/agent-pi/test/agent-pi.test.ts#L502) - the case, folded as a client folds it"
  - npm://@earendil-works/pi-agent-core@0.87.1 - `agent-loop.js`: `prepareToolCall` returns an error without calling `beforeToolCall` for an unknown tool or arguments that fail validation, after `tool_execution_start` was emitted
  - npm://@microsoft/agent-host-protocol@0.9.0 - `dist/types/channels-chat/reducer.js`: `ChatToolCallComplete` is ignored unless the call is `running`, `pending-confirmation` or `auth-required`
---

## Objective

A call pi fails before its `tool_call` hook, for a tool it does not have or arguments that do not validate, ends `completed` in a client instead of staying `streaming`.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts:167-213` - `tool_execution_end` sends a `not-needed` `chat/toolCallReady` before the complete when the row was never readied.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the case below, and the failed-call case picks the complete by type.

## Steps

1. At `tool_execution_end`, a row still `streaming` was never readied, because the hook is the only other source of the ready.
2. Send `chat/toolCallReady` with `confirmed: 'not-needed'` and its `contributor` for a client-owned tool, then the complete, and record both in the snapshot.

## Validation

- `completes a call pi failed before its hook, as a client folds it`: start then a failed end with no hook in between folds to `completed`, with one `not-needed` ready.
- It failed first with "expected 'streaming' to be 'completed'".
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built in review, 2026-09-27.
`tool_execution_end` readies a still-`streaming` row before completing it, in the actions and in the snapshot.
`closes a failed call with the error a client shows` now finds the complete by type, since that call is also unreadied and gets the ready first.
`node_modules/.bin/vitest run packages/agent-pi` green, 92 tests; `pnpm typecheck` green.

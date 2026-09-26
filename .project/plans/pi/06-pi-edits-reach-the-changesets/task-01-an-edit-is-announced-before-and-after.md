---
title: An edit is announced before and after
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L182-L236](../../../../packages/agent-pi/src/session.ts#L182-L236) - `heard`, where the events are seen"
  - "[code://packages/agent-cofold/src/session.ts#L237-L275](../../../../packages/agent-cofold/src/session.ts#L237-L275) - `editing`, `announceEdit`, `settleEdit` to copy"
---

## Objective

`piSession` calls `start.onFileEdit` with `before` when pi's `edit` or `write` starts and `after` when it ends, once each, for the absolute path.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - an `editing` map by tool call id; `heard` handles `tool_execution_start` and `tool_execution_end` for `edit` and `write`; `agent_settled` settles what is left.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. On `tool_execution_start` with `toolName` `edit` or `write` and a string `args.path`, resolve it against `where`, keep it under `toolCallId`, and call `onFileEdit(turnId, path, 'before')`.
2. On `tool_execution_end` for a kept id, call `after` and forget it.
3. On `agent_settled`, before `finish`, call `after` for every id still kept.

## Validation

- `test/agent-pi.test.ts`: an `edit` with a relative path yields `before` and `after` for the absolute path under the session's directory, on the running turn's id; a `read` yields nothing; a call with no end gets its `after` at the settle.
- `pnpm test`, `pnpm typecheck` green.

## Resume

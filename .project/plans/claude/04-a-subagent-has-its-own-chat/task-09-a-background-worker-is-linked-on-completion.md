---
title: A background worker is linked from its call when the call completes
status: todo
depends: [task-08-the-host-holds-only-a-workers-call-content.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1655-L1692](../../../../packages/agent-claude/src/session.ts#L1655-L1692) - the spawning call's completion, its ending, and `workerBlock`"
  - "[code://packages/sdk/src/host.ts#L2880-L2893](../../../../packages/sdk/src/host.ts#L2880-L2893) - `openSubagent` writing the link with an empty turn id when the lead turn has ended"
  - "[code://test/agent-claude-subagent.test.ts#L161-L174](../../../../test/agent-claude-subagent.test.ts#L161-L174) - the background case, which never looks at the completion's content"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/agentSideEffects.ts#L1049-L1066 - the reference writing the link only `if (parentTurnId)`
---

## Objective

A background worker's chat is opened when its spawning call's `tool_result` arrives, so the completion carries the `subagent` content, per [A background worker is linked from its call when the call completes](../../../decisions/a-background-worker-is-linked-when-its-call-completes.md).

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1559-1669` - `results`: today a background call completes with `workerBlock` undefined, because no worker frame has arrived yet.
- `UPDATE: packages/sdk/src/host.ts:2880-2893` - `openSubagent` dispatches `chat/toolCallContentChanged` with `turnId: ''` when the parent chat has no open turn.
- `UPDATE: test/agent-claude-subagent.test.ts:161-174`.
- `UPDATE: test/subagent-chat.test.ts`.

## Steps

1. In `results`, before building `result` for a call in `spawning`: when the call is not a foreground spawn (its input did not say `run_in_background: false`, per task 14's rule), open its worker with `scopeFor(id)` so `workerBlock(id)` names the chat.
2. The ending logic after the completion is unchanged: a background worker still ends on its terminal `task_notification`.
3. In `openSubagent`, dispatch the link only when `turnsOf` has an open turn for the parent chat, as the reference does; the completion carries it otherwise.

## Validation

- `test/agent-claude-subagent.test.ts`, background case: the lead's `chat/toolCallComplete` for `toolu_01Riysq5EgQZGcUE9kDMp6AB` has a `subagent` content whose `resource` is the worker's URI, and the seam was asked for the worker before that completion was emitted. Today the content is `[text]` only and the case fails.
- `test/subagent-chat.test.ts`, a new case: the fake completes its spawning call and its turn first, then calls `start.subagent`; no `chat/toolCallContentChanged` with an empty `turnId` is on the wire. The current fake opens the worker while the call is running, which is why this was never seen.
- `pnpm typecheck` green.

## Resume

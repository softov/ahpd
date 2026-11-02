---
title: An action sent after a stop waits for the stopped turn's end
status: done
depends: [task-03-a-stop-and-a-result-are-said-when-taken.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the wait before a chat's action is applied, beside the wait for a session started again"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `letGo`, and a backend's end of a turn the chat has ended"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentHostTurnService.ts#L126-L167 - the reference host hands a client's turn to its agent while an abort may still be under way"
---

## Objective

A client's stop ends the turn in every client's state before the backend lets the turn go.
An action a client sends on the chat in that time is sent to an idle chat.
It waits for the backend's end of the stopped turn, and is then applied to a backend that runs nothing.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - a chat's action waits while its backend runs a turn the chat has ended.
- `UPDATE: packages/sdk/src/host.ts` - `letGo`, settled by the backend's end of a turn the chat has ended.
- `UPDATE: packages/sdk/src/host/context.ts` - `letGo` on the host's context.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - a turn and a queued message sent after a stop, before the run let the stopped turn go.
- `UPDATE: docs/sdk/AHP.md` - the `chat/turnCancelled` row.

## Steps

1. Read the backend's running turn against the turns the chat holds as ended.
2. Return a wait on `letGo` for such a chat, bounded by `WAIT_LIMIT`, and then apply the action again.
3. Settle `letGo` when the backend says the end of a turn the chat has ended.

## Validation

- `pnpm exec vitest run packages/agent-cofold/test/agent-cofold-turn.test.ts` - passes; the two new cases fail on a70ec953.
- `pnpm run typecheck` - exits 0.

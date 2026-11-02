---
title: A request ends by an answer or its turn
status: todo
depends: [task-01-a-session-asks-what-its-chats-ask.md]
layer: agent-acp, bot
refs:
  - "[code://packages/agent-acp/src/session/handlers.ts#L755-L860](../../../../packages/agent-acp/src/session/handlers.ts#L755-L860) - ACP's endings of a question"
  - "[code://packages/bot/src/chat.ts#L650-L673](../../../../packages/bot/src/chat.ts#L650-L673) - `withdrawAsked`"
---

## Objective

ACP and the bot say no `chat/inputCompleted` and no `chat/toolCallConfirmed` that no client sent.
A request no client answered stays in its turn, and the turn's end closes it.

## Files

- `UPDATE: packages/agent-acp/src/session/handlers.ts:755-860` - a question the server takes back, completes or leaves at a stop is settled with the agent alone.
- `UPDATE: packages/bot/src/chat.ts:650-673` - a request the back session stopped waiting on stays in the open turn.
- `UPDATE: packages/agent-acp/test` and `packages/bot/test` - the cases that read the ending.

## Steps

1. Remove the `chat/inputCompleted` that ACP says for a question its agent took back or completed, or at a stop.
2. Remove the completion and the confirmation the bot says when a back session stops waiting.
3. Change the cases that read those endings to read the request still open until its turn ends.

## Validation

- The changed cases fail on `89ebe4d5` and pass after.
- The agent-acp and bot test files pass.
- `pnpm run typecheck` is clean.

## Resume

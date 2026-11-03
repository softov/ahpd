---
title: A request ends by an answer or its turn
status: done
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
- `UPDATE: packages/agent-acp/test/agent-acp-ports.test.ts` - three cases that read the ending.
- `UPDATE: packages/bot/test/bot-ask.test.ts` - the withdrawn question's case.

## Steps

1. Remove the `chat/inputCompleted` that ACP says for a question its agent took back or completed, or at a stop.
2. Remove the completion and the confirmation the bot says when a back session stops waiting.
3. Change the cases that read those endings to read the request still open until its turn ends.

## Validation

- The changed cases fail on `89ebe4d5` and pass after.
- The agent-acp and bot test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- ACP's three endings no longer touch the chat or the session's entry: task 01 takes the entry down with the turn.
- `agent-acp-ports.test.ts` moved with the behavior: three cases read the completion said in nobody's name.
- `bot-ask.test.ts` moved too: its case read the copy spliced out and a cancelled completion.
- On `89ebe4d5`'s sources the four changed cases fail: each read the ending said in nobody's name.

---
title: A back session's question is asked in the main chat
status: done
depends: [task-05-the-main-turn-shows-the-back-session.md]
layer: "packages/bot"
refs:
  - "[code://packages/sdk/src/types/events.ts#L144-L168](../../../../packages/sdk/src/types/events.ts#L144-L168) - `input_needed_set` and `input_needed_removed`"
  - "[code://packages/agent-claude/src/session/asking.ts#L298-L385](../../../../packages/agent-claude/src/session/asking.ts#L298-L385) - how a question and an approval are in state"
  - "[code://packages/bot/src/chat.ts#L345-L346](../../../../packages/bot/src/chat.ts#L345-L346) - `confirm` and `answer`, which do nothing now"
---

## Objective

A question or an approval in a back session is shown in the open main turn.
The person answers it in the main chat, and the answer goes to the back session.
A question that the back session withdraws leaves the main chat.

## Files

- `CREATE: packages/bot/src/ask.ts` - the copy of a request, and the answer back.
- `UPDATE: packages/bot/src/chat.ts` - `confirm` and `answer` hand the answer to the plugin.
- `UPDATE: packages/bot/src/plugin.ts` - listen to `input_needed_set` and `input_needed_removed`.
- `CREATE: packages/bot/test/bot-ask.test.ts` - the tests of a question and an approval.

## Steps

1. Listen to `input_needed_set` for each back session in the map of task 03.
2. Read the request from the back session's state.
3. Show an approval in the main turn as a tool call with `pending-confirmation`, with the same title.
4. Show a question in the main turn as `chat/inputRequested`, with the same fields.
5. Send a `confirm` from the main chat as `chat/toolCallConfirmed` on the back session's chat.
6. Send an `answer` from the main chat as `chat/inputCompleted` on the back session's chat.
7. Remove the copy from the main turn on `input_needed_removed`.

## Validation

- `bot-ask.test.ts`: test that an approval and a question from the main chat reach the back session.
- `bot-ask.test.ts`: test that a withdrawn question leaves the main chat.
- `pnpm -s exec vitest run packages/bot` passes.

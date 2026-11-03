---
title: A withdrawn copy clears at once
status: todo
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L650-L653](../../../../packages/bot/src/chat.ts#L650-L653) - `withdrawAsked`, which now only removes the request from the list"
  - "[code://packages/bot/src/chat.ts#L1092-L1116](../../../../packages/bot/src/chat.ts#L1092-L1116) - the bot chat's own answers, which carry `turnId: held.id`"
  - "[code://packages/bot/test/bot-chat.test.ts](../../../../packages/bot/test/bot-chat.test.ts) - the chat tests, which hold the reducer"
  - npm://@microsoft/agent-host-protocol@1.0.0 - the reducer ignores a tool call action whose `turnId` is not the active turn
---

## Objective

When the back session stops asking, the copy in the main chat leaves the open turn, and a live client sees it end at once.

## Files

- `UPDATE: packages/bot/src/chat.ts:639-653` - `withdrawAsked` removes the part and says the end, with the open turn's `turnId`; its comment says why.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the cases for a withdrawn call and a withdrawn question.

## Steps

1. Read the code that git://90efda43 removed from `withdrawAsked` with `git show 90efda43 -- packages/bot/src/chat.ts`.
2. Restore it: remove the copy from `held.asked` and from `held.responseParts`.
3. For an `inputRequest` part, emit `chat/inputCompleted` with the request id and `response: 'cancel'`.
4. For a tool call part, emit `chat/toolCallConfirmed` with `turnId: held.id`, the call id, `approved: false` and `reason: 'skipped'`.
5. Write the comment: the back session no longer asks, and Softov chose on 2026-11-02 that the copy clears at once.
6. Add a test: a withdrawn call, run through the protocol's chat reducer, ends as `cancelled` in the open turn.
7. Add a test: a withdrawn question ends its request in the open turn.

## Validation

- `pnpm --filter @ahpd/bot test` passes, run alone.
- `pnpm typecheck` passes.

## Resume

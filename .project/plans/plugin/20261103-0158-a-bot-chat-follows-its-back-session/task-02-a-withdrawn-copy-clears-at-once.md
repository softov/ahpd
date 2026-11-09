---
title: A withdrawn copy clears at once
status: done
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L659-L662](../../../../packages/bot/src/chat.ts#L659-L662) - `withdrawAsked`, which now only removes the request from the list"
  - "[code://packages/bot/src/chat.ts#L1117-L1141](../../../../packages/bot/src/chat.ts#L1117-L1141) - the bot chat's own answers, which carry `turnId: held.id`"
  - "[code://packages/bot/test/bot-chat.test.ts](../../../../packages/bot/test/bot-chat.test.ts) - the chat tests, which hold the reducer"
  - npm://@microsoft/agent-host-protocol@1.0.0 - the reducer ignores a tool call action whose `turnId` is not the active turn
---

## Objective

When the back session stops asking, the copy in the main chat leaves the open turn, and a live client sees it end at once.

## Files

- `UPDATE: packages/bot/src/chat.ts:648-662` - `withdrawAsked` removes the part and says the end, with the open turn's `turnId`; its comment says why.
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

- **Done so far:** `withdrawAsked` in `packages/bot/src/chat.ts` removes the copy from `held.asked` and `held.responseParts` and says the end. A question ends with `chat/inputCompleted`, the request id and `response: 'cancel'`. A call ends with `chat/toolCallConfirmed`, `turnId: held.id`, the call id, `approved: false` and `reason: 'skipped'`. Its comment says why, and names Softov's choice of 2026-11-02. Two cases in `bot-chat.test.ts` replay a withdrawal through `openedFrom` and `replayed`, so the protocol's own reducer reads it. The call ends `cancelled` with `reason: 'skipped'`, and the question carries `response: 'cancel'`.
- **Next action:** [task-03-a-back-turn-opens-a-main-turn.md](task-03-a-back-turn-opens-a-main-turn.md).
- **Open questions:** none.
- **Watch out for:** `bot-ask.test.ts` held a case that asserted the old behaviour, `leaves the copy in the main chat when the back session withdraws its question, and says nothing`. The new behaviour makes that assertion wrong, so the case is now `takes the copy out of the main chat when the back session withdraws its question`; the task's Files list does not name that file. The reducer keeps the part and marks it, because no action removes a response part. The turn that the host serves to a late client does not have the part.

Files changed by this task: `packages/bot/src/chat.ts`, `packages/bot/test/bot-ask.test.ts`, `packages/bot/test/bot-chat.test.ts`.


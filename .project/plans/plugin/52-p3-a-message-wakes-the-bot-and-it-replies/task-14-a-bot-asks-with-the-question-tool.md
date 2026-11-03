---
title: A bot asks with the question tool
status: done
depends: [task-06-a-back-sessions-question-is-asked-in-the-main-chat.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/post.ts#L37](../../../../packages/bot/src/post.ts#L37) - `POST_INSTRUCTION`, the system prompt of a back session"
---

## Objective

A back session asks the person a question with its harness's question tool, not in a reply.
Task 06 shows that question in the main chat, and the answer goes back to the back session.
A harness that has no question tool asks in its `post_message` text.

## Files

- `UPDATE: packages/bot/src/post.ts` - add the rule for questions to `POST_INSTRUCTION`.
- `UPDATE: packages/bot/test/bot-post.test.ts` - the instruction holds the rule.

## Steps

1. Add a sentence to `POST_INSTRUCTION`: ask with your question tool, or with `post_message` when you have none.
2. Do not name a tool, because each harness names its own.

## Validation

- `bot-post.test.ts`: test that the instruction holds the rule.
- By hand: a Claude bot that needs an answer calls `AskUserQuestion`, and the question shows in the main chat.
- The gates pass: build, typecheck, boundary, schema and vitest.

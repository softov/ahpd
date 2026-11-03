---
title: A draft answer is taken on any chat
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1976-L2000](../../../../packages/sdk/src/host/chatactions.ts#L1976-L2000) - the refusal for a backend that keeps no drafts"
  - "[code://packages/sdk/src/host/channels.ts#L169-L170](../../../../packages/sdk/src/host/channels.ts#L169-L170) - `WORKER_ACTIONS`"
---

## Objective

A draft answer for a request the chat holds open is said to every client of the chat.
It is taken on a worker's chat, and for a backend with no `setAnswer`.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1976-2000` - the host says the draft when the backend keeps none.
- `UPDATE: packages/sdk/src/host/channels.ts:169-170` - a worker's chat takes `chat/inputAnswerChanged`.
- `UPDATE: packages/sdk/test/host-input-needed.test.ts` - a draft on a backend that keeps none.
- `UPDATE: packages/sdk/test/subagent-chat.test.ts` - a draft on a worker's chat.
- `UPDATE: docs/sdk/AHP.md:291` - the `chat/inputAnswerChanged` row.

## Steps

1. Hand the draft to the backend's `setAnswer` when it has one.
2. Say the draft on the chat when the backend says nothing back.
3. Add `chat/inputAnswerChanged` to the actions a worker's chat takes.
4. Change the cases that read the refusal, and add one for a worker's chat.

## Validation

- The changed cases fail on `89ebe4d5` and pass after.
- The sdk test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- No test read the refusal for a backend that keeps no drafts, nor the worker chat's refusal of a draft.
- The new cases are in `host-input-needed.test.ts` and `subagent-chat.test.ts`.
- `AHP.md`'s `chat/inputAnswerChanged` row now names both refusals of task 02 as well.
- On task 02's sources both cases fail: one refused for the backend, the other as a read-only subagent chat.

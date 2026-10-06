---
title: A lead chat's chat/inputCompleted is dispatched back to every client
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L936-L951](../../../../packages/sdk/src/host/chatactions.ts#L936-L951) - the case that only calls `session.answer`"
  - "[code://packages/sdk/src/host/chatactions.ts#L248-L255](../../../../packages/sdk/src/host/chatactions.ts#L248-L255) - `chat/draftChanged`, echoed with `dispatch(channel, action, origin)`"
  - "[code://packages/sdk/src/nested.ts#L907](../../../../packages/sdk/src/nested.ts#L907) - the worker chat's own delivery, which must not double"
---

## Objective

When a client answers or declines a question on a lead chat, every client of that chat, the answering one included, receives the `chat/inputCompleted` action at once, so its `inputRequest` part shows the response before the agent moves on.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:936-951` - after `session.answer(...)`, `dispatch(channel, action, origin)`; today nothing is dispatched.
- `UPDATE: packages/sdk/test/host-input.test.ts` - the cases below.

## Steps

1. Test first: on a fake session holding a question, a client's `chat/inputCompleted` with `response: 'accept'` and answers is received by a second client and by the first, before the fake completes its tool call.
2. Echo the action from the `chat/inputCompleted` case, the way `chat/draftChanged` is echoed.
3. Echo only an answer the session took: if `session.answer` cannot say so, add a boolean return as `setAnswer` has, and refuse an unknown request id with `no(...)` as `chat/inputAnswerChanged` does.
4. Check a worker chat: its `chat/inputCompleted` still arrives once.

## Validation

- `packages/sdk/test/host-input.test.ts`: the echo reaches both clients; an unknown request id is refused and not echoed; a decline is echoed with `response: 'decline'`.
- `packages/sdk/test/subagent-chat.test.ts` still passes, with one delivery per answer on a worker chat.
- `pnpm test` in `packages/sdk`.

## Resume


---
title: The webhook picks its session shape
status: todo
depends:
  - task-03-the-back-is-a-chat-of-the-front.md
layer: "webhook"
refs:
  - "[code://packages/webhook/src/plugin.ts#L247-L300](../../../../packages/webhook/src/plugin.ts#L247-L300) - one session for each bot, and a chat for each thread"
---

## Objective

The webhook option `threadSessions` is `false` by default, one session for each bot as today, or `true`, a session for each caller thread.

## Files

- `UPDATE: packages/webhook/src/plugin.ts:247-300` - read `threadSessions`, and make a session for each thread when it is `true`.
- `UPDATE: packages/webhook/src/plugin.ts:42` - add `threadSessions: false` to the defaults.
- `UPDATE: packages/webhook/test` - the cases in *Validation*.

## Steps

1. Add `threadSessions` to the webhook defaults, `false` by default.
2. With `false`, keep one session for each bot and a Front chat for each thread.
3. With `true`, make a session for each thread with `createSession`, and keep it in the thread's row.
4. Report a value that is not a boolean, and use `false`.

## Validation

- A test with `threadSessions: false` sends from two threads. Both are chats of one session, each with its own Back chat.
- A test with `threadSessions: true` sends from two threads, and each has its own session.
- `pnpm typecheck` passes, and `pnpm vitest run packages/webhook` passes.

## Resume


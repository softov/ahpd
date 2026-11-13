---
title: A read-only chat takes no message from a client
status: todo
depends:
  - task-01-a-chat-request-names-origin-and-tools.md
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L473-L495](../../../../packages/sdk/src/host/chatactions.ts#L473-L495) - the refusals a worker chat gives today"
---

## Objective

A client's turn, queued message and resume in any `read-only` chat are refused, a worker's or a plugin's.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:473-495` - apply the worker chat's refusals to every `read-only` chat, keeping the worker's command path.
- `UPDATE: packages/sdk/test` - the cases in *Validation*.

## Steps

1. Read the chat's interactivity in `chatactions.ts` where a client's action arrives.
2. Refuse `chat/turnStarted` with `readOnly` and `This chat is read-only.` when the interactivity is `read-only`.
3. Refuse `chat/pendingMessageSet` and `chat/turnResume` in the same chat, with the worker chat's words.
4. Keep the worker branch first, so a worker's command still reaches its lead.

## Validation

- A test sends a client turn to a plugin's `read-only` chat, and reads the `readOnly` refusal.
- A test queues a message and resumes a turn in that chat, and the host refuses both.
- A test sends a turn to a plugin's `full` chat, and the turn runs.
- The existing worker chat tests pass unchanged.
- `pnpm typecheck` passes, and `pnpm vitest run packages/sdk` passes.

## Resume


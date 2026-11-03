---
title: The main turn shows the back session as a subagent
status: done
depends: [task-03-a-message-wakes-a-back-session.md]
layer: "packages/sdk, packages/bot"
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L166](../../../../packages/sdk/src/host/spawn.ts#L166) - `withWorkerUri`, which stamps a worker chat only where none is named"
  - "[code://packages/sdk/src/host/spawn.ts#L339-L436](../../../../packages/sdk/src/host/spawn.ts#L339-L436) - `openSubagent`, the `subagent` content of a call"
  - "[code://packages/sdk/src/automations/calllinks.ts#L30](../../../../packages/sdk/src/automations/calllinks.ts#L30) - a spawning call"
---

## Objective

An open main turn shows one tool call of kind `subagent`, whose content links the back session's chat.
A client opens that chat from the call, as it opens a subagent's chat.

## Files

- `UPDATE: packages/bot/src/chat.ts` - the handle of task 02 starts and ends the call.
- `UPDATE: packages/sdk/src/automations/calllinks.ts` - a spawning call may link a chat in another session.
- `UPDATE: packages/sdk/src/host/spawn.ts` - keep a `subagent` content that names a chat in another session.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the tests of the call.
- `CREATE: packages/sdk/test/subagent-link.test.ts` - a call in one session links a chat in another.

## Steps

1. Add `working(chat, title)` to the handle, which emits `chat/toolCallStart` and `chat/toolCallReady` with `_meta.toolKind: 'subagent'`.
2. Emit `chat/toolCallContentChanged` with content `{ type: 'subagent', resource: chat, title }`.
3. Complete the call when the main turn ends.
4. Call `working` from the wake of task 03 with the back session's default chat.
5. Read how `calllinks.ts` and `spawn.ts` treat a `subagent` content that names another session's chat.
6. Change them to keep the link, and to answer a client that subscribes to the linked chat.
7. Leave a worker chat in the same session as it is.

## Validation

- `subagent-link.test.ts`: the call keeps its link, and a subscribe to the linked chat answers its state.
- `bot-chat.test.ts`: the call starts with the wake and completes with the main turn.
- `pnpm -s exec vitest run packages/sdk packages/bot` passes.

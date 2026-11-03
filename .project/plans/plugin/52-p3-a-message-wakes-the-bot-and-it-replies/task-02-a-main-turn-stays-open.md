---
title: A main turn stays open
status: done
depends: []
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/chat.ts#L235-L263](../../../../packages/bot/src/chat.ts#L235-L263) - `beginTurn`, which completes the turn it starts"
  - "[code://packages/bot/src/chat.ts#L278](../../../../packages/bot/src/chat.ts#L278) - `status`, always idle"
  - "[code://packages/bot/src/chat.ts#L314-L346](../../../../packages/bot/src/chat.ts#L314-L346) - `begin`, `queue`, `cancel`, `confirm` and `answer`"
---

## Objective

A turn in a main chat stays open after it starts, and a handle the plugin holds ends it.
The handle ends a turn with a markdown response, with a notice, or as cancelled.
The log keeps the response, so a chat replays it after a restart.

## Files

- `UPDATE: packages/bot/src/chat.ts` - the open turn, the handle, `status`, `steer` and `cancel`.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the tests of the open turn.

## Steps

1. Remove `chat/turnComplete` from `beginTurn`, and hold the turn as the chat's active turn.
2. Report the active turn in `chatState().activeTurn`, and `Status.InProgress` while one is open.
3. Export `turns(session)`, a handle with `reply(text)`, `notice(text)`, `end()` and an `onMessage` listener.
4. Make `reply` emit a markdown `chat/responsePart` and `chat/turnComplete`.
5. Make `notice` emit a `systemNotification` part and `chat/turnComplete`.
6. Make `cancel` emit `chat/turnCancelled`.
7. Write a second log line when a turn ends, with its response, and read it back in `turnOf`.
8. Add `steer(id, text)`, which tells the `onMessage` listener and keeps the text in the open turn's log.
9. Give `onMessage` each new turn and each steer, with the session URI, the turn id and the text.
10. Without a listener, end the turn at once with no response, as today.

## Validation

- `bot-chat.test.ts`: test that a turn stays open, and that a reply, a notice or a cancel ends it.
- `bot-chat.test.ts`: test that a steer reaches the listener, and that a restart replays the response.
- `pnpm -s exec vitest run packages/bot` passes.

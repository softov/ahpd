---
title: The Back is a chat of the Front's session
status: todo
depends:
  - task-01-one-session-for-each-bot-and-person.md
  - task-02-the-front-runs-in-the-bots-folder.md
layer: "bot"
refs:
  - "[code://packages/bot/src/wake.ts#L299-L335](../../../../packages/bot/src/wake.ts#L299-L335) - `sessionFor`, which goes"
  - "[code://packages/bot/src/wake.ts#L337-L362](../../../../packages/bot/src/wake.ts#L337-L362) - the maps, keyed by Back chat or removed"
  - "[code://packages/bot/src/wake.ts#L397-L420](../../../../packages/bot/src/wake.ts#L397-L420) - `cancelSubagent`"
  - "[code://packages/bot/src/wake.ts#L462-L530](../../../../packages/bot/src/wake.ts#L462-L530) - `sessionNamed`, which `backOf` replaces"
  - "[code://packages/bot/src/wake.ts#L549-L558](../../../../packages/bot/src/wake.ts#L549-L558) - the queued message"
  - "[code://packages/bot/src/post.ts#L80-L90](../../../../packages/bot/src/post.ts#L80-L90) - `post_message`'s lookup"
  - "[code://packages/bot/src/ask.ts#L118-L125](../../../../packages/bot/src/ask.ts#L118-L125) - the question copy, keyed by Back chat"
  - "[code://packages/bot/src/plugin.ts#L702-L711](../../../../packages/bot/src/plugin.ts#L702-L711) - a turn typed in the Back stays there, kept as it is"
  - "[code://packages/bot/src/plugin.ts#L552-L561](../../../../packages/bot/src/plugin.ts#L552-L561) - the bot's client connection, which reads the session's chats and their origins"
  - "[code://packages/bot/src/chat.ts#L581-L600](../../../../packages/bot/src/chat.ts#L581-L600) - `subagent`, which makes its call id after the chat exists"
  - "[code://packages/sdk/src/host/catalogue.ts#L244-L268](../../../../packages/sdk/src/host/catalogue.ts#L244-L268) - a chat summary carries the chat's `origin`"
---

## Objective

A message in the Front wakes the one Back chat of that Front, found by its origin, in the same session. The bot starts no Back session.

## Files

- `UPDATE: packages/bot/src/wake.ts:462-530` - replace `sessionNamed` with `backOf`, which finds or starts the Back chat.
- `UPDATE: packages/bot/src/wake.ts:337-362` - key the maps by Back chat, and remove what the session state answers.
- `UPDATE: packages/bot/src/wake.ts:299-335` - remove `sessionFor`.
- `UPDATE: packages/bot/src/post.ts:80-90` - find the Front from `at.chat` and its origin.
- `UPDATE: packages/bot/src/ask.ts:118-125` - key the copies by Back chat.
- `UPDATE: packages/bot/src/chat.ts:581-600` - let `subagent` take a call id that the wake makes.
- `UPDATE: packages/bot/src/names.ts` - stop writing `bots/<slug>/sessions` rows, and keep reading them for the old Back sessions' connectors.
- `UPDATE: packages/bot/test` - the cases in *Validation*.

## Steps

1. In `backOf`, read the session's chats over the bot's client connection. `PluginHost` has no call that lists them. Take the chat whose `tool` origin names the Front chat.
2. When there is none, start it with `startChat` on the bot's `preset`, else its `provider` and `model`.
3. Give the new chat the bot's name as title, and `post_message` in `tools`.
4. Make the `subagent` call id before `startChat`. Give the new chat a `tool` origin with the Front chat and that id, and pass the id to `handle.subagent`. A later Front turn makes a new `subagent` call to the same Back chat. The origin keeps the id of the first call.
5. Send the queued message to the Back chat, as `pending` does.
6. Key `answering`, `startedTurns`, `delivering` and the `ask.ts` copies by Back chat.
7. Read the bot from the session's `bot` setting, and remove the `started` map.
8. In `post_message`, read the origin of `at.chat` over the client connection. Post to the Front turn it names.
9. Point `cancelSubagent` at the Back chat.
10. Keep a turn the person types in the Back in the Back, as `plugin.ts:702-711` does.
11. Leave the old Back sessions as they are, and write no new `bots/<slug>/sessions` rows.

## Validation

- A test sends a message in Luiz's Front. A Back chat opens in that session. Its `tool` origin names the Front chat and the id of the Front turn's `subagent` call.
- A test sends a second message, and it goes to the same Back chat.
- A test posts from the Back, and the text lands in the Front turn.
- A test posts from another chat, and the tool refuses it.
- A test types in the Back, and the reply stays in the Back with no Front turn.
- A test stops the Front turn. The bot cancels the Back turn and removes its queued messages.
- `pnpm typecheck` passes, and `pnpm vitest run packages/bot` passes.

## Resume


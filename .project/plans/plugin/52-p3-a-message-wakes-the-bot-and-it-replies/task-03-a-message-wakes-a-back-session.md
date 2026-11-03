---
title: A message wakes a back session
status: done
depends: [task-01-a-main-chat-and-its-back-sessions-have-names.md, task-02-a-main-turn-stays-open.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/record.ts#L55-L88](../../../../packages/bot/src/record.ts#L55-L88) - `harness`, `model`, `preset` and `template`, which no code uses yet"
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - `chatOf`, which starts a session through `options.sessions.start`"
  - "[code://packages/webhook/src/plugin.ts#L66-L98](../../../../packages/webhook/src/plugin.ts#L66-L98) - a plugin's dispatcher, for a turn or a steer"
  - "[code://packages/sdk/src/host/chatactions.ts#L1159-L1172](../../../../packages/sdk/src/host/chatactions.ts#L1159-L1172) - a steer reaches `Session.steer`"
---

## Objective

A message in a main chat goes to the back session that the bot's name gives.
The message is a turn when that session is idle, and a steer when it works.
When no back session has the name, the plugin starts one on the bot's harness, in the bot's folder.

## Files

- `CREATE: packages/bot/src/wake.ts` - the name, the start, the turn and the steer.
- `UPDATE: packages/bot/src/record.ts` - a `session` field that holds the name, with `work` as the default.
- `UPDATE: packages/bot/src/provider.ts` - the manifest names `session`.
- `UPDATE: packages/bot/src/plugin.ts` - set the `onMessage` listener of task 02 to the wake.
- `CREATE: packages/bot/test/bot-wake.test.ts` - the tests of the wake.

## Steps

1. Add `session` to `BotRecord`, a name that may hold `{turn}`, with `work` as the default.
2. Put the turn id in place of `{turn}` in the name.
3. Refuse a filled name that is not a slug.
4. Find the back session from the `bot-sessions` row of task 01.
5. Start a session when the row is absent or names a session the host no longer has.
6. Start it with the bot's `harness`, `model` and `preset`, in the bot's folder, owned by the main chat's person.
7. Write the row with the new session URI.
8. Send the message as a `chat/turnStarted` on the back session's default chat when it is idle.
9. Send the message as a `chat/pendingMessageSet` of kind `steering` when it works.
10. Keep a map from back session to the main chat's open turn, for tasks 04 to 06.
11. When the host refuses a start or a send, end the main turn with a notice that names the cause.

## Validation

- `bot-wake.test.ts`: test that a first message starts a back session, and a second is a turn in it.
- `bot-wake.test.ts`: test that a message while the back session works is a steer.
- `bot-wake.test.ts`: test that `{turn}` starts a new back session for each message.
- `bot-wake.test.ts`: test that a refused start ends the main turn with a notice.
- `pnpm -s exec vitest run packages/bot` passes.

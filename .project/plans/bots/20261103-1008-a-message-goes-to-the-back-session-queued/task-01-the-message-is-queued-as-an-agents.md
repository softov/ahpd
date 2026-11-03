---
title: The message is queued as an agent's
status: todo
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts) - what the wake sends, waits on and takes back"
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - the `turn_start` handler"
---

## Objective

The wake sends every message as a queued `chat/pendingMessageSet` on the back session's chat.
The message carries the words with the context block, `origin: { kind: 'agent' }`, and the main chat in `_meta`.
The main turn is answered by the back turn the last message it sent becomes.
A stop of the main turn takes back the messages still waiting in the back session.

## Files

- `UPDATE: packages/bot/src/wake.ts` - `queued`, `Answering.waiting`, `taken`, and the waits in `finished` and `stopped`.
- `UPDATE: packages/bot/src/plugin.ts` - `turn_start` tells the wake a turn of a back session it waits on began; `look` answers no `working`.
- `UPDATE: packages/bot/src/chat.ts` - a `ChatMessage` names its chat, and carries no model, agent or attachments.
- `UPDATE: packages/sdk/src/types/events.ts`, `packages/sdk/src/host/spawn.ts` - `turn_start` names the queued message a turn took up.
- `UPDATE: docs/plugins/BOTS.md`, `docs/plugins/PLUGINS.md` - what a message becomes, and the `turn_start` fields.
- `UPDATE:` the bot wake, context, post, ask and chat cases, and the plugin events file.

## Steps

1. Send each message as a queued pending message with the router's message shape.
2. Keep the ids of the messages sent that no turn has taken up.
3. Name the queued message a turn took up on `turn_start`.
4. Let a back turn's end answer the main turn only once nothing sent still waits.
5. Take back the waiting messages on a stop of the main turn.
6. Change the cases that read a turn or a steer, and add a case for each step.

## Validation

- The new cases fail on `feb72387`'s sources and pass after.
- Every bot test file and the plugin events file pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.

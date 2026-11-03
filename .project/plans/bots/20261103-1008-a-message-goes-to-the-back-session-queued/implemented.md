---
title: A message goes to the back session queued - implemented
date: 2026-11-03
refs:
  - git://1332884b - the change
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts)"
---

The wake sends each message to its back session as a queued `chat/pendingMessageSet`, whatever the session is doing.
The message is the words with the context block, `origin: { kind: 'agent' }`, and the main chat in `_meta['vscode.chat.delegation']`.
It carries no model, agent or attachments; the main chat keeps those with the person's message.
The main turn is answered by the back turn the last message it sent becomes.
A stop of the main turn takes back the messages still waiting in the back session.

## What was built

- [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts) - `queued`, `Answering.waiting`, `taken`, and the waits in `finished` and `stopped`.
- [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts) - `turn_start` tells the wake a turn it waits on began, and `look` answers the chat and its running turn.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - a `ChatMessage` names its chat.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `turn_start` names the queued message a turn took up.
- [`code://docs/plugins/BOTS.md`](../../../../docs/plugins/BOTS.md), [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - what a message becomes, and the `turn_start` fields.

## Verified

- On `feb72387`'s sources the new and changed cases fail in the wake, context, post and chat files, and in the plugin events file.
- With the change every bot test file passes, one file at a time, and so does the plugin events file.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

- `Looked.working` went: nothing reads it once the wake sends one kind of message.

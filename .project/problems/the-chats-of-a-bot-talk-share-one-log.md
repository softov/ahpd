---
title: The chats of a bot talk share one log
status: open
date: 2026-11-13
severity: major
blocks: []
refs:
  - "[code://packages/bot/src/chat.ts#L1391](../../packages/bot/src/chat.ts#L1391) - a chat's log is named by the session, and `Start.chatId` is not read"
  - "[code://packages/webhook/src/plugin.ts#L291](../../packages/webhook/src/plugin.ts#L291) - the webhook opens a Front chat for each thread in one session"
  - git://878abb8a8 - main when the problem was read
---

## Symptom

Read from the code on 2026-11-13, and not reproduced.
Each `bot-chat` chat of one session reads and writes the same file, `logs/<session>.jsonl`.

## Cause

The `bot-chat` agent names a chat's log by `start.resume` or the session id.
It does not read `start.chatId`, which the host sends for every chat that is not the default chat.

## Impact

With the webhook option `threadSessions` off, each thread is a Front chat in one session.
After a restart, each of these chats opens with the turns of all of them.

## Workaround

Set `threadSessions` to `true` on the webhook entry.

## Fix

- Name the log of a chat that is not the default chat by its `chatId`. Keep it out of the folder that the session list reads.
- Add a case with two Front chats in one session and a restart.

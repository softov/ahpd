---
title: A bot steer shows as one turn live and as two turns after a reload
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/bot/src/chat.ts#L1112-L1125](../../packages/bot/src/chat.ts#L1112-L1125) - `steer` puts the message into the open turn and keeps it on a line of its own"
  - "[code://packages/bot/test/bot-chat.test.ts#L489](../../packages/bot/test/bot-chat.test.ts#L489) - a read back gives `hello` and `stop that` as two turns"
  - git://ca82b8af - host/20261102-1814 task 03 made a bot's steer go into the open turn
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A user sends `hello` to a bot chat, then steers it with `stop that` while the turn runs.
Live, the chat shows one turn.
After a reload, it shows `hello` with the reply, then `stop that` as a turn with no reply.

## Cause

`ca82b8af` sends the steer into the open turn, and gives the message that turn's id.
The log keeps the steer on a line of its own.
The reader of old steering lines from plugin/56 reads that line back as a turn.

## Impact

A user sees a different chat after a reload than during the turn.
plugin/56, which made a steer its own turn, is undone, and its text in the docs is stale.

## Workaround

None.

## Fix

- Read a steering line back into the turn it names.
- Or make the live steer a turn of its own again, as plugin/56 built it.

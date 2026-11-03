---
title: The bot picker lists every bot to any client
status: open
date: 2026-11-03
severity: major
blocks: []
refs:
  - "[code://packages/bot/src/chat.ts#L1294-L1302](../../packages/bot/src/chat.ts#L1294-L1302) - the `bot` completion returns `store.all()`"
  - "[code://packages/bot/src/provider.ts#L316](../../packages/bot/src/provider.ts#L316) - `mayRead`, which a `bot://` read checks"
  - git://4f38d6e2 - host/20261030-0618 added the bot picker
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
On a host with two users, a user opens the `bot` picker of a new Bot chat.
The picker lists the bots of the other user too, with their names.

## Cause

`SessionConfigAsk` names no reader, so the completion cannot call `mayRead`.
It returns every bot the store holds.

## Impact

A user sees the slugs and names of bots that the user cannot read.
Creating a chat with such a bot is not checked against `mayRead` either.

## Workaround

None.

## Fix

- Add the reader to `SessionConfigAsk`, and filter the completion with `mayRead`.
- Check `mayRead` when a Bot chat is created with a `bot` value.

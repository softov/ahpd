---
title: A bot chat sends what the protocol declares - implemented
date: 2026-10-27
refs:
  - git://288ddab7
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
---

A bot chat's tool call parts have no `id`.

## What was built

- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - the two tool call parts have no `id`.
- [`code://packages/bot/test/bot-chat.test.ts`](../../../../packages/bot/test/bot-chat.test.ts) - a turn that wakes a back session, read through the host.

## Verified

- The case fails before this change with an assertion, and passes after it.
- The bot suite passes.

## Departures from the plan

- none.

## Left for later

- none.

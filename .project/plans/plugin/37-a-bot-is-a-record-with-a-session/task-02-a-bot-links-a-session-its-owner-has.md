---
title: A bot links a session its owner has
status: todo
depends: [task-01-the-bot-plugin-serves-bot-records.md]
layer: "bot"
refs:
  - "[code://packages/sdk/src/types/sessions.ts#L100-L102](../../../../packages/sdk/src/types/sessions.ts#L100-L102) - a session's owner"
---

## Objective

A make or an edit can set `session` to a session URI.
The link is kept only when that session exists and belongs to the bot's owner.

## Files

- `UPDATE: packages/bot/src/provider.ts` - the write checks `session` against the session's owner.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the cases below.

## Steps

1. Write the tests.
2. Read the session's owner through the host, and refuse a session that is not there or has another owner.
3. An edit that sets `session` to `null` removes the link.

## Validation

- A test: the record keeps a link to a session of the bot's owner, and a read gives it back.
- A test: the plugin refuses a link to a session of another person.
- A test: the plugin refuses a link to a session that is not there.
- `npx vitest run packages/bot` passes.

## Resume


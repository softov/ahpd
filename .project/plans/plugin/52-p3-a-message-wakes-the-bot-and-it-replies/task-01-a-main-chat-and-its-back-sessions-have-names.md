---
title: A main chat and its back sessions have names
status: done
depends: []
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - `chatOf`, `chatRow` and the read road of `bot:/<slug>`"
  - "[code://packages/bot/src/record.ts](../../../../packages/bot/src/record.ts) - `isSlug`, the shape of a name"
---

## Objective

A read of `bot:/<bot>/<user>` answers the person's main chat, and a read of `bot:/<bot>/<user>/<name>` answers one back session.
A list of `bot:/<bot>/<user>/` gives the names of that person's back sessions.
The plugin keeps each name and its session URI in a `bot-sessions` collection.

## Files

- `UPDATE: packages/bot/src/provider.ts` - the read, list and resolve roads take the two deeper paths.
- `CREATE: packages/bot/src/names.ts` - the `<user>` of an owner, the parse of a path, and the `bot-sessions` rows.
- `UPDATE: packages/bot/src/plugin.ts` - give the provider the `bot-sessions` collection.
- `CREATE: packages/bot/test/bot-names.test.ts` - the tests of the names.

## Steps

1. Write `userOf(owner)`, which answers the id after `user:`, and the host's name for a reader who is nobody.
2. Answer a read of `bot:/<bot>/<user>` with `{ chat }`, the session URI that `chatOf` gives that person.
3. Refuse that read to anyone but that person, the bot's owner and root.
4. Keep each back session as a row with `bot`, `user`, `name` and `session`, keyed as `chatRow` keys a chat.
5. Answer a read of `bot:/<bot>/<user>/<name>` with `{ session }` from its row, or "not found" without one.
6. Answer a list of `bot:/<bot>/<user>/` with the names of that person's rows.
7. Export a `backSessions` seam with `get`, `put` and `list`, for task 03.
8. Keep `bot:/<bot>` as the bot's record, with no change.

## Validation

- `bot-names.test.ts`: test the main chat read and the refusal to another person.
- `bot-names.test.ts`: test a back session read, the list, and a name with no row.
- `pnpm -s exec vitest run packages/bot` passes.

---
title: One session for each bot and person
status: implemented
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/chat.ts#L1376-L1392](../../../../packages/bot/src/chat.ts#L1376-L1392) - `create`, where the grant, the refusal and the row go"
  - "[code://packages/bot/src/provider.ts#L271-L278](../../../../packages/bot/src/provider.ts#L271-L278) - `mayRead`, beside which `mayChat` comes back"
  - "[code://packages/bot/src/provider.ts#L528](../../../../packages/bot/src/provider.ts#L528) - the read, which gets `session`"
  - "[code://packages/bot/src/record.ts#L113](../../../../packages/bot/src/record.ts#L113) - the record's `session` word, which goes"
  - "[code://packages/bot/src/plugin.ts#L67-L73](../../../../packages/bot/src/plugin.ts#L67-L73) - the option defaults"
  - "[code://packages/bot/src/names.ts](../../../../packages/bot/src/names.ts) - where the rows' collection names are"
  - git://ff5093883 - `mayChat` and `bot:chat` as they were before this commit
---

## Objective

A person with `bot:chat` has one `bot-chat` session with each bot. The read of the bot answers it as `session`, and a second create is refused unless `secondSession` is `allow`.

## Files

- `UPDATE: packages/bot/src/provider.ts:271-278` - restore `mayChat` from before `ff5093883`: no reader, the bot's owner, or `bot:chat`.
- `UPDATE: packages/bot/src/provider.ts:528` - answer the reader's session as `session` on the read.
- `UPDATE: packages/bot/src/chat.ts:1376-1392` - in `create`, check `mayChat`, refuse a second session, and write the row.
- `UPDATE: packages/bot/src/record.ts:113` - remove the `session` word from the record, and drop it from a record file at load.
- `UPDATE: packages/bot/src/names.ts` - add `frontsOf(slug)`, the collection `bots/<slug>/fronts`, one row for each person.
- `UPDATE: packages/bot/src/plugin.ts:67-73` - add the option `secondSession`, `refuse` by default, and declare the grant `bot:chat`.
- `UPDATE: packages/bot/test` - the cases in *Validation*.

## Steps

1. Restore `mayChat` as it was before `ff5093883`, and declare `bot:chat` in the plugin's grants.
2. In `create`, refuse a reader that `mayChat` refuses, with the sentence a bot they may not read gets.
3. In `create`, read the creator's row in `bots/<slug>/fronts`, and check that the host still holds its session.
4. With `refuse`, throw `You already have a session with <name>: <uri>.` when that session exists.
5. Skip the check and the row for a session a plugin owns.
6. Write the row when no session exists.
7. With `allow`, write the row on every message, so it names the last used session.
8. For a person with no row, write the row for their last used `bot-chat` session with that bot. Read the bot's Front logs under `logsOf(configDir, bot.id)`, newest first. Take the first session whose `sessionOwner` is that person and that `sessionKept` still holds.
9. On a read of `bot://<slug>`, answer `session` with the reader's row when its session exists.
10. Remove the `session` word from the record, and drop it without an error from a record file that has it.
11. Add `secondSession` to the defaults, and read it beside `askIn`.

## Validation

- A test creates two sessions for Luiz with Ello, and the bot refuses the second, naming the first.
- A test with `secondSession: allow` creates two, and the read answers the one Luiz used last.
- A test reads `bot://ello` as Luiz, and `session` is his session; as the owner with none, `session` is absent.
- A test gives Maria `bot:get` only, and the bot refuses her create; with `bot:chat` it opens.
- A test creates two sessions that a plugin owns, and the bot refuses neither.
- A test loads a record file with `session: work`, and the bot loads without it.
- `pnpm typecheck` passes, and `pnpm vitest run packages/bot` passes.

## Resume

- Built on 2026-11-13. The Front rows and the one-talk rule are in `packages/bot/src/talks.ts`, and the check is in the `create` of `chat.ts`, which is now async.
- A reader whose principal names a `plugin` is a plugin's session, such as the webhook's: no `bot:chat`, no row and no refusal.
- A body may still carry `session`, as a read answers it: the field is accepted and not kept.
- Cases: `bot-provider.test.ts` (one talk, `allow`, `bot:chat`), `bot-record.test.ts` and the dropped word of an older file.
- The host now gives a backend the session's owner as `Start.owner`. A talk is kept by `talkerOf` of that owner. Every `root:<host>` owner, and no owner, is `root`, so the root has one talk on any machine.
- A start with `resume` is never refused, and it writes no row over the row that is there.


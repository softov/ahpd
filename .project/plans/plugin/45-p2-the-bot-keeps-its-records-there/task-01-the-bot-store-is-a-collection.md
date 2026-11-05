---
title: The bot store is a collection
status: done
depends: []
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/store.ts#L83-L128](../../../../packages/bot/src/store.ts#L83-L128) - `botStore`"
  - "[code://packages/bot/src/plugin.ts#L37-L50](../../../../packages/bot/src/plugin.ts#L37-L50) - `apply`"
---

## Objective

`botStore` keeps bots in the `bots` collection and tombstones in `bots-gone`, with a cache that the provider reads.

## Files

- `UPDATE: packages/bot/src/store.ts` - `botStore(bots, graves, onProblem)` over two collections, with no file code.
- `UPDATE: packages/bot/src/plugin.ts:37` - open the two collections with `host.records`.
- `UPDATE: packages/bot/src/provider.ts` - wait for the store before the first answer, and wait for `put` and `remove`.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - give `memoryRecords` collections.
- `CREATE: packages/bot/test/bot-store.test.ts` - cases for the cache and the tombstones.

## Steps

1. Open `bots` with `{ body: 'instructions' }`, and `bots-gone` with no body.
2. Add `ready()` to `BotStore`, and load both collections into the cache there once.
3. Pass each loaded record through `kept`, and report each one that fails.
4. Make `put` and `remove` answer promises, and change the cache after the collection answers.
5. On `remove`, put `{ id, deletedAt }` in `bots-gone`, then remove the bot.
6. Await `ready()` at the start of each provider call.
7. Remove `written`, `slugsIn` and every `node:fs` import from `store.ts`. The plugin keeps `mkdirSync` in `provider.ts`, which makes a bot's workspace folder and not a record.

## Validation

- `bot-store.test.ts` puts, reads, removes and makes a bot again, and the re-make fails with `-32010`.
- The provider tests pass over `memoryRecords`.
- `rg -n "node:fs" packages/bot/src/store.ts` finds nothing.
- `pnpm exec vitest run packages/bot` and `pnpm -s typecheck` pass.

## Resume

Done. `botStore(bots, graves, onProblem)` holds the cache, `ready()` loads both collections once, and `kept` screens every loaded record. `plugin.ts` opens `bots` with `{ body: 'instructions' }` and `bots-gone` with no body. Every provider entry point awaits `ready()` first, and `put` and `remove` are awaited. `store.ts` has no file code left.

Two things the plan did not know:

- The catalogue had to wait for the store too. `packages/bot/src/catalogue.ts` answers a subscribe from `store.all()`. The store loads on the first read, so a subscribe before the first read answers nothing. Nothing would correct that snapshot, because no publish names a bot that was there all along. `authorize` and `snapshot` now await `ready()`. Removing those awaits makes the new case "answers a subscribe that arrives before any bot has been read" fail, so the fix is load-bearing.
- The record store goes to `pluginHost` as the plugin connector's `records`, not only to `HostOptions.records`. With only the latter, every provider test failed with `records bots cannot be read: this host has no record store`.

The `node:fs` import in `provider.ts` stays, by the *Decisions locked in* row on a bot's workspace folder. `mkdirSync` there makes a bot's workspace folder, not a record. The test "runs a bot in its own folder, and makes the folder first" asserts the folder exists.

Files this task changed, so the work can be committed on its own:

- `packages/bot/src/store.ts`
- `packages/bot/src/plugin.ts`
- `packages/bot/src/provider.ts`
- `packages/bot/src/catalogue.ts`
- `packages/bot/test/bot-provider.test.ts`
- `packages/bot/test/bot-catalogue.test.ts`
- `packages/bot/test/bot-store.test.ts` (new)
- `.project/plans/plugin/45-p2-the-bot-keeps-its-records-there/plan.md`
- `.project/plans/plugin/45-p2-the-bot-keeps-its-records-there/task-01-the-bot-store-is-a-collection.md`
- `.project/plans/index.md`

Gates at this state: `pnpm -s typecheck` and `pnpm -s boundary` pass, and `pnpm exec vitest run packages/bot` passes 70 tests in 4 files.

---
title: A bot edited by hand reaches the provider
status: done
depends: [task-01-the-bot-store-is-a-collection.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - `told`, which plan 43 adds"
---

## Objective

A change to the `bots` collection that the store did not make updates the cache and reaches watchers.

## Files

- `UPDATE: packages/bot/src/store.ts` - watch `bots`, and an `onChange` the provider gives.
- `UPDATE: packages/bot/src/provider.ts` - call `told` from `onChange`.
- `UPDATE: packages/bot/test/bot-store.test.ts` - cases for a change from outside.

## Steps

1. Watch the `bots` collection when the store loads.
2. On `added` or `updated`, read the record, pass it through `kept`, and replace the cache entry.
3. Refuse a change to `owner` or `workspace`, report it, and keep the old record.
4. On `deleted`, remove the cache entry and put a tombstone in `bots-gone`.
5. Call `onChange` with the slug and the change type after each cache change.
6. Give `onChange` from the provider, and call `told` there.

## Validation

- `bot-store.test.ts` changes a record in the collection from outside, and a `bot://` watcher hears `updated`.
- The store reports a change to `owner` from outside, and the bot keeps its owner.
- The store reports a record that fails `kept`, and the bot reads as before.
- `pnpm exec vitest run packages/bot` passes.

## Resume

Done. The store watches `bots` as it loads, and takes each change it did not make once the collection has it. A record goes through `kept`. An edit to `owner` or `workspace` is refused with a problem line, and a write that moved nothing is dropped. A delete is buried. `BotStore.onChange` is the ear, and the provider gives one that calls `told` and the catalogue.

Two things the plan did not spell out:

- The store's own writes come back to it. A collection tells its watchers about a put or a remove whoever made it, the store's own included. At that moment the cache has not moved yet, so the echo is dropped by a set of the slugs the store is writing. Without that guard, the case "says a write made through the scheme once, and not again for the store" sees `added motion` twice.
- `onChange` carries the bot, and for an edit the record it was, rather than a slug and a type alone. `told` builds the URI from the bot and decides who may hear it. A delete is told with the record as it was, so that record cannot be dropped. The catalogue needs `before` too, or an edit reaches a client as `added` and it is sent a bot it already holds.

Files this task changed, so the work can be committed on its own:

- `packages/bot/src/store.ts`
- `packages/bot/src/provider.ts`
- `packages/bot/test/bot-store.test.ts`
- `.project/plans/plugin/45-p2-the-bot-keeps-its-records-there/plan.md`
- `.project/plans/plugin/45-p2-the-bot-keeps-its-records-there/task-02-a-hand-edit-reaches-the-provider.md`

Gates at this state: `pnpm -s typecheck` and `pnpm -s boundary` pass, and `pnpm exec vitest run packages/bot` passes 77 tests in 4 files.

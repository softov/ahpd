---
title: The bot keeps its records in the record store
domain: plugin
status: built
priority: medium
created: 2026-10-11
revalidated: 2026-10-11
requires:
  - plans/plugin/43-a-bot-can-be-watched/plan.md
  - plans/plugin/45-p1-the-host-gives-a-record-store/plan.md
decisions:
  - decisions/a-bot-record-stays-in-config.md
refs:
  - "[code://packages/bot/src/store.ts#L83-L128](../../../../packages/bot/src/store.ts#L83-L128) - `botStore`, which reads `<slug>.json` once and writes it whole"
  - "[code://packages/bot/src/store.ts#L50-L62](../../../../packages/bot/src/store.ts#L50-L62) - `kept`, the check every record read passes"
  - "[code://packages/bot/src/plugin.ts#L37-L50](../../../../packages/bot/src/plugin.ts#L37-L50) - where the plugin opens its store"
  - "[code://packages/bot/src/provider.ts#L365-L455](../../../../packages/bot/src/provider.ts#L365-L455) - `write` and `remove`, the two calls that change a bot"
---

## Goal

The bot plugin keeps its bots in the `bots` collection, with `instructions` as the body.
It keeps each deleted slug in the `bots-gone` collection.
A bot edited by hand reaches watchers and the catalogue as any other change.
The bot plugin has no record file code left: it keeps `mkdirSync` for a bot's workspace folder, which is not a record.

## Reconnaissance

### Searches performed

- `rg -n "store\.(all|get|gone|put|remove)" packages/bot/src/provider.ts` - ten calls; `all`, `get` and `gone` read, `put` and `remove` write.
- `rg -n "node:fs" packages/bot/src` - only `store.ts` reads or writes files.
- `ls ~/.config/ahpd/bots ~/.config/ahpd/bots-gone` - three records as `.json`, which p1 converts.

### Runtime path

```
first provider call -> botStore loads bots and bots-gone into a cache -> kept
botProvider.write -> botStore.put -> collection put -> told
a person edits bots/<slug>.md -> collection watch -> botStore reloads one -> kept -> told
```

### Gaps

- `BotStore` writes files itself.
- The store has no way to tell the provider about a change it did not make.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A plugin keeps its records in a record store the host gives it](../45-p1-the-host-gives-a-record-store/plan.md) | Softov, 2026-10-11 |
| 2 | [A bot record stays in the configuration folder, apart from its workspace](../../../decisions/a-bot-record-stays-in-config.md) | Softov, 2026-10-10 |
| 3 | [The daemon reloads a bot or an automation file that a person edits](../../../../docs/plugins/BOTS.md) | Softov, 2026-10-10 |

| What | Source | Task |
| --- | --- | --- |
| `BotStore` keeps a cache, so `all`, `get` and `gone` stay synchronous | the provider reads ten times and writes twice | 01 |
| The cache loads on the first provider call, after the fold | p1, a collection waits for the fold | 01 |
| A tombstone is a record `{ id, deletedAt }` in `bots-gone` | the tombstone is a record too | 01 |
| The bot plugin keeps `mkdirSync(record.workspace)`, which makes a bot's workspace folder and not a record, so "no file code left" means no *record* file code | Softov, 2026-10-11, to "Who creates a bot's workspace folder once the bot store has no file code?" | 01 |
| A hand edit that changes `owner` or `workspace` is refused, and the store keeps the old record | an edit through the scheme may not change either | 02 |
| A hand edit that fails `kept` is reported, and the store keeps the old record | decision 3 | 02 |

## Proposed architecture

- **Data flow** - the store passes each record from the collection through `kept`, and puts the record whole.
- **Event flow** - the collection's watch calls the store, the store calls an `onChange` the provider gives it, and the provider calls `told`.
- **State flow** - the cache is a copy of the collection that the watch keeps current.
- **Layer responsibilities** - `packages/bot` store: the cache, `kept`, the tombstones · `packages/bot` provider: notices to watchers and the catalogue.
- **Source-of-truth files** - [`code://packages/bot/src/store.ts`](../../../../packages/bot/src/store.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The bot store is a collection](task-01-the-bot-store-is-a-collection.md) | done | - |
| [02 - A bot edited by hand reaches the provider](task-02-a-hand-edit-reaches-the-provider.md) | done | 01 |
| [03 - The docs describe the bot file](task-03-the-docs-describe-the-bot-file.md) | done | 02 |

## Risks and tradeoffs

- A write can fail after the cache changed - the store changes the cache only after the collection answers.
- The provider tests make bots through the store - they give a `memoryRecords` collection in place of a folder.
- Plan 44's catalogue publishes on `told` - a hand edit reaches the catalogue with no change there.

## Resume state

- **Done so far:** all three tasks are done, committed as `6d951a8` and `cd1fbb9`, and released in 0.11.0. Softov checked it by hand on 2026-11-04. See [implemented.md](implemented.md).
- **Next action:** none. The owner of a bot edited by hand stays an open problem: [a-bot-file-edited-by-hand-to-a-new-owner-takes-it-after-a-restart.md](../../../problems/a-bot-file-edited-by-hand-to-a-new-owner-takes-it-after-a-restart.md).

## Final verification checklist

- [x] `pnpm -s typecheck` and `pnpm -s boundary` pass.
- [x] `pnpm exec vitest run packages/bot` passes.
- [x] `rg -n "node:fs" packages/bot/src/store.ts` finds nothing. The only `node:fs` left in `packages/bot/src` is `mkdirSync` in `provider.ts`, which makes a bot's workspace folder, which *Decisions locked in* keeps.
- [x] A copy of `~/.config/ahpd/bots` converts, and each bot reads the same before and after.
- [x] `plans/index.md` updated.

---
title: A load removes only the data of a deleted bot
status: todo
depends: [task-05-a-bots-data-is-one-folder.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/plugin.ts#L163-L206](../../../../packages/bot/src/plugin.ts#L163-L206) - `moveData` reads every `*.md` name in `bots-gone/` as a slug and removes its folder"
  - "[code://packages/bot/src/store.ts#L177-L218](../../../../packages/bot/src/store.ts#L177-L218) - `take`, which buries a hand delete and adds a returned file without a check on `dead`"
  - "[code://packages/server/src/records.ts#L104-L107](../../../../packages/server/src/records.ts#L104-L107) - the record collection ignores a name that is not a slug"
---

## Objective

A load removes a folder only for a tombstone whose name is a slug, and never a folder that still holds `bot.md`.
A bot file that comes back after its tombstone is refused, and a problem line says that its name is spent.

## Files

- `UPDATE: packages/bot/src/plugin.ts:163-206` - check each tombstone name with `isSlug`, and keep a folder that holds `bot.md`.
- `UPDATE: packages/bot/src/store.ts:177-218` - refuse an added or updated record whose slug is in `dead`.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the tombstone names and the kept folder, at a load.
- `UPDATE: packages/bot/test/bot-store.test.ts` - a returned file after a hand delete.

## Steps

1. In `moveData`, keep only the tombstone names that pass `isSlug`.
2. Report each other `*.md` name in `bots-gone/` with `onProblem`, and leave the file.
3. Before the removal, check for `bots/<slug>/bot.md`.
4. If `bot.md` exists, keep the folder, and report the spent name and the kept folder.
5. In `take`, refuse an `added` or `updated` change whose slug is in `dead`.
6. Report the refusal with `onProblem`, with the slug and the words "the name is spent".
7. Add a test for each tombstone name `..md`, `...md` and `Foo.md`.
8. Add a test for a folder with `bot.md` and a tombstone, which the load keeps.
9. Add a test for a hand delete, then the same file put back, then a new load.
10. Add tests for steps 12 and 13 of task 05, which have none.

## Validation

- `packages/bot/test/bot-provider.test.ts`: `bots-gone/..md` and `bots-gone/...md` remove nothing and give a problem line.
- `packages/bot/test/bot-provider.test.ts`: a tombstoned folder with `bot.md` stays, with a problem line.
- `packages/bot/test/bot-store.test.ts`: a returned file is not a live bot, and the next load keeps its folder.
- Run `pnpm --filter @ahpd/bot test` alone. Expect a pass.

## Resume


---
title: A load removes only the data of a deleted bot
status: done
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

- **Done so far:** all steps. A load reads each tombstone name in `bots-gone/` through `isSlug` and reports a name that is no bot's. It removes only what a slug tombstone names. A folder that still holds `bot.md` is kept and reported as a spent name. Its record is left out of the store at the load.
- **Built as:** `moveData` builds `dead` from the tombstone files one at a time. A non-slug name is reported and skipped rather than becoming a folder to remove. The removal loop checks `bots/<slug>/bot.md` before the folder, and reports the kept folder and the spent name. It removes the bare `<slug>.md` whether the folder stays or goes.
- **Built as:** both roads into the store check `dead`. `take` refuses an `added` or `updated` change whose id has a tombstone before it reads the record. `load` reads the tombstones before the bots, and leaves out each one that is spent. Both report `bots/<slug> has a tombstone; the name is spent and it was left out`.
- **Tests:** `bot-provider.test.ts` gains four cases. `..md`, `...md`, `Foo.md` and a kept `templates/kept.md` survive with a problem line each. A tombstoned folder with `bot.md` stays, with the folder and the spent name reported. The older collections of a deleted bot are removed, and a file the move cannot place stays. `bot-store.test.ts` gains the hand-delete, put-back and new-load case.
- **Fixtures:** a tombstone in a test is written with frontmatter, through the `tombstone` helper. A bare `gone` file is a tombstone the record store cannot read, so the store never learns the slug.
- **Changed files:** `packages/bot/src/plugin.ts`, `packages/bot/src/store.ts`, `packages/bot/test/bot-provider.test.ts`, `packages/bot/test/bot-store.test.ts`.
- **Gates:** `pnpm -s schema`, `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm -s boundary` pass; `pnpm --filter @ahpd/bot test` ran 15 files and 206 tests, all passed.
- **Left dirty by the suite:** `packages/sdk/test/fixtures/wire.jsonl`. It is not part of the commit.


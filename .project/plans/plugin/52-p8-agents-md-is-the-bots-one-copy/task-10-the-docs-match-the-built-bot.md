---
title: The docs match the built bot
status: done
depends: [task-04-the-docs-say-where-the-persona-is.md, task-07-a-load-removes-only-dead-bots.md, task-08-the-persona-is-never-dropped.md, task-09-agents-md-text-survives-a-write.md]
layer: "docs"
refs:
  - "[code://docs/plugins/BOTS.md#L36](../../../../docs/plugins/BOTS.md#L36) - says the host writes nothing below the parts, which is false for a computer bot and a store with no YAML"
  - "[code://docs/plugins/BOTS.md#L111](../../../../docs/plugins/BOTS.md#L111) - describes a computer bot's offline edit, which is not built"
---

## Objective

`docs/plugins/BOTS.md` says what the code does today, and the plan's refs point at the current lines.

## Files

- `UPDATE: docs/plugins/BOTS.md` - lines 36 and 111, and the sections tasks 07 to 09 change.
- `UPDATE: .project/plans/plugin/52-p8-agents-md-is-the-bots-one-copy/plan.md` - the out-of-date refs.
- `UPDATE: .project/plans/plugin/52-p8-agents-md-is-the-bots-one-copy/task-05-a-bots-data-is-one-folder.md` - the out-of-date refs.

## Steps

1. Say at line 36 that a computer bot and a store with no YAML keep the persona in the record.
2. Say at line 111 that a computer bot keeps its persona in its record.
3. Say there that an offline edit does not wait yet.
4. Link the deferred machine task from that paragraph.
5. Add the spent name, the kept folder and the refused `## ` line from tasks 07 to 09.
6. Correct the plan refs to `record.ts`, `plugin.ts` and `template.ts`.
7. Correct the task 05 refs to `plugins.ts`, `provider.ts`, `names.ts` and `chat.ts`.

## Validation

- `packages/bot/test/bot-docs.test.ts` passes, with `pnpm --filter @ahpd/bot test` alone.
- Read `BOTS.md` against the code by hand, and write the result in *Resume*.

## Resume

- **Done so far:** all steps.
- **Built as:** the record file section says a bot on a computer keeps the persona in the record. So does every bot of a store with no YAML: `name` and `description` are in the frontmatter, and `instructions` below it. The record section above says the same for those bots.
- **Built as:** the computer paragraph says the host neither reads nor writes that bot's `AGENTS.md` yet, and that an offline edit does not wait. It links [A bot runs in a machine, task 04](../../bots/20261028-0545-a-bot-runs-in-a-machine/task-04-an-edit-to-a-bot-on-a-machine-waits.md).
- **Built as:** the record file section says the move keeps a tombstoned folder that still holds `bot.md`, and reports it. It says a file's Instructions section wins over the record's copy. It says an unreadable file leaves the persona in the record.
- **Built as:** the persona section refuses instructions with a line that starts with `## `. It says a make over an existing file writes the parts into it. The bot's rules say a wake never writes over a file that is there.
- **Built as:** the slug section says a record that comes back after its delete is left out and reported, and its folder kept. The `root` option says a root inside the configuration folder is refused at load.
- **Built as:** the plan refs point at `record.ts#L75-L90`, `plugin.ts#L424` and `template.ts#L134-L141`. The task 05 refs point at `plugins.ts#L1367-L1395`, `provider.ts#L118-L123`, `names.ts#L30-L38` and `chat.ts#L216-L231`.
- **Hand read:** `store.put` keeps the parts for a bot with `computer` and for a store with no YAML. `recordFile` writes the collection's body field below the frontmatter, which is why `instructions` is described there. `moveData` keeps a dead slug's folder when it holds `bot.md`, and removes it otherwise. `store.move` leaves an unreadable file alone and keeps a file's Instructions section. `instructionsProblem` and the provider's write refuse a `## ` line before anything is written. `apply` refuses a `root` under the config folder and falls back to `~/.bots`. `wake` skips the folder of a computer bot. Every sentence added matches one of those.
- **Departure:** the `root` option line and the make-over-an-existing-file clause are not among the three additions of step 5. They are behavior tasks 08 and 09 built, and the task's Files note covers the sections those tasks change.
- **Departure:** the task file's `depends` now names 04, 07, 08 and 09, which is what the plan's table said and what the page now describes.
- **Tests:** `pnpm --filter @ahpd/bot test` ran 15 files and 218 tests, all passed, `bot-docs.test.ts` among them.
- **Changed files:** `docs/plugins/BOTS.md`, `plan.md`, `task-05-a-bots-data-is-one-folder.md`, `task-10-the-docs-match-the-built-bot.md`.
- **Gates:** `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit` and `pnpm -s boundary` pass.
- **Left dirty by the suite:** nothing. `git status` showed only the four files this task changed, so `packages/sdk/test/fixtures/wire.jsonl` was left clean.

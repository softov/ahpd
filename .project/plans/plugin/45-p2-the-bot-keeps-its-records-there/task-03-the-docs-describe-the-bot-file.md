---
title: The docs describe the bot file
status: done
depends: [task-02-a-hand-edit-reaches-the-provider.md]
layer: "docs"
refs:
  - "[code://docs/plugins/BOTS.md](../../../../docs/plugins/BOTS.md) - the bot guide"
  - "[code://packages/bot/README.md](../../../../packages/bot/README.md) - the package page"
---

## Objective

`docs/plugins/BOTS.md` shows a bot file, and says that an edit applies while the daemon runs.

## Files

- `UPDATE: docs/plugins/BOTS.md` - the file, the conversion from `.json`, and the rules for a hand edit.
- `UPDATE: packages/bot/README.md` - the bot is kept in the record store.

## Steps

1. Show one bot file with its frontmatter and its instructions.
2. Say that a `.json` record converts at start.
3. List what a hand edit may not change.
4. Say that a sqlite or postgresql plugin can keep the bots in place of the files.

## Validation

- `rg -n "\.json" docs/plugins/BOTS.md packages/bot/README.md` finds the conversion, and one mention of the daemon's `config.json`, which is not a bot record.
- The sample file reads as a bot through `readRecordFile`, which `packages/bot/test/bot-docs.test.ts` checks.

## Resume

Done. `docs/plugins/BOTS.md` has a new section, `## The file`, between the record and the slug. It shows one bot file with its frontmatter and its instructions. It says that a `<slug>.json` record converts when the daemon starts. It lists the two fields a hand edit may not change, and what a file that is not a bot earns. The options section names the file per bot, and says a store taken over keeps the records wherever it keeps them. The README says a bot is a record of the host's record store, and the daemon writes each one as a file. A `registerRecords` plugin - a sqlite or a postgresql store - keeps the bots there instead.

Two things the plan did not know:

- The validation `rg -n "\.json" docs/plugins/BOTS.md packages/bot/README.md` cannot find the conversion alone. The README's commands table names the daemon's own configuration file, `config.json`, which is not a bot record and stays. The item is narrowed to the conversion plus that one mention.
- The sample is checked rather than read by eye. `packages/bot/test/bot-docs.test.ts` takes the fenced block out of the new section. It reads that block with `readRecordFile(text, 'instructions')` and puts it through a store, so a sample that is not a bot fails a test. The task named no test file; the validation asks for the same check by hand. Changing the sample's colour to one that is not a colour makes the test fail, so it is load-bearing.

Files this task changed, so the work can be committed on its own:

- `docs/plugins/BOTS.md`
- `packages/bot/README.md`
- `packages/bot/test/bot-docs.test.ts` (new)
- `.project/plans/plugin/45-p2-the-bot-keeps-its-records-there/plan.md`
- `.project/plans/plugin/45-p2-the-bot-keeps-its-records-there/task-03-the-docs-describe-the-bot-file.md`

Gates at this state: `pnpm -s typecheck` and `pnpm -s boundary` pass, and `pnpm exec vitest run packages/bot` passes 78 tests in 5 files.

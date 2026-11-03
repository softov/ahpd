---
title: The docs match the built bot
status: todo
depends: [task-04-the-docs-say-where-the-persona-is.md]
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


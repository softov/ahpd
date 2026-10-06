---
title: The team and project verbs declare their own flags
status: implemented
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L529-L537](../../../../packages/server/src/commands/options.ts#L529-L537) - `teamFields`"
  - "[code://packages/server/src/commands/teams.ts#L43-L90](../../../../packages/server/src/commands/teams.ts#L43-L90) - the verbs"
---

## Objective

`team` and `project` `list` and `rm` take where the file is and their own fields only, and `--title` is `add`'s.

## Files

- `UPDATE: packages/server/src/commands/options.ts:529-537` - a location set and `title` apart; the served set the same.
- `UPDATE: packages/server/src/commands/teams.ts` - each verb spreads what it reads.

## Steps

1. Read each verb's `run` and declare exactly what it reads.

## Validation

- Written first and seen failing: `team rm` refuses `--title`, naming it; the served manifest's `project.rm` input is `id` alone; `team add` still takes `--title`.

---
title: A start in an unserved folder asks to trust it, and `--no-cwd`
status: done
depends: [task-01-a-question-with-its-default.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L406](../../../../packages/server/src/commands/options.ts#L406) - the current folder when `paths` is empty"
  - "[code://packages/server/src/commands/start.ts#L182-L191](../../../../packages/server/src/commands/start.ts#L182-L191) - the argv `start` forwards"
---

## Objective

As the decision says: at a terminal, a folder not under `paths` is asked about and added on yes; `--no-cwd` serves only `paths` and asks nothing, refusing when `paths` is empty.

## Files

- `UPDATE: packages/server/src/commands/options.ts` - the `--no-cwd` field and the empty-`paths` rule.
- `UPDATE: packages/server/src/commands/run.ts` and `start.ts` - the question, asked by the parent.
- `UPDATE:` the options, run and start tests.

## Steps

1. Tests first: a TTY in an unserved folder asks, yes writes `paths`, no starts without it; a folder under a served one is not asked; `--no-cwd` asks nothing and with no `paths` refuses; a non-TTY never asks.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

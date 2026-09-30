---
title: A start with no configuration offers configure
status: todo
depends: [task-02-ahpd-configure.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L398-L406](../../../../packages/server/src/commands/run.ts#L398-L406) - today's refusal"
---

## Objective

`ahpd` or `ahpd start` at a terminal with no `config.json` asks "No configuration. Run ahpd configure now?"; yes runs it and then starts; no, or no terminal, refuses as today.

## Files

- `UPDATE: packages/server/src/commands/run.ts` and `packages/server/src/commands/start.ts` - the offer, in the parent before any spawn.
- `UPDATE:` the run and start tests.

## Steps

1. Tests first: a TTY with no config offers and starts after yes; no refuses with today's text; a non-TTY never asks.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

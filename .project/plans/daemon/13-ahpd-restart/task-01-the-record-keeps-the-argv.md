---
title: The record keeps the argv
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/daemon.ts#L8-L24](../../../../packages/server/src/daemon.ts#L8-L24) - `Running`"
  - "[code://packages/server/src/commands/start.ts#L182-L191](../../../../packages/server/src/commands/start.ts#L182-L191) - the forwarded argv"
---

## Objective

`Running` has `argv`, the arguments the child was spawned with, written by `ahpd start`; a record without it, from an older daemon, is read as it is.

## Files

- `UPDATE: packages/server/src/daemon.ts`, `packages/server/src/commands/start.ts`.
- `UPDATE:` the daemon record tests.

## Steps

1. Tests first: a start with `--path /x --plugin-option a.b=1` records both; an old record without `argv` still reads.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

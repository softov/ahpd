---
title: sessions.json migrates once
status: todo
depends: [task-01-a-file-per-session.md]
layer: "server"
refs:
  - "[code://packages/server/src/config.ts#L185](../../../../packages/server/src/config.ts#L185) - `sessions.json`"
  - "[code://packages/sdk/src/sessions.ts#L76-L86](../../../../packages/sdk/src/sessions.ts#L76-L86) - the old shape"
---

## Objective

A daemon that finds `sessions.json` and no `sessions/` splits every row into a file, then renames the old file `sessions.json.migrated`; a row's values are carried as they are, old string config included.

## Files

- `UPDATE: packages/server/src/commands/run.ts` or where the store is built - the migration before the store opens.
- `UPDATE:` the server tests.

## Steps

1. Tests first: a 3-row `sessions.json` becomes three files and a `.migrated` file; a second start does nothing; a bad `sessions.json` is left as it is and a warning names it.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

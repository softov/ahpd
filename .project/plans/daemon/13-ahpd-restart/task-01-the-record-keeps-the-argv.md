---
title: The record keeps the argv
status: implemented
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/daemon.ts#L9-L30](../../../../packages/server/src/daemon.ts#L9-L30) - `Running`"
  - "[code://packages/server/src/commands/start.ts#L47-L75](../../../../packages/server/src/commands/start.ts#L47-L75) - the forwarded argv"
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

- `Running` has `argv?: string[]`, and `recordOf` takes it as a fourth argument; `start` in `daemon.ts` writes the line it spawned the child with, which is the forwarded line `ahpd start` already built, so `commands/start.ts` needed no change.
- Tests: `daemon.test.ts` "keeps the arguments the child was given" and "reads a record an older daemon wrote, which has no argv"; `server-cli.test.ts` "records the line the child was given, and not the parent's globals" (a real `start` with `--no-color` before it, killed after).
- Failed first: the `recordOf` case and the real `start` case (`argv` undefined); the older-record case passed before the change, since reading a record never checked fields beyond `pid`.
- Not known to the plan: `--plugin-option` does not exist until daemon/12 task 02, so the `start` case records `--path` and `--plugin` instead; the `recordOf` case holds the `--plugin-option` line as data.

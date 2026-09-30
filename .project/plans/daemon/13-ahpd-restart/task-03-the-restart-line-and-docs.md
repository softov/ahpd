---
title: The restart line names `ahpd restart`, and the docs say it
status: todo
depends: [task-02-ahpd-restart.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L131-L133](../../../../packages/server/src/commands/plugin.ts#L131-L133) - the restart line"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - start and stop"
---

## Objective

Every "restart the daemon" line says `ahpd restart`, and `docs/DAEMON.md` documents it beside `start` and `stop`.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts` and its tests.
- `UPDATE: docs/DAEMON.md`.

## Steps

1. Change the line and its tests, then write the docs, short and direct, no hard wrap.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

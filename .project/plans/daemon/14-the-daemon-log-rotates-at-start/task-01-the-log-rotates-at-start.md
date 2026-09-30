---
title: The log rotates at start
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/daemon.ts#L138-L155](../../../../packages/server/src/daemon.ts#L138-L155) - the log opened before the spawn"
---

## Objective

Before `daemon.log` is opened, a file over 5 MB is renamed `daemon.log.1`, replacing any previous one.

## Files

- `UPDATE: packages/server/src/daemon.ts` - the rotation before `openSync`.
- `UPDATE:` the daemon tests.

## Steps

1. Tests first in a temp directory: a large log is moved and a new one started; a small log is appended as today; an old `.1` is replaced.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

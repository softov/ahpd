---
title: A start regression leaves no daemon running, and the token case can fail
status: todo
depends: [task-18-start-forwards-its-options-wherever-they-are-typed.md]
layer: "server"
refs:
  - "[code://packages/server/test/server-cli.test.ts#L369-L410](../../../../packages/server/test/server-cli.test.ts#L369-L410) - the task 18 cases and their `afterEach`, which kills only `record.pid`"
  - "[code://packages/server/src/daemon.ts#L192](../../../../packages/server/src/daemon.ts#L192) - the record names `child.pid`, the process `start` spawned"
---

## Objective

When the `start` cases fail the way they exist to catch, no daemon is left running, and the connection-token case fails if the child serves without the token.

## Files

- `UPDATE: packages/server/test/server-cli.test.ts:369-410` - the cleanup and the token case.

## Steps

1. The cleanup after each `start` case kills every pid the case's `daemon.log` names in its `(pid N)` announcement lines, as well as `record.pid`, and ignores a pid already gone.
2. The token case also knocks without the token and expects the connection refused, since a loopback daemon with no token accepts any knock.

## Validation

- With `start.ts` put back to slicing `argv` after the first `start`, the `--path start start` case fails and, after the run, no `ahpd` process started by it is alive (`pgrep -f` on the case's `XDG_CONFIG_HOME`). Put it back.
- With the child made to drop `--connection-token`, the token case fails on the knock without a token. Put it back.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

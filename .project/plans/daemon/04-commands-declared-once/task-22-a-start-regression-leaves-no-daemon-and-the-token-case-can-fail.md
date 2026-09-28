---
title: A start regression leaves no daemon running, and the token case can fail
status: done
depends: [task-18-start-forwards-its-options-wherever-they-are-typed.md]
layer: "server"
refs:
  - "[code://packages/server/test/server-cli.test.ts#L55-L76](../../../../packages/server/test/server-cli.test.ts#L55-L76) - the `afterEach`, and `announced`, the pids the daemon log names"
  - "[code://packages/server/test/server-cli.test.ts#L405-L451](../../../../packages/server/test/server-cli.test.ts#L405-L451) - the task 18 cases, the token case with its knock without the token"
  - "[code://packages/server/src/daemon.ts#L192](../../../../packages/server/src/daemon.ts#L192) - the record names `child.pid`, the process `start` spawned"
---

## Objective

When the `start` cases fail the way they exist to catch, no daemon is left running, and the connection-token case fails if the child serves without the token.

## Files

- `UPDATE: packages/server/test/server-cli.test.ts:55-76, 405-451` - the cleanup and the token case.

## Steps

1. The cleanup after each `start` case kills every pid the case's `daemon.log` names in its `(pid N)` announcement lines, as well as `record.pid`, and ignores a pid already gone.
2. The token case also knocks without the token and expects the connection refused, since a loopback daemon with no token accepts any knock.

## Validation

- With `start.ts` put back to slicing `argv` after the first `start`, the `--path start start` case fails and, after the run, no `ahpd` process started by it is alive (`pgrep -f` on the case's `XDG_CONFIG_HOME`). Put it back.
- With the child made to drop `--connection-token`, the token case fails on the knock without a token. Put it back.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Implemented 2026-09-26. The `afterEach` kills the `(pid N)` pids the case's `daemon.log` names as well as those the cases pushed, ignoring a pid already gone, and the token case knocks on `record.url` without the token and expects anything but `open`.

- With `start.ts` put back to `argv.slice(argv.indexOf('start') + 1)`, the `--path start start` case failed 12 runs of 12 on two `ahpd on ws://` lines. After 11 of those runs no process with an `ahpd-cli-` `XDG_CONFIG_HOME` was alive (read from `/proc/*/environ`, since the home is in the environment and not on the command line). After the first run one was: the foreground grandchild (`main.ts --port 0 --plugin ... --no-update-check`), which I killed by hand; I did not find why the cleanup missed it that once, and it did not recur. Put back.
- With `daemon.ts` made to drop `--connection-token` and its value from the child's line, the token case failed first on the existing `no token: loopback only` log assertion; with that assertion commented out it failed on the new knock (`expected 'open' not to be 'open'`). Put back.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts`: 44 passed.

---
title: The pinning tests bind a port and start a daemon
status: done
depends: [task-05-start-forwards-the-words-after-start.md]
layer: "server"
refs:
  - "[code://packages/server/test/server-cli.test.ts#L135-L171](../../../../packages/server/test/server-cli.test.ts#L135-L171) - `foreground`, which starts the daemon on a socket and reads the announcement"
  - "[code://packages/server/test/server-cli.test.ts#L486-L517](../../../../packages/server/test/server-cli.test.ts#L486-L517) - the two bind cases and the `start`/`status`/`stop` round trip"
  - "[code://packages/server/src/commands/run.ts#L520-L521](../../../../packages/server/src/commands/run.ts#L520-L521) - the announcement the cases read the host and port off"
---

## Objective

`--port`, `--host` and `start` each have a case that fails if the flag is dropped or the verb breaks.

## Files

- `UPDATE: packages/server/test/server-cli.test.ts` - a foreground case on a socket, and a `start`/`status`/`stop` round trip.

## Steps

1. A helper that runs the foreground daemon without `--stdio`, waits for the `ahpd on ws://` line on stdout, and kills it; the case passes `--port 0 --host 127.0.0.1 --plugin BACKEND --no-update-check` and asserts the line names `127.0.0.1` and a port other than `9187`.
2. A second foreground case with `{ "port": 0, "host": "127.0.0.1" }` in the configuration file and no flags, asserting the same, so the fold is pinned too.
3. A round trip: `['start', '--port', '0', '--plugin', BACKEND, '--automations', 'memory', '--sessions', 'memory', '--no-update-check']` exits 0 and prints `ahpd on ws://127.0.0.1:`; `['status']` exits 0 with the same URL; `['stop']` exits 0 with `Stopped`; a second `['status']` exits 1.
4. `afterEach` kills any pid a record names, so a failed case leaves no daemon.

## Validation

- Dropping `port` or `host` from `serverFields` fails steps 1 and 2; breaking `declareStart` fails step 3.
- `node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green.

## Resume

Done.
`foreground` starts the daemon without `--stdio` and reads the `ahpd on ws://` line off stdout, so `--port`, `--host` and the configuration fold each have a case that fails when they are dropped.
`start`, `status` and `stop` are pinned as a round trip, and `afterEach` kills any pid a `start` case recorded.
`node_modules/.bin/vitest run packages/server/test/server-cli.test.ts` green, 32 cases.

---
title: The pinning tests bind a port and start a daemon
status: todo
depends: [task-05-start-forwards-the-words-after-start.md]
layer: "server"
refs:
  - "[code://test/server-cli.test.ts#L115-L195](../../../../test/server-cli.test.ts#L115-L195) - every run case uses `--stdio`, so `--port` and `--host` are never observed"
  - "[code://test/server-cli.test.ts#L197-L236](../../../../test/server-cli.test.ts#L197-L236) - `start` is never run; `status` reads a hand-written record"
---

## Objective

`--port`, `--host` and `start` each have a case that fails if the flag is dropped or the verb breaks.

## Files

- `UPDATE: test/server-cli.test.ts` - a foreground case on a socket, and a `start`/`status`/`stop` round trip.

## Steps

1. A helper that runs the foreground daemon without `--stdio`, waits for the `ahpd on ws://` line on stdout, and kills it; the case passes `--port 0 --host 127.0.0.1 --plugin BACKEND --no-update-check` and asserts the line names `127.0.0.1` and a port other than `9187`.
2. A second foreground case with `{ "port": 0, "host": "127.0.0.1" }` in the configuration file and no flags, asserting the same, so the fold is pinned too.
3. A round trip: `['start', '--port', '0', '--plugin', BACKEND, '--automations', 'memory', '--sessions', 'memory', '--no-update-check']` exits 0 and prints `ahpd on ws://127.0.0.1:`; `['status']` exits 0 with the same URL; `['stop']` exits 0 with `Stopped`; a second `['status']` exits 1.
4. `afterEach` kills any pid a record names, so a failed case leaves no daemon.

## Validation

- Dropping `port` or `host` from `serverFields` fails steps 1 and 2; breaking `declareStart` fails step 3.
- `node_modules/.bin/vitest run test/server-cli.test.ts` green.

## Resume

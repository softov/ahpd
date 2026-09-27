---
title: npm runs without holding the daemon, its stderr streams as it runs, and a served install says to restart the daemon that answered
status: done
depends: [task-08-served-commands-act-on-the-daemons-own-options.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L35-L68](../../../../packages/server/src/install.ts#L35-L68) - `Runner` and `run`: `spawn` with stderr written through as it arrives"
  - "[code://packages/server/src/commands/plugin.ts#L88-L94](../../../../packages/server/src/commands/plugin.ts#L88-L94) - the restart hint, from `running()`, the detached daemon's record"
  - "[code://packages/server/src/commands/served.ts](../../../../packages/server/src/commands/served.ts) - `ServedFacts`, what a served command knows of the daemon answering"
---

## Objective

A `plugin install` or `plugin remove` over HTTP does not stop the daemon answering WebSocket frames while npm runs; npm's stderr reaches the person as npm writes it, with no buffer limit; and a served install tells the caller to restart when the answering daemon is the one that must restart, foreground or detached.

## Files

- `UPDATE: packages/server/src/install.ts:35-68` - `Runner` returns a promise; `run` spawns without waiting synchronously.
- `UPDATE: packages/server/src/install.ts` - `installPlugins` and `removePlugins` await the runner.
- `UPDATE: packages/server/src/commands/plugin.ts:88-94` - the restart hint.
- `UPDATE: packages/server/test/plugin-install.test.ts` and the `server-cli` and `server-http` plugin cases - the runner replaced as a promise.

## Steps

1. `run` uses `spawn` with `stdio: ['inherit', 2, 'pipe']`, writes each stderr chunk to `process.stderr` as it arrives, keeps a copy for the caller's reason, and resolves on `close`.
2. `Runner` becomes `(program, argv) => Promise<Ran>`, and every caller and test fake follows.
3. In `plugin.ts`, served, the hint is always given (the daemon answering holds the list it started with); on the terminal it stays `running() !== undefined`.
4. Update the `Runner` comment to say what the runner is now.

## Validation

- `server-http.test.ts`: with the fake npm on `PATH` made to sleep 2 seconds, a served `plugin install` is in flight while a WebSocket `initialize` on the same daemon answers in under a second. Today the socket waits for npm.
- `server-http.test.ts`: a served install to a foreground daemon answers `restart: true`.
- `plugin-install.test.ts`: a fake npm writing 2 MB to stderr completes with exit 0; today `spawnSync` fails with `ENOBUFS`.
- `node_modules/.bin/vitest run packages/server/test` green, `pnpm typecheck` green.

## Resume

Seen to fail first: the 2 MB case answered code `-1` from `spawnSync`'s `ENOBUFS`; the served install answered no `restart`; and with a blocking runner in place the frame took 1706 ms where the case allows under 1000. Each break was made and put back, and the three cases pass after the change.

Done: `run` spawns with `stdio: ['inherit', 2, 'pipe']`, writes each stderr chunk through as it arrives, keeps the whole copy for the caller and resolves on `close`; `Runner` is `(program, argv) => Promise<Ran>` and `installPlugins` and `removePlugins` await it, so a served install no longer holds the daemon's event loop. `plugin.ts` gives the restart hint whenever the command is served, because the daemon answering is the one holding the list it started with, and keeps `running() !== undefined` at the terminal.

Two test departures: the 2 MB case drives the real `run` with a program that writes 2 MB to stderr rather than through the fake npm, because that fixture writes to stdout and the property is the runner's; and the in-flight case asks a WebSocket for an `initialize` frame and accepts any answer, which is the daemon responding at all while npm is in flight. The npm fixture gained a `FAKE_NPM_SLEEP` wait, and the `daemon` helper in `server-http.test.ts` now takes extra environment.

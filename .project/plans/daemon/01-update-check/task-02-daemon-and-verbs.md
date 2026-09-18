---
title: The daemon refreshes in the background and three places read the file
status: todo
depends: [task-01-update-module.md]
layer: server
refs:
  - code://packages/server/src/config.ts#L8-L35 - `Config`, which gains `updateCheck?: boolean`
  - code://packages/server/src/main.ts#L77-L78 - the `version` option and its doc comment, the shape for `updateCheck`
  - code://packages/server/src/main.ts#L114 - the usage text, which gains `--no-update-check`
  - code://packages/server/src/main.ts#L142-L168 - the flag switch
  - code://packages/server/src/main.ts#L265-L293 - the `start` and `status` verbs
  - code://packages/server/src/main.ts#L451-L460 - the daemon's startup lines
  - code://packages/server/src/daemon.ts#L132 - the regular expression `start` reads the announced lines with; the new line must not match it
---

## Objective

A daemon started without any gate prints `update: @ahpd/server <latest> is on npm, this is <current>` when `update.json` says so, refreshes that file every six hours without holding the process open, and `ahpd start` and `ahpd status` print the same line from the file without a request.

## Files

- `UPDATE: packages/server/src/config.ts:8-35` - `updateCheck?: boolean`, documented as "ask npm whether a newer version exists, six hours apart; `false` never asks".
- `UPDATE: packages/server/src/main.ts:77-78` - `updateCheck: boolean` option, default `true`; `--no-update-check` sets it `false`; the config key is read under the flag the way `automations` is.
- `UPDATE: packages/server/src/main.ts:114` - the usage line for `--no-update-check`.
- `UPDATE: packages/server/src/main.ts:265-293` - `start` and `status` print `updateLine()` when it has one.
- `UPDATE: packages/server/src/main.ts:451-460` - the daemon prints `updateLine()` after `wire to ...`, then schedules the refresh.

## Steps

1. `checkingUpdates(options, env = process.env): boolean` in `main.ts`: `false` when `options.updateCheck === false`, when `env.NO_UPDATE_NOTIFIER !== undefined`, or when `env.CI !== undefined`; `true` otherwise.
2. `updateLine(name, current): string | undefined` in `main.ts`: `readUpdate()`, and the sentence when `found.name === name && newer(found.latest, current)`; `undefined` otherwise. Only the daemon and the two verbs call it; `--version` does not.
3. The daemon's startup block: append the line, then if `checkingUpdates`, `if (stale(readUpdate())) void refreshUpdate({ name, registry: registry() })` and `setInterval(() => void refreshUpdate(...), 6h).unref()`.
4. `start` verb: after the daemon's lines are echoed, print `updateLine()` if any; it is gated the same way, because a gate that silences the daemon and not its parent is not a gate.
5. `status` verb: after `automations`, print `updateLine()` if any, under the same gate.
6. The name is `@ahpd/server`, read from the same manifest `version()` reads, so a fork under another name checks its own.

## Validation

- `test/update.test.ts` gains: `checkingUpdates` with each gate; `updateLine` with a file that names another package (silence), an older `latest` (silence), a newer one (the sentence).
- By hand: `npm_config_registry=http://127.0.0.1:<port>` against a `node:http` one-liner answering `{"latest":"9.9.9"}`; first `ahpd` prints no line and writes the file; second prints the line; `ahpd status` repeats it; `CI=1 ahpd` prints nothing and leaves no file.
- By hand: `ahpd stop` returns promptly with the interval scheduled, which is what `unref()` is for.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume


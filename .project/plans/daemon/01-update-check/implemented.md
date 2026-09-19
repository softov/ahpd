---
title: Telling somebody the version is old - what was built
plan: plans/daemon/01-update-check/plan.md
date: 2026-09-18
---

## What exists now

- `packages/server/src/update.ts`: `newer`, `registry`, `readUpdate`, `stale`, `refreshUpdate`, `checkingUpdates`, `updateLine`, `MAX_AGE_MS`. Its header names the copy in ahpc.
- `packages/server/src/config.ts`: `updatePath()` and the `updateCheck` key on `Config`.
- `packages/server/src/version.ts`: `manifest()` answering `{ name, version }`; `version()` wraps it.
- `packages/server/src/main.ts`: `--no-update-check` and its usage text; the key under the flag; the daemon's startup block prints `updateLine()` and schedules `refreshUpdate` when stale and every six hours, `unref()`ed; `start` and `status` print the line from the file.
- `test/update.test.ts`: 41 cases, no network, a `node:http` server and a temporary `XDG_CONFIG_HOME`; two of them run `status` as a process, since `main.ts` cannot be imported.
- `docs/DAEMON.md`, `README.md`: the flag, the key, `NO_UPDATE_NOTIFIER`, `CI`, `npm_config_registry`, the file, the six hours.

## What was verified

- `pnpm typecheck`, `pnpm boundary`, `pnpm test` (33 files, 613 tests), `pnpm build`.
- Against the real registry on 2026-09-19, with the manifest lowered to 0.4.0: the first start is silent and writes `latest: 0.5.0`; the second start, `start` and `status` say `update: @ahpd/server 0.5.0 is on npm, this is 0.4.0`; `CI=1` writes nothing; `--version` prints `0.4.0` alone.
- By hand against a local registry answering `9.9.9`, and with it stopped: the first start says nothing and writes the file; the daemon, `start` and `status` say the line after; each of the four gates says nothing and writes nothing; a dead registry leaves the old file and the old line; `stop` returns in under a second with the interval scheduled; `--version` prints the version alone.

## Where it departed from the plan

- `checkingUpdates` and `updateLine` are in `update.ts`, not `main.ts`, because `main.ts` runs the daemon on import and cannot be tested; the plan's layer table said `main.ts` holds the gates.
- `checkingUpdates` takes the boolean, not `Options`, so the module does not import the daemon's option type.
- `status` parses its arguments now, where before it read none; a side effect of gating it the same way as `start`.
- The comparison table has thirteen rows, not the task's eleven.

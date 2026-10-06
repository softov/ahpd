---
title: Every temp file of a dead writer is swept
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/daemon.ts#L124-L144](../../../../packages/server/src/daemon.ts#L124-L144) - `TEMP` matches `daemon.json.<pid>.tmp` in the daemon's directory only"
  - "[code://packages/sdk/src/users.ts#L679-L683](../../../../packages/sdk/src/users.ts#L679-L683) - the comment that says the sweeper knows the users file's temp"
  - "[code://packages/server/src/commands/run.ts#L225](../../../../packages/server/src/commands/run.ts#L225) - the users file, at a path of the operator's"
  - "[code://packages/server/test/daemon.test.ts](../../../../packages/server/test/daemon.test.ts) - the sweeper's cases"
---

## Objective

At start the daemon removes `<file>.<pid>.tmp` of a process that is gone, beside `daemon.json`, the users file, `policies.json`, `automations.json` and the computer plugin's `computers.json`.

## Files

- `UPDATE: packages/server/src/daemon.ts:124-144` - the sweeper takes the files to sweep beside, and matches `<that file's name>.<pid>.tmp`; today it matches `daemon.json.<pid>.tmp` in the daemon's directory only, so a `users.json.4242.tmp` (holding token hashes) left by a writer killed between write and rename stays forever.
- `UPDATE: packages/server/src/commands/run.ts` - passes the users path, `policiesPath()`, `automationsPath()` and `computers.json` in the config directory, whose writer (`packages/computer/src/owners.ts:171`) names its temp the same way.
- `UPDATE: packages/server/test/daemon.test.ts` - the cases below.

## Steps

1. Failing case first: `users.json.<dead pid>.tmp`, `policies.json.<dead pid>.tmp` and `automations.json.<dead pid>.tmp` beside their files; start. Today all three stay; after, they are gone, and a temp of a live pid stays.
2. A file whose name is not `<one of those>.<digits>.tmp` stays.

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/server/test/daemon.test.ts`.

## Resume

`packages/server/src/daemon.ts` - `TEMP` is `/^(.+)\.(\d+)\.tmp$/u` and `sweepTemps(beside)` is exported, walking each named file's own directory and clearing `<that file>.<pid>.tmp` for a pid that is gone; a name that is not that file's scratch is left whatever its shape, and `claim` calls `sweepTemps([daemonPath()])` as before.

`packages/server/src/commands/run.ts` - `wholeFiles(users)` names the users file the operator gave plus `policiesPath()`, `automationsPath()` and `join(configDir(), 'computers.json')`, and `runForeground` calls `sweepTemps(wholeFiles(options.users))` once its users file is built.

`packages/server/test/daemon.test.ts` - one case, in a `describe` of its own: a real daemon over `--stdio` in a temporary configuration directory, with a `users.json.<dead pid>.tmp`, a `policies.json.<dead pid>.tmp`, an `automations.json.<dead pid>.tmp` and a `computers.json.<dead pid>.tmp` beside their files, a live writer's temp, `users.json.tmp` with no pid in it and `notes.json.7.tmp` for a file the daemon does not write. The four gone writers' scratch is removed and the other three stay.

Verified: the case failed without the call with `expected true to be false` on a gone writer's temp; `npx tsc -b` clean; `npx vitest run packages/server/test/daemon.test.ts` 40 tests pass; `npx vitest run packages/server` 38 files, 732 tests pass; `npm run boundary` clean.

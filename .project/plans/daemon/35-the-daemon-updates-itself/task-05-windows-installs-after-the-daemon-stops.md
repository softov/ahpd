---
title: Windows installs after the daemon stops
status: done
depends:
  - task-03-update-installs-moves-plugins-and-restarts.md
layer: server
refs:
  - "[code://packages/server/package.json](../../../../packages/server/package.json) - `node-pty`, the native binding Windows locks"
  - "[code://packages/server/src/install.ts#L86-L101](../../../../packages/server/src/install.ts#L86-L101) - `launch`, npm as `node npm-cli.js` on Windows"
  - "[code://packages/server/src/commands/restart.ts#L396-L418](../../../../packages/server/src/commands/restart.ts#L396-L418) - `successorTakes` and `windowsHide`"
---

## Objective

On Windows, `ahpd update` stops the daemon, installs the new version from a helper outside the install, and starts the daemon again.

## Files

- `CREATE: packages/server/src/updater.ts` - the helper: wait for a pid, run npm, move the plugins, start the daemon, write each step to a log.
- `UPDATE: packages/server/src/selfupdate.ts` - `handOffToHelper()`, which copies the built helper to a temporary folder and starts it detached.
- `UPDATE: packages/server/src/commands/update.ts` - on Windows, answer first, then hand off and go down.
- `CREATE: packages/server/test/selfupdate-windows.test.ts` - the hand-off and the helper steps, with a fake npm.

## Steps

1. Write the tests first, with a fake npm and a fake start.
2. Build `updater.ts` as a script with no import from the install place.
3. Copy the built helper to a new folder under the system temporary folder.
4. Start it with `process.execPath`, detached, with `windowsHide`, and with the temporary folder as its working folder.
5. Pass it the pid, the npm call, the target, the config folder and the recorded line.
6. Answer `{from, to, restarting: true}`, then go down through the way down of the daemon.
7. In the helper, wait for the pid to exit, and log once after 60 seconds.
8. In the helper, run npm, then `updatePlugins('all')` with the target.
9. In the helper, start the daemon with the recorded line, as `ahpd start` does.
10. In the helper, start the old version again when npm fails, and write the npm error to the daemon log.
11. Remove the temporary folder when the helper ends.
12. Set this task and the plan row to `implemented`.

## Validation

- A test: the hand-off copies the helper out of the install place and passes the pid and the line.
- A test: the helper waits for the pid, runs npm, then starts the daemon.
- A test: a failed npm starts the old line again and writes the error to the log.
- By hand on Windows: a daemon from `ahpd start` comes back on the newer version, and `ahpd status` shows it.
- `pnpm -s build`, `pnpm -s typecheck` and the server vitest suite pass.

## Resume

Done 2026-10-19. Every step is built, and the three cases the Validation names pass. Not reviewed. The Windows check by hand has not been made: there is no Windows machine here, and it stays open below.

`updater.ts` is the helper. It imports Node's built-ins alone and nothing from this package. `updateOnce()` waits for the daemon's pid, looking every 100 ms until it is gone, with one log line after 60 seconds. It then runs npm, then `<new main.js> plugin update all`, then `<new main.js> start <line>`. A failed npm starts the old line again and writes npm's reason to the daemon log. Run directly, the module reads the manifest path from `argv`. It writes a throw to the log, removes its own folder, and leaves the exit status of the steps. `handOffToHelper()` in `selfupdate.ts` builds npm's call with `installArgv()`. It copies the built `updater.js` into a new temporary folder as `updater.mjs` and writes `update.json` beside it. It starts the copy with `process.execPath`, detached, hidden, streams ignored, in the copy's folder. `runUpdate()` answers `{from, to, restarting: true}` on Windows and then goes down. A served daemon goes down through `ServedFacts.down()`, which `run.ts` wires to `wayDown`. A terminal stops it with `daemon.stop()`, which is what `ahpd stop` runs.

Departures:
- `installServer`'s npm argv is now `installArgv()`, so the helper is handed the same call rather than a second copy of the `-g` and `--allow-scripts` rules. `installServer` itself is unchanged in what it runs and says.
- The helper moves the plugins by starting the new binary's `plugin update all`, not by importing `updatePlugins`. The import would come from the package npm is rewriting, which step 2 forbids, and the new binary pins the sdk at its own version. For that one call the helper sets `AHPD_PLUGIN_ROOT` to the daemon's plugin root. If the daemon's environment already names one, that one is inherited instead, and it is the same root.
- The hand-off runs before the answer, and the way down after it. Step 6 says answer first, then hand off and go down. A hand-off that fails is then a refusal the caller gets, not a daemon that stopped with nothing left to install. The answer still goes before the daemon stops.
- The successor check is not run on Windows. `successorTakes` would ask the old binary whether it takes the line, because npm has not installed the new one yet. The helper's `start` is the check, and a refusal there is written to the daemon log.
- A daemon still there after 60 seconds is never killed. The helper waits until it is gone, because nothing else starts it again.
- A failed plugin move is written to the log and the daemon is started anyway. The new version is installed by then, and leaving the daemon down would be worse than plugins one sdk behind.
- `UpdateFacts` gained `handOff` and `down`, and `ServedFacts` gained optional `down()`, so the branch is driven without a process in the cases.

The four new cases in `selfupdate-windows.test.ts` pass. They cover the copy out of the install with the pid and the line. The steps are covered in order: the wait, npm, the plugin move, the start. They also cover a failed npm starting the old line with the error in the log, and the limit installing nothing. One case in `server-update.test.ts` covers the Windows branch of the command. Nothing is installed here, the helper is handed the pid, the line and the start folder, and the way down runs after the answer. A smoke run of the built `dist/updater.js` against a dead pid waited and ran a stand-in npm. It wrote each step to a log and removed its folder. The whole server suite passes, 1225 tests in 61 files. Build, typecheck and the schema are clean.

Open:
- By hand on Windows: `ahpd update` from `ahpd start` comes back on the newer version, and `ahpd status` shows it. Nothing here can run it.
- The direct-run half of `updater.ts` has the smoke run above and no vitest case. The steps it calls are covered by `updateOnce`.

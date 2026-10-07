---
title: A plugin is told when the host closes, and the computer plugin stops its work there - implemented
date: 2026-10-07
refs:
  - git://9159665 - the commit this work sits on; none of it is committed yet, on `build/agents/70ebe302`
  - "[code://packages/sdk/src/types/plugin.ts#L372](../../../../packages/sdk/src/types/plugin.ts#L372) - `registerClose` on `PluginHost`"
  - "[code://packages/sdk/src/plugins.ts#L354-L360](../../../../packages/sdk/src/plugins.ts#L354-L360) - the fold that turns every contribution's closers into `HostOptions.closers`"
  - "[code://packages/sdk/src/host.ts#L897](../../../../packages/sdk/src/host.ts#L897) - `close` waits for the machine leaves before it stops the plugins"
  - "[code://packages/sdk/src/host/machines.ts#L141-L184](../../../../packages/sdk/src/host/machines.ts#L141-L184) - the promises `inMachine` keeps, and `settled`"
  - "[code://packages/computer/src/plugin.ts#L1872-L1884](../../../../packages/computer/src/plugin.ts#L1872-L1884) - the computer plugin's closer"
  - "[code://packages/computer/src/devcontainer.ts#L1168](../../../../packages/computer/src/devcontainer.ts#L1168) - the launcher's `close`, which ends the nested hosts"
  - "[code://packages/computer/test/support/closing.ts](../../../../packages/computer/test/support/closing.ts) - the cleanup every computer test closes through"
  - "[code://packages/sdk/test/host-close.test.ts](../../../../packages/sdk/test/host-close.test.ts) - the order `close` runs in, and the leave it waits for"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - a plugin registers what stops with the host"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - what a machine does when ahpd stops"
---

A host that closes now tells every plugin, and a plugin stops what it started.
The computer plugin clears its disposal timers and ends its nested host processes.
It waits for a removal that is running, and the next start gives a leftover machine the delay again.
`close()` also waits for the machine enters and leaves the host itself started.
A daemon that stops therefore brings a machine's work back before it exits.
The computer tests close every host, load and launcher they make before they remove their folders.
`npx vitest run packages/computer` passed ten times in a row with no `ENOTEMPTY`.

## What was built

- [`code://packages/sdk/src/types/plugin.ts#L372`](../../../../packages/sdk/src/types/plugin.ts#L372) and [`code://packages/sdk/src/plugins.ts#L602-L613`](../../../../packages/sdk/src/plugins.ts#L602-L613) - `registerClose(close)` on `PluginHost`, beside the other `register*` functions. It pushes onto its own contribution's `closers`, refuses a non-function the way the others do, and may be called more than once.
- [`code://packages/sdk/src/plugins.ts#L354-L360`](../../../../packages/sdk/src/plugins.ts#L354-L360) - `foldHostOptions` collects the closers of every loaded plugin into `HostOptions.closers`, each with the name of the plugin that registered it. A host with none carries no `closers` key.
- [`code://packages/sdk/src/host.ts#L897`](../../../../packages/sdk/src/host.ts#L897) - `close` runs `await step('the machine leaves', () => ctx.settled())` after the chats, their starting runs and the terminals, and before the plugin closers and the stores. Each closer then runs as its own `step`, so one that fails is logged against its plugin and the next one still runs.
- [`code://packages/sdk/src/host/machines.ts#L141-L184`](../../../../packages/sdk/src/host/machines.ts#L141-L184) - `inMachine` keeps each enter and leave in a set of promises and takes it out when it settles. `settled()` awaits the set and looks at it again after each round. A port that throws before it answers is caught by the same chain as one that rejects after. The failure becomes a line in the log rather than a rejection nobody holds.
- [`code://packages/computer/src/plugin.ts#L1872-L1884`](../../../../packages/computer/src/plugin.ts#L1872-L1884) - the plugin's closer sets `closed` and waits for the startup scan it began. It clears every disposal timer without firing it, waits for the removals in flight, and closes the launcher. The startup scan is what gives a machine left behind the delay again on the next start.
- [`code://packages/computer/src/devcontainer.ts#L1168`](../../../../packages/computer/src/devcontainer.ts#L1168) - the launcher's `close` ends every nested host child and waits for each to go.
- [`code://packages/computer/test/support/closing.ts`](../../../../packages/computer/test/support/closing.ts) - `keeping(load, host?)`, `keepingPort(port)` and `closeAll()`. `closeAll` closes every host, then every hostless load through its own closers, then every launcher, once each.
- Eleven computer test files register through `keeping` and `await closeAll()` in an async `afterEach`, before they remove their folders. `computer-disposable.test.ts` no longer retries its removal: `maxRetries` and `retryDelay` are gone, so a writer that is still alive fails the test instead of being hidden.
- [`code://docs/PLUGINS.md`](../../../../docs/PLUGINS.md) - a plugin registers what stops with the host, written beside the other `register*` functions. [`code://docs/COMPUTER.md`](../../../../docs/COMPUTER.md) - what the computer plugin stops. It says that stopping the daemon ends the waiting rather than the machines.

## Verified

- `pnpm build` clean, `pnpm typecheck` clean, `pnpm boundary` clean - the same declarations as before, none undeclared.
- `npx vitest run` from the root - **239 files, 3543 tests, all passing**, none skipped.
- `npx vitest run packages/computer` ten times in a row, nothing else running, in this order: 395 passed, 395, 395, 395, 395, 395, 395, 395, 395, 395. Every run was 22 files and no run failed, so no `ENOTEMPTY`. Each run took between 160 s and 165 s.
- The close-related files together - **59 cases**: `packages/sdk/test/host-close.test.ts` (16), `plugin-host.test.ts` (17), `plugin-fold.test.ts` (19), `plugins-close.test.ts` (4), `packages/computer/test/computer-close.test.ts` (3).
- `packages/sdk/test/host-close.test.ts` - a `computers.bringBack` that answers after 200 ms has answered, and its `leave` has run, by the time `close()` resolves. It fails without the `settled` step in `close`.
- The task 03 probe ran over every computer test file: 22 files, 395 tests. Each case's folders were read once when its hosts were closed and again a second and a half later. It found no state file written after a close. Nothing was written into a machine folder, no `docker.json` or `settings.json` was rewritten, and no docker call was made after a close. Two things moved in the window. A `docker.json.lock` went away, which is a scripted-docker process that was still running when `close()` answered and exited without recording a call. And the host repository's `objects` directory changed its time in some cases, 4 of them in one run of the probe and 10 in another. The kernel named the file for one of them: `repo/.git/objects/maintenance.lock`, which git's own detached auto-maintenance takes and releases, and which a host-side fetch spawns.

## Departures from the plan

- The plan did not have a task 05 when it was written. The build met a fork: after `close()` returned, the host's own session leave was still running, because `inMachine` started it and kept nothing. Softov decided on 2026-10-07 that `close()` awaits those enters and leaves, and added task 05. A test-side wait for a quiet folder was written first, under task 03, and removed by task 05.
- Task 03's *Files* list named seven test files; eleven register through the helper. The four it did not name are `computer-close.test.ts`, `computer-needs.test.ts`, `computer-options.test.ts` and `computer-state-seed.test.ts`, each of which makes hosts and removed its folder in the same teardown.
- `leftOver()` in `computer-disposable.test.ts` was kept rather than removed. The whole run shares one temporary directory, and the plugin's own bringBack scratch folder is there for as long as any file's fetch takes. A neighbour's fetch is therefore in the answer whatever `close()` waits for. The helper asks again until the answer is nothing or a deadline passes. It waits on the timer the module captured, because most of that file's cases fake `setTimeout`.
- Each task is `implemented`, not `done`, and the plan is `built` with all five implemented. Nothing here has been committed or reviewed, so no run has seen it and CI has not run.

## Left for later

- CI on main is green - this cannot be checked until the work is committed.
- A host-side `git fetch` leaves git's own detached `git maintenance` process behind. It touches the host repository's object store for a moment after the daemon stopped, and nothing the daemon can wait for. A removal that runs right after a fetch may meet it.
- The ten-run check ran on this machine, with no other work in the repository at the time.

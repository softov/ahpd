---
title: A plugin is told when the host closes, and stops its own work there
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L176](../../packages/sdk/src/types/plugin.ts#L176) - `PluginHost`, which has no teardown today"
  - "[code://packages/sdk/src/host.ts#L857-L890](../../packages/sdk/src/host.ts#L857-L890) - `close`, which closes the chats and the stores but no plugin"
  - "[code://packages/computer/src/plugin.ts#L857-L881](../../packages/computer/src/plugin.ts#L857-L881) - `arm`, a disposal timer that keeps running after the host closes"
---

## Context

The computer plugin starts timers and processes that the host does not own.
A disposal timer removes a machine after its delay, and a refused removal arms the timer again.
A dev container connection keeps a `docker exec` child for the nested host.
The host closes its chats and its stores, but it cannot tell a plugin to stop.
In the tests, this work goes on after a test ends and writes into the folder that the test removes.
CI then fails with `ENOTEMPTY` in the computer tests.

## Decision

A plugin can register a close function with `registerClose`.
`host.close()` calls each one after the sessions close and before the stores close.
The computer plugin stops its timers there, waits for the removals that are running, and ends its nested host processes.

Source: Softov, 2026-10-07, asked "The ENOTEMPTY flake comes from computer plugin timers ... How do we fix it?" and chose "Plugin stop hook, small plan".

## Consequences

- A test closes the hosts it makes, and the computer tests stop failing on cleanup.
- A daemon that stops waits for a machine removal that is already running.
- A disposable machine that has a timer still stays after the daemon stops, as it does now; the next start gives it the delay again.

## Options

- The tests ignore a folder that is still written to. The timers still run after the test, and the defect is hidden.
- A `close` on the computers port only, like the automation store. It covers one plugin, and the dev container processes are not on that port.

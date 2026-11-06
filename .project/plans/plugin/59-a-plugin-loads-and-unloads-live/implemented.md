---
title: A plugin loads, unloads and reloads while the daemon runs - implemented
date: 2026-11-05
refs:
  - git://c54bb159 - the last commit that names it on main
---

A plugin loads, unloads and reloads while the daemon runs.

## What was built

- [01 - The host takes a new fold](task-01-the-host-takes-a-new-fold.md).
- [02 - A plugin change applies at once](task-02-a-plugin-change-applies-at-once.md).
- [03 - An agent unload ends its sessions](task-03-an-agent-unload-ends-its-sessions.md).
- [04 - A code reload imports a new URL](task-04-a-code-reload-imports-a-new-url.md).

## Verified

- CI on #243 at e2d4588a, the code of main at 3f6e3da8, passed every check, Windows included.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built.

## Left for later

- none

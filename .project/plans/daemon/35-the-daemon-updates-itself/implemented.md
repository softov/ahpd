---
title: The daemon updates itself - implemented
date: 2026-11-05
refs:
  - git://fdc14a90 - the last commit that names it on main
---

The daemon updates itself.

## What was built

- [01 - The update finds its install place](task-01-the-update-finds-its-install-place.md).
- [02 - Update checks and refuses](task-02-update-checks-and-refuses.md).
- [03 - Update installs, moves the plugins and restarts](task-03-update-installs-moves-plugins-and-restarts.md).
- [04 - AHP calls the update](task-04-ahp-calls-the-update.md).
- [05 - Windows installs after the daemon stops](task-05-windows-installs-after-the-daemon-stops.md).
- [06 - The docs say how to update](task-06-the-docs-say-how-to-update.md).

## Verified

- CI on #243 at e2d4588a, the code of main at 3f6e3da8, passed every check, Windows included.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built.

## Left for later

- none

---
title: The service manager starts the daemon - implemented
date: 2026-11-05
refs:
  - git://11f5efa6 - the last commit that names it on main
---

The service manager starts the daemon.

## What was built

- [01 - A supervised daemon writes its record](task-01-a-supervised-daemon-writes-its-record.md).
- [02 - Stop and restart ask the manager](task-02-stop-and-restart-ask-the-manager.md).
- [03 - Service install writes a systemd unit](task-03-service-install-writes-a-systemd-unit.md).
- [04 - Service install writes a LaunchAgent](task-04-service-install-writes-a-launch-agent.md).
- [05 - The docs say how to run it as a service](task-05-the-docs-say-how-to-run-as-a-service.md).

## Verified

- CI on #243 at e2d4588a, the code of main at 3f6e3da8, passed every check, Windows included.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built.

## Left for later

- none

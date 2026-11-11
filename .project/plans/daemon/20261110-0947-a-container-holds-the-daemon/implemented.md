---
title: A container holds the daemon - implemented
date: 2026-11-11
refs:
  - git://f6d5f6dd5 - the merge of #282, the three tasks
  - git://02ffc9c9d - the merge of #284, a container claims over its own stale record
---

ahpd runs as the main process of a container, and its lifecycle verbs work there.
A daemon with `AHPD_SERVICE=container` writes its own record, so `ahpd status`, `ahpd doctor` and a client find it.
A restart exits with 75 for the restart policy, and `ahpd stop` and `ahpd update` refuse with the container's command.

## What was built

- [01 - A container daemon writes its record and refuses a stop](task-01-a-container-daemon-writes-its-record.md).
- [02 - A restart exits for the restart policy](task-02-a-restart-exits-for-the-policy.md).
- [03 - An update names the image](task-03-an-update-names-the-image.md).

## Verified

- CI on #282 and #284 passed every check, Windows included.
- The CI `image` job runs `docker/test/smoke.sh` on each PR. It checks the health check through `ahpd status --json`, and `docker exec <container> ahpd restart` with the same token.
- Review, 2026-11-11: the diff of #282 against each task's *Steps*, and the stale-record path of #284 with `ahpd plugin install` before the daemon starts.

## Departures from the plan

- #284 added a case that the plan did not know.
After an unclean exit, the old record names the pid that the next daemon gets.
`claim` now takes over a record that names its own pid.
- Each task's *Resume* section says what else it found while it was built.

## Left for later

- none

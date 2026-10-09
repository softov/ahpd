---
title: Measure the catalogue and the daemon's memory
plans:
  - plans/host/56-the-catalogue-answers-at-once-and-a-summary-is-sent-when-it-changes/task-05-measured-before-and-after.md
---

# Measure the catalogue and the daemon's memory

Tasks 01 to 04 are merged. This measures them against the numbers in the plan's Reconnaissance (2026-10-04).

The probes start no daemon. They connect to a daemon that is already running, and they only read. By default they use the host and token in `~/.config/ahpc/config.json`, which points at dev-01 now. `PROBE_HOST` and `PROBE_TOKEN` point them at another daemon, and your config stays as it is.

Run every command in `/github/ahpapp/.scratch/org/`.

## dev-01

dev-01 must run a daemon built with host/56 tasks 01 to 04, with one build running on it.

1. Run `node probe-dev01.mjs`. Note the `listSessions answered ... took N ms` line, with its `items` count.
2. Run `node probe-flood.mjs`. It takes 70 s. Note the event count, and how many were the same as the one before.

## Your local daemon

Done on 2026-10-09; the numbers are in task 05's Resume. Memory stayed between 320 and 600 MB, so no heap snapshot is needed.

## Reply

Paste the output of steps 1 and 2.
